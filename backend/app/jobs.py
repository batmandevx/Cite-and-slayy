"""In-process job runner with Server-Sent Events.

A job is an async function `fn(ctx)`; it reports progress via `await ctx.update(stage, message, progress)`
and returns the id of the stored result. The work itself lives in this process, but each job's state is mirrored to
SQLite: after a restart (a deploy) the job is still found, reported as interrupted, and its `undo` is applied (the
quota credit is given back, a plan is unlocked for another try) instead of the client spinning on a job nobody knows.

`undo` is plain data so it survives the restart:
  {"refund": {"uid": ..., "features": [...], "used_pack": bool}}   give metered uses back
  {"plan_reset": plan_id}                                            let a reviewed plan be written again
"""
from __future__ import annotations

import asyncio
import json
import time
import traceback
import uuid
from typing import Awaitable, Callable

from backend.cache.store import get_store, now
from backend.common.config import get_settings
from backend.common.schemas import Job, JobEvent
from backend.llm.client import scrub

KIND = "job"
INTERRUPTED = "Interrupted by a server update. Any credit it used was returned: please start it again."


class JobContext:
    def __init__(self, mgr: "JobManager", job: Job):
        self.mgr, self.job = mgr, job

    async def update(self, stage: str, message: str, progress: float | None = None) -> None:
        if progress is not None:
            self.job.progress = max(0.0, min(1.0, progress))
        self.job.stage = stage
        await self.mgr._emit(self.job, message)


def refund_undo(user: dict, *features: str) -> dict:
    return {"refund": {"uid": user["uid"], "features": list(features), "used_pack": bool(user.get("_used_pack"))}}


def run_undo(undo: dict | None) -> None:
    if not undo:
        return
    from backend.accounts import auth
    store = get_store()
    if r := undo.get("refund"):
        user = auth.get_user(r["uid"]) or {"uid": r["uid"]}
        user = {**user, "_used_pack": r.get("used_pack", False)}
        for f in r.get("features") or []:
            auth.refund(user, f)
    if pid := undo.get("plan_reset"):
        if (pl := store.get("paper_plan", pid)) and pl.get("status") == "writing":
            store.put("paper_plan", pid, {**pl, "status": "planned"})


