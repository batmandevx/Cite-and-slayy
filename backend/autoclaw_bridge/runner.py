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


def _new_run(topic: str, demo: bool) -> AutoClawRun:
    return AutoClawRun(run_id=uuid.uuid4().hex[:12], topic=topic, demo=demo, status="running",
                       stages=[AutoClawStage(number=i + 1, name=n, status="pending") for i, n in enumerate(STAGES)],
                       log_tail=[], created_at=now())


def _advance(run: AutoClawRun, number: int) -> None:
    for s in run.stages:
        if s.number < number:
            s.status = "done"
        elif s.number == number:
            s.status = "running"


def _save(run: AutoClawRun) -> None:
    get_store().put("autoclaw_run", run.run_id, run)


async def run(req: AutoClawRequest, ctx) -> str:
    demo = get_settings().demo_mode if req.demo is None else req.demo
    return await (_run_demo(req, ctx) if demo else _run_live(req, ctx))


async def _run_demo(req: AutoClawRequest, ctx) -> str:
    meta_path = DEMO_DIR / "run.json"
    pdf = DEMO_DIR / "deliverables" / "paper.pdf"
    if not meta_path.exists() or not pdf.exists():
        raise BridgeError("Demo run missing: expected demo/autoclaw_run/run.json and deliverables/paper.pdf")
    meta = json.loads(meta_path.read_text())
    run = _new_run(req.topic, demo=True)
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


async def _run_live(req: AutoClawRequest, ctx) -> str:
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
    run = _new_run(req.topic, demo=False)
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
    else:
        run.log_tail.append("[bridge] No PDF in deliverables; compile the LaTeX (e.g. Overleaf) and upload it to Audit.")
    run.status = "done"
    _save(run)
    return run.run_id
