"""Thin adapter around AutoResearchClaw (github.com/aiming-lab/AutoResearchClaw, MIT).

AutoResearchClaw is an external dependency: we only invoke its CLI and read its output folder.

Live:  researchclaw run --topic "<topic>" [--config <cfg>] (--auto-approve | --mode <mode>)
       stdout is scanned for the 23 pipeline stage names; output is read from
       artifacts/rc-*/deliverables/ (per the AutoResearchClaw README).
Demo:  replays demo/autoclaw_run/ (a real paper from AutoResearchClaw's public showcase) so the
       live demo never waits on a ~1h pipeline. The replay is labelled as such in the UI.
"""
from __future__ import annotations

import asyncio
import json
import re
import shutil
import uuid
from pathlib import Path

from backend.cache.store import get_store, now
from backend.common.config import ROOT, get_settings
from backend.common.schemas import AutoClawRequest, AutoClawRun, AutoClawStage
from backend.documents import service as docs

STAGES = [
    "TOPIC_INIT", "PROBLEM_DECOMPOSE", "SEARCH_STRATEGY", "LITERATURE_COLLECT", "LITERATURE_SCREEN",
    "KNOWLEDGE_EXTRACT", "SYNTHESIS", "HYPOTHESIS_GEN", "EXPERIMENT_DESIGN", "CODE_GENERATION",
    "RESOURCE_PLANNING", "EXPERIMENT_RUN", "ITERATIVE_REFINE", "RESULT_ANALYSIS", "RESEARCH_DECISION",
    "PAPER_OUTLINE", "PAPER_DRAFT", "PEER_REVIEW", "PAPER_REVISION", "QUALITY_GATE", "KNOWLEDGE_ARCHIVE",
    "EXPORT_PUBLISH", "CITATION_VERIFY",
]
DEMO_DIR = ROOT / "demo" / "autoclaw_run"
STAGE_RE = re.compile(r"(?:stage\s*0?(\d{1,2})\b|\b(" + "|".join(STAGES) + r")\b)", re.I)


class BridgeError(Exception):
    pass


def _new_run(topic: str, demo: bool, uid: str | None = None) -> AutoClawRun:
    run = AutoClawRun(run_id=uuid.uuid4().hex[:12], topic=topic, demo=demo, status="running",
                      stages=[AutoClawStage(number=i + 1, name=n, status="pending") for i, n in enumerate(STAGES)],
                      log_tail=[], created_at=now())
    if uid and uid != "local":
        get_store().set_owner("autoclaw_run", run.run_id, uid)     # so the starter can find it again after a reload
    return run


def _advance(run: AutoClawRun, number: int) -> None:
    for s in run.stages:
        if s.number < number:
            s.status = "done"
        elif s.number == number:
            s.status = "running"


def _save(run: AutoClawRun) -> None:
    get_store().put("autoclaw_run", run.run_id, run)


def live_available() -> bool:
    s = get_settings()
    return bool(s.claw_url and s.claw_token) or bool(shutil.which(s.autoclaw_bin))


async def run(req: AutoClawRequest, ctx, uid: str | None = None) -> str:
    s = get_settings()
    demo = s.demo_mode if req.demo is None else req.demo
    if demo:
        return await _run_demo(req, ctx, uid)
    if s.claw_url and s.claw_token:
        return await _run_worker(req, ctx, uid or "local")
    return await _run_live(req, ctx, uid)


async def _run_worker(req: AutoClawRequest, ctx, uid: str) -> str:
    """Live run in the isolated worker container, paid through the metered Bedrock bridge."""
    import httpx
    from backend.autoclaw_bridge import llm_bridge
    s = get_settings()
    run = _new_run(req.topic, demo=False, uid=uid)
    key = llm_bridge.issue_key(uid, run.run_id, s.claw_run_budget_inr)
    run.log_tail.append(f"[bridge] Live AutoResearchClaw run · Pro engine · budget ₹{s.claw_run_budget_inr:.0f}")
    _save(run)
    async with httpx.AsyncClient(base_url=s.claw_url, headers={"Authorization": f"Bearer {s.claw_token}"}, timeout=60) as c:
        r = await c.post("/runs", json={"topic": req.topic, "llm_key": key, "llm_base_url": "http://backend:8000/internal/llm/v1"})
    if r.status_code != 200:
        llm_bridge.revoke_key(key)
        run.status = "error"
        _save(run)
        raise BridgeError(f"worker refused the run: {r.json().get('error', r.status_code)}")
    run.worker_run_id = r.json()["id"]
    _save(run)
    return await follow(run, key, ctx)


