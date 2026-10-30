"""In-process job runner with Server-Sent Events.

A job is an async function `fn(ctx)`; it reports progress via `await ctx.update(stage, message, progress)`
and returns the id of the stored result. Jobs survive only for the lifetime of the process;
results are persisted in SQLite.
"""
from __future__ import annotations

import asyncio
import json
import traceback
import uuid
from typing import Awaitable, Callable

from backend.cache.store import now
from backend.common.schemas import Job, JobEvent
from backend.llm.client import scrub


class JobContext:
    def __init__(self, mgr: "JobManager", job: Job):
        self.mgr, self.job = mgr, job

    async def update(self, stage: str, message: str, progress: float | None = None) -> None:
        if progress is not None:
            self.job.progress = max(0.0, min(1.0, progress))
        self.job.stage = stage
        await self.mgr._emit(self.job, message)


class JobManager:
    def __init__(self):
        self.jobs: dict[str, Job] = {}
        self.events: dict[str, list[JobEvent]] = {}
        self._conds: dict[str, asyncio.Condition] = {}
        self._tasks: set[asyncio.Task] = set()
        self.owners: dict[str, str] = {}

    def submit(self, kind: str, fn: Callable[[JobContext], Awaitable[str]], owner: str | None = None,
               on_error: Callable[[], None] | None = None) -> Job:
        job = Job(job_id=uuid.uuid4().hex[:12], kind=kind, created_at=now())
        self.jobs[job.job_id] = job
        if owner:
            self.owners[job.job_id] = owner
        self._on_error = getattr(self, "_on_error", {})
        if on_error:
            self._on_error[job.job_id] = on_error
        self.events[job.job_id] = []
        self._conds[job.job_id] = asyncio.Condition()
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
                from backend.cache.store import get_store
                if job.kind in JOB_RESULT_KIND:
                    get_store().set_owner(JOB_RESULT_KIND[job.kind], job.result_id, owner)
                    if job.kind == "pipeline":   # a pipeline produces a draft, a document, an audit and a verdict
                        res = get_store().get("pipeline", job.result_id) or {}
                        for k, key in (("document", "document_id"), ("audit", "audit_id"), ("verdict", "review_id"),
                                       ("autoclaw_run", "autoclaw_run_id")):
                            if res.get(key):
                                get_store().set_owner(k, res[key], owner)
            job.status, job.progress, job.stage = "done", 1.0, "done"
            await self._emit(job, "finished")
        except Exception as e:  # report every failure to the client
            traceback.print_exc()
            job.status, job.error = "error", scrub(f"{type(e).__name__}: {e}")
            cb = getattr(self, "_on_error", {}).pop(job.job_id, None)
            if cb:
                cb()   # e.g. give the quota back
            await self._emit(job, job.error)

    async def _emit(self, job: Job, message: str) -> None:
        ev = JobEvent(job_id=job.job_id, stage=job.stage or job.status, message=message,
                      progress=job.progress, ts=now(), status=job.status)
        self.events[job.job_id].append(ev)
        cond = self._conds[job.job_id]
        async with cond:
            cond.notify_all()

    async def stream(self, job_id: str):
        """Yield SSE frames: replay past events, then follow until the job ends."""
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
