"""CiteGuard orchestrator: runs the selected checks and assembles the AuditReport."""
from __future__ import annotations

import uuid

from backend.cache.store import get_store, now
from backend.citeguard import claims as claims_mod
from backend.citeguard import overlap as overlap_mod
from backend.citeguard import phrases as phrases_mod
from backend.citeguard import resolver, score
from backend.common.schemas import AuditReport, AuditRequest, Highlight, Paper
from backend.documents import service as docs


async def run_audit(req: AuditRequest, ctx) -> str:
    parsed = docs.get_parsed(req.document_id)
    ran = set(req.checks)
    warnings = list(parsed.warnings)

    async def prog(stage: str, lo: float, hi: float):
        async def cb(done: int, total: int):
            await ctx.update(stage, f"{stage}: {done}/{total}", lo + (hi - lo) * done / max(total, 1))
        return cb

    await ctx.update("self-status", "Checking whether this paper itself has been retracted", 0.02)
    self_status = await resolver.self_status(parsed.title, parsed.doi) if ran & {"refs", "retraction"} else None

    refs, resolved = [], {}
    if "refs" in ran or "retraction" in ran or "claims" in ran:
        await ctx.update("references", f"Resolving {len(parsed.references)} references via Crossref / Semantic Scholar / OpenAlex", 0.05)
        out = await resolver.resolve_all(parsed.references, check_retraction="retraction" in ran,
                                         on_progress=await prog("references", 0.05, 0.5))
        refs = [c for c, _ in out]
        resolved = {c.ref_index: p for c, p in out if p is not None}
        if "refs" not in ran:
            ran.add("refs")  # results were computed anyway; show them

    claim_checks = []
    if "claims" in ran and parsed.references and not parsed.citations:
        warnings.append("No in-text citations could be linked to references (e.g. superscript numbering), "
                        "so claim support was not assessed for this paper.")
    if "claims" in ran:
        await ctx.update("claims", f"Comparing {min(len(parsed.citations), req.max_claims)} citing sentences with cited abstracts", 0.5)
        claim_checks, w = await claims_mod.check_claims(parsed.citations, resolved, req.max_claims,
                                                        on_progress=await prog("claims", 0.55, 0.8))
        warnings += w

    phrase_hits = None
    if "phrases" in ran:
        await ctx.update("phrases", "Scanning for tortured phrases", 0.8)
        phrase_hits = phrases_mod.find_phrases(parsed.pages, parsed.refs_at)
        if not phrases_mod.load_phrases():
            warnings.append("Tortured-phrase list is empty (data/tortured_phrases.csv).")

    overlaps = None
    if "overlap" in ran:
        await ctx.update("overlap", "Comparing paragraphs with cited and related abstracts", 0.85)
        cited: list[Paper] = []
        for p in resolved.values():
            if not p.abstract:
                abstract, _ = await claims_mod.fetch_abstract(p)
                p = p.model_copy(update={"abstract": abstract})
            cited.append(p)
        related, w = await overlap_mod.related_papers(parsed.title, parsed.doi)
        if w:
            warnings.append(w)
        overlaps = await overlap_mod.find_overlaps(parsed.paragraphs, cited, related)

    highlights: list[Highlight] = []
    for i, c in enumerate(claim_checks):
        kind = {"supported": "claim_supported", "unsupported": "claim_unsupported"}.get(c.label, "claim_unclear")
        highlights.append(Highlight(page=c.page, start=c.start, end=c.end, kind=kind, ref=f"claim:{i}"))
    for i, h in enumerate(phrase_hits or []):
        highlights.append(Highlight(page=h.page, start=h.start, end=h.end, kind="phrase", ref=f"phrase:{i}"))
    for i, o in enumerate(overlaps or []):
        highlights.append(Highlight(page=o.page, start=o.start, end=o.end, kind="overlap", ref=f"overlap:{i}"))

    s, terms, low = score.compute(refs, claim_checks, phrase_hits, overlaps, len(parsed.paragraphs), self_status, ran)
    st = [r.status for r in refs]
    summary = {
        "references": len(refs),
        "verified": st.count("verified"), "metadata_mismatch": st.count("metadata_mismatch"),
        "not_found": st.count("not_found"), "could_not_verify": st.count("could_not_verify"),
        "retracted_cited": sum(r.retraction == "retracted" for r in refs),
        "corrected_cited": sum(r.retraction in ("corrected", "expression_of_concern") for r in refs),
        "claims": len(claim_checks),
        "supported": sum(c.label == "supported" for c in claim_checks),
        "unclear": sum(c.label == "unclear" for c in claim_checks),
        "unsupported": sum(c.label == "unsupported" for c in claim_checks),
        "phrases": len(phrase_hits or []),
        "overlaps": len(overlaps or []),
        "self_retracted": int(bool(self_status and self_status.retraction == "retracted")),
    }
    report = AuditReport(
        audit_id=uuid.uuid4().hex[:12], document_id=req.document_id, checks_run=sorted(ran),
        self_status=self_status, references=refs, claims=claim_checks, phrases=phrase_hits or [],
        overlaps=overlaps or [], highlights=highlights, score=s, score_terms=terms, low_confidence=low,
        warnings=warnings, summary=summary, created_at=now())
    get_store().put("audit", report.audit_id, report)
    get_store().put("audit_by_doc", req.document_id, {"audit_id": report.audit_id})
    return report.audit_id