async def follow(run: AutoClawRun, key: str, ctx=None) -> str:
    """Mirror a worker run into our store until it finishes, then import its PDF. Safe to resume after a restart."""
    import httpx
    from backend.autoclaw_bridge import llm_bridge
    s = get_settings()
    wid = run.worker_run_id
    last, misses = 0, 0
    try:
        async with httpx.AsyncClient(base_url=s.claw_url, headers={"Authorization": f"Bearer {s.claw_token}"}, timeout=60) as c:
            while True:
                await asyncio.sleep(10)
                try:
                    resp = await c.get(f"/runs/{wid}")
                except httpx.HTTPError:
                    misses += 1
                    if misses > 30:
                        raise BridgeError("lost contact with the AutoResearchClaw worker")
                    continue
                if resp.status_code == 404:
                    raise BridgeError("the AutoResearchClaw worker restarted and this run was lost; please start it again")
                misses = 0
                st = resp.json()
                run.log_tail = (st.get("log") or [])[-40:]
                for line in st.get("log") or []:
                    m = STAGE_RE.search(line)
                    if m:
                        n = int(m.group(1)) if m.group(1) else STAGES.index(m.group(2).upper()) + 1
                        if 1 <= n <= 23 and n >= last:
                            last = n
                run.spend_inr = llm_bridge.run_spend(key)
                if last:
                    _advance(run, last)
                    if ctx:
                        await ctx.update(STAGES[last - 1], f"Stage {last:02d}/23 {STAGES[last - 1]} · spent ₹{run.spend_inr:.0f}", last / 24)
                _save(run)
                if st["status"] != "running":
                    break
            if st["status"] != "done":
                log_lines = st.get("log") or []
                fail_lines = [l.strip() for l in log_lines if any(k in l.lower() for k in ("failed", "error", "exception")) and not l.startswith("Traceback")]
                detail = fail_lines[-1] if fail_lines else ""
                err_msg = st.get("error") or (f"AutoResearchClaw failed: {detail}" if detail else f"AutoResearchClaw exited with code {st.get('returncode')}; see the log")
                raise BridgeError(err_msg)
            pdf = await c.get(f"/runs/{wid}/pdf", timeout=120)
            if pdf.status_code == 200 and pdf.content[:4] == b"%PDF":
                info = docs.save_bytes(f"autoresearchclaw-{run.run_id}.pdf", pdf.content, title=run.topic)
                run.document_id, run.pdf_path = info.document_id, f"worker:{wid}"
                _own_document(run.run_id, info.document_id)
    except BridgeError as e:
        run.status = "error"
        run.log_tail = (run.log_tail + [f"[bridge] {e}"])[-40:]
        _save(run)
        raise
    finally:
        llm_bridge.revoke_key(key)
    for stg in run.stages:
        stg.status = "done"
    run.status = "done"
    run.spend_inr = llm_bridge.run_spend(key)
    run.log_tail.append(f"[bridge] Done · model spend ₹{run.spend_inr:.0f}")
    _save(run)
    return run.run_id


def resume_live_runs() -> int:
    """On startup: re-attach to live runs that were in progress when the backend stopped; stop the ones we can't."""
    from backend.autoclaw_bridge import llm_bridge
    store = get_store()
    keys = {k.get("run_id"): k for k in store.list("claw_key", 200)}
    key_ids = {rid: k.get("key") for rid, k in keys.items() if k.get("key")}
    for rid, k in keys.items():          # older runs were saved without an owner; their run key records who started them
        if rid and k.get("uid") and not store.owner_of("autoclaw_run", rid):
            store.set_owner("autoclaw_run", rid, k["uid"])
    n = 0
    for raw in store.list("autoclaw_run", 50):
        run = AutoClawRun.model_validate(raw)
        if run.demo or run.status != "running":
            continue
        kid = key_ids.get(run.run_id)
        if run.worker_run_id and kid and not (keys.get(run.run_id) or {}).get("revoked"):
            asyncio.get_event_loop().create_task(_follow_quietly(run, kid))
            n += 1
        else:
            if kid:
                llm_bridge.revoke_key(kid)
            run.status = "error"
            run.log_tail = (run.log_tail + ["[bridge] Interrupted by a server update before it could be resumed; please start the run again."])[-40:]
            _save(run)
    return n


async def _follow_quietly(run: AutoClawRun, key: str) -> None:
    try:
        await follow(run, key, None)
    except BridgeError:
        pass