class JobManager:
    def __init__(self):
        self.jobs: dict[str, Job] = {}
        self.events: dict[str, list[JobEvent]] = {}
        self._conds: dict[str, asyncio.Condition] = {}
        self._tasks: set[asyncio.Task] = set()
        self.owners: dict[str, str] = {}
        self._undo: dict[str, dict] = {}
        self._finished: dict[str, float] = {}     # job_id -> when it ended, so old jobs can be forgotten
        self._saved_at: dict[str, float] = {}

    KEEP_SECONDS = 6 * 3600   # finished jobs (and their event logs) stay in memory this long; SQLite keeps the outcome

    def _prune(self) -> None:
        cutoff = time.time() - self.KEEP_SECONDS
        for jid in [j for j, t in self._finished.items() if t < cutoff]:
            for d in (self.jobs, self.events, self._conds, self.owners, self._undo, self._finished, self._saved_at):
                d.pop(jid, None)

    # ----- persistence -----
    def _save(self, job: Job, force: bool = False) -> None:
        t = time.time()
        if not force and t - self._saved_at.get(job.job_id, 0) < 2:   # progress ticks: at most one write every 2 s
            return
        self._saved_at[job.job_id] = t
        try:
            get_store().put(KIND, job.job_id, {**job.model_dump(mode="json"), "_owner": self.owners.get(job.job_id),
                                               "_undo": self._undo.get(job.job_id)})
        except Exception:  # noqa: BLE001 - persistence is a safety net; never fail the job over it
            traceback.print_exc()

    def get(self, job_id: str) -> Job | None:
        """The live job, or its stored record if this process didn't run it (e.g. it ran before a restart)."""
        if job_id in self.jobs:
            return self.jobs[job_id]
        rec = get_store().get(KIND, job_id)
        return Job.model_validate({k: v for k, v in rec.items() if not k.startswith("_")}) if rec else None

    def owner(self, job_id: str) -> str | None:
        if job_id in self.owners:
            return self.owners[job_id]
        return (get_store().get(KIND, job_id) or {}).get("_owner")

    def recover_interrupted(self) -> int:
        """At startup: jobs that were running when the last process stopped can't continue. Fail them and undo."""
        store = get_store()
        with store._lock:
            rows = store._conn.execute(
                "SELECT body FROM objects WHERE kind=? AND json_extract(body, '$.status') IN ('queued', 'running')",
                (KIND,)).fetchall()
            store._conn.execute("DELETE FROM objects WHERE kind=? AND updated_at < datetime('now', '-14 days')", (KIND,))
            store._conn.commit()
        for (body,) in rows:
            rec = json.loads(body)
            undo = rec.get("_undo")
            if rec.get("kind") == "autoclaw" and get_settings().claw_url:
                undo = None       # the AutoResearchClaw run itself carries on (claw.resume_live_runs): it isn't lost
            try:
                run_undo(undo)
            except Exception:  # noqa: BLE001
                traceback.print_exc()
            store.put(KIND, rec["job_id"], {**rec, "status": "error", "error": INTERRUPTED, "_undo": None})
        return len(rows)

    # ----- running -----
    def submit(self, kind: str, fn: Callable[[JobContext], Awaitable[str]], owner: str | None = None,
               undo: dict | None = None) -> Job:
        self._prune()
        job = Job(job_id=uuid.uuid4().hex[:12], kind=kind, created_at=now())
        self.jobs[job.job_id] = job
        if owner:
            self.owners[job.job_id] = owner
        if undo:
            self._undo[job.job_id] = undo
        self.events[job.job_id] = []
        self._conds[job.job_id] = asyncio.Condition()
        self._save(job, force=True)
        task = asyncio.create_task(self._run(job, fn))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return job

    async def _run(self, job: Job, fn) -> None:
        ctx = JobContext(self, job)
        job.status = "running"
        await self._emit(job, "started")
        try:
            job.result_id = await fn(ctx)
            owner = self.owners.get(job.job_id)
            if owner and job.result_id:
                from backend.accounts.auth import JOB_RESULT_KIND
                if job.kind in JOB_RESULT_KIND:
                    get_store().set_owner(JOB_RESULT_KIND[job.kind], job.result_id, owner)
                    if job.kind == "pipeline":   # a pipeline produces a draft, a document, an audit and a verdict
                        res = get_store().get("pipeline", job.result_id) or {}
                        for k, key in (("document", "document_id"), ("audit", "audit_id"), ("verdict", "review_id"),
                                       ("autoclaw_run", "autoclaw_run_id")):
                            if res.get(key):
                                get_store().set_owner(k, res[key], owner)
            job.status, job.progress, job.stage = "done", 1.0, "done"
            self._undo.pop(job.job_id, None)
            await self._emit(job, "finished")
        except Exception as e:  # report every failure to the client
            traceback.print_exc()
            job.status, job.error = "error", scrub(f"{type(e).__name__}: {e}")
            try:
                run_undo(self._undo.pop(job.job_id, None))   # e.g. give the quota back
            except Exception:  # noqa: BLE001
                traceback.print_exc()
            await self._emit(job, job.error)
        finally:
            self._finished[job.job_id] = time.time()

    async def _emit(self, job: Job, message: str) -> None:
        ev = JobEvent(job_id=job.job_id, stage=job.stage or job.status, message=message,
                      progress=job.progress, ts=now(), status=job.status)
        self.events[job.job_id].append(ev)
        self._save(job, force=job.status in ("done", "error") or message == "started")
        cond = self._conds[job.job_id]
        async with cond:
            cond.notify_all()

    async def stream(self, job_id: str):
        """Yield SSE frames: replay past events, then follow until the job ends."""
        if job_id not in self.jobs:          # ran in an earlier process: all we have is the stored outcome
            job = self.get(job_id)
            if job:
                yield f"event: end\ndata: {json.dumps(job.model_dump(mode='json'))}\n\n"
            return
        i = 0
        cond = self._conds[job_id]
        while True:
            evs = self.events[job_id]
            while i < len(evs):
                yield f"data: {evs[i].model_dump_json()}\n\n"
                i += 1
            if self.jobs[job_id].status in ("done", "error"):
                yield f"event: end\ndata: {json.dumps(self.jobs[job_id].model_dump(mode='json'))}\n\n"
                return
            async with cond:
                try:
                    await asyncio.wait_for(cond.wait(), timeout=15)
                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"


jobs = JobManager()
