"""One-click "Slay it" pipeline: draft (AutoClaw) → CiteGuard audit → Reviewer Jury, as a single job."""
from __future__ import annotations

import uuid

from pydantic import BaseModel

from backend.autoclaw_bridge import runner as claw
from backend.cache.store import get_store, now
from backend.citeguard.audit import run_audit
from backend.common.schemas import AuditRequest, AutoClawRequest, JuryRequest
from backend.jury.verdict import run_jury


class PipelineRequest(BaseModel):
    topic: str | None = None          # draft a new paper with AutoClaw...
    document_id: str | None = None    # ...or audit an existing document
    demo: bool | None = None
    venue: str | None = None


class PipelineResult(BaseModel):
    pipeline_id: str
    autoclaw_run_id: str | None
    document_id: str
    audit_id: str
    review_id: str


class _Scaled:
    """Maps a sub-job's 0..1 progress into [lo, hi] of the pipeline, prefixing the stage name."""

    def __init__(self, ctx, label: str, lo: float, hi: float):
        self.ctx, self.label, self.lo, self.hi = ctx, label, lo, hi

    async def update(self, stage: str, message: str, progress: float | None = None) -> None:
        p = None if progress is None else self.lo + (self.hi - self.lo) * progress
        await self.ctx.update(f"{self.label}:{stage}", message, p)


async def run(req: PipelineRequest, ctx) -> str:
    if not req.topic and not req.document_id:
        raise ValueError("Give a topic to draft, or a document_id to audit.")
    run_id = None
    document_id = req.document_id
    if not document_id:
        run_id = await claw.run(AutoClawRequest(topic=req.topic or "", demo=req.demo), _Scaled(ctx, "draft", 0.0, 0.3))
        document_id = (get_store().get("autoclaw_run", run_id) or {}).get("document_id")
        if not document_id:
            raise ValueError("AutoClaw finished without a PDF to audit.")
    audit_id = await run_audit(AuditRequest(document_id=document_id), _Scaled(ctx, "audit", 0.3, 0.75))
    review_id = await run_jury(JuryRequest(document_id=document_id, audit_id=audit_id, venue=req.venue),
                               _Scaled(ctx, "verdict", 0.75, 1.0))
    res = PipelineResult(pipeline_id=uuid.uuid4().hex[:12], autoclaw_run_id=run_id, document_id=document_id,
                         audit_id=audit_id, review_id=review_id)
    get_store().put("pipeline", res.pipeline_id, res)
    await ctx.update("done", "Pipeline complete", 1.0)
    return res.pipeline_id