async def _run_demo(req: AutoClawRequest, ctx, uid: str | None = None) -> str:
    meta_path = DEMO_DIR / "run.json"
    pdf = DEMO_DIR / "deliverables" / "paper.pdf"
    if not meta_path.exists() or not pdf.exists():
        raise BridgeError("Demo run missing: expected demo/autoclaw_run/run.json and deliverables/paper.pdf")
    meta = json.loads(meta_path.read_text())
    run = _new_run(req.topic, demo=True, uid=uid)
    run.provenance = meta["provenance"]
    if req.topic.strip().lower() != meta["topic"].strip().lower():
        run.log_tail.append(f"[demo] Demo mode returns the cached run for “{meta['topic']}”, not the requested topic.")
    for i, name in enumerate(STAGES, 1):
        _advance(run, i)
        run.log_tail = (run.log_tail + [f"[demo replay] Stage {i:02d} {name}"])[-40:]
        _save(run)
        await ctx.update(name, f"[demo replay] Stage {i:02d}/23 {name}", i / 24)
        await asyncio.sleep(meta.get("seconds_per_stage", 0.35))
    for s in run.stages:
        s.status = "done"
    info = docs.save_path(pdf, filename=meta.get("filename", "autoclaw_demo_paper.pdf"))
    run.document_id, run.pdf_path, run.status = info.document_id, str(pdf.relative_to(ROOT)), "done"
    _save(run)
    return run.run_id


async def _run_live(req: AutoClawRequest, ctx, uid: str | None = None) -> str:
    s = get_settings()
    exe = shutil.which(s.autoclaw_bin)
    if not exe:
        raise BridgeError(f"AutoResearchClaw CLI '{s.autoclaw_bin}' not found. Install it (see README) or use demo mode.")
    workdir = Path(s.autoclaw_workdir or s.data_dir / "autoclaw").resolve()
    workdir.mkdir(parents=True, exist_ok=True)
    cmd = [exe, "run", "--topic", req.topic]
    if s.autoclaw_config:
        cmd += ["--config", s.autoclaw_config]
    if req.mode == "auto":
        cmd += ["--auto-approve"]
    else:
        cmd += ["--mode", req.mode]
    run = _new_run(req.topic, demo=False, uid=uid)
    run.log_tail.append("$ " + " ".join(cmd))
    if req.mode != "auto":
        run.log_tail.append(f"[bridge] mode '{req.mode}' pauses for human input: use `researchclaw attach` / "
                            f"`researchclaw approve` on the run folder in {workdir}/artifacts/")
    _save(run)
    before = set(workdir.glob("artifacts/rc-*"))
    proc = await asyncio.create_subprocess_exec(*cmd, cwd=workdir, stdout=asyncio.subprocess.PIPE,
                                                stderr=asyncio.subprocess.STDOUT, stdin=asyncio.subprocess.DEVNULL)
    assert proc.stdout
    async for raw in proc.stdout:
        line = raw.decode(errors="replace").rstrip()
        if not line:
            continue
        run.log_tail = (run.log_tail + [line])[-40:]
        m = STAGE_RE.search(line)
        if m:
            n = int(m.group(1)) if m.group(1) else STAGES.index(m.group(2).upper()) + 1
            if 1 <= n <= 23:
                _advance(run, n)
                await ctx.update(STAGES[n - 1], f"Stage {n:02d}/23 {STAGES[n - 1]}", n / 24)
        _save(run)
    code = await proc.wait()
    if code != 0:
        run.status = "error"
        _save(run)
        raise BridgeError(f"researchclaw exited with code {code}; see log tail")
    new = sorted(set(workdir.glob("artifacts/rc-*")) - before, key=lambda p: p.stat().st_mtime)
    if not new:
        raise BridgeError("researchclaw finished but no new artifacts/rc-* folder was found")
    deliv = new[-1] / "deliverables"
    pdfs = sorted(deliv.rglob("*.pdf"), key=lambda p: p.stat().st_size, reverse=True)
    texs = sorted(deliv.rglob("*.tex"))
    for st in run.stages:
        st.status = "done"
    run.latex_path = str(texs[0]) if texs else None
    if pdfs:
        info = docs.save_path(pdfs[0])
        run.pdf_path, run.document_id = str(pdfs[0]), info.document_id
        _own_document(run.run_id, info.document_id)
    else:
        run.log_tail.append("[bridge] No PDF in deliverables; compile the LaTeX (e.g. Overleaf) and upload it to Audit.")
    run.status = "done"
    _save(run)
    return run.run_id


def _own_document(run_id: str, document_id: str) -> None:
    """The drafted PDF is private to whoever started the run (an unowned document is readable by every user)."""
    store = get_store()
    if uid := store.owner_of("autoclaw_run", run_id):
        store.set_owner("document", document_id, uid)
