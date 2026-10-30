"""Reviewer Jury + Go/No-Go verdict.

Rules (evaluated in order; thresholds shown in the UI):
  DON'T SUBMIT if  the paper itself is retracted
                or ≥3 references are Not found (fabrication pattern)
                or integrity < 50
                or jury weighted mean < 5
  REVISE (floor) if any reference is Not found or any cited work is retracted
  SUBMIT        if jury weighted mean ≥ 7 AND every persona ≥ 5 AND integrity ≥ 80 AND no floor rule fired
  otherwise     REVISE
Weighted mean = Σ(score·confidence) / Σ(confidence) over personas that returned a review.
Submit needs both a CiteGuard audit and at least one jury review; missing inputs can only lead to Revise / Don't submit.
"""
from __future__ import annotations

import asyncio
import uuid

from backend.cache.store import get_store, now
from backend.citeguard.overlap import related_papers
from backend.common.schemas import AuditReport, ChecklistItem, JuryRequest, PersonaReview, RankedFix, Verdict
from backend.documents import service as docs
from backend.documents.parser import one_line
from backend.embeddings.model import embed_async
from backend.jury import checklist, personas, venues
from backend.llm import client as llm

RULES = [
    "Don't submit: the paper itself is retracted",
    "Don't submit: ≥ 3 references not found in Crossref / Semantic Scholar / OpenAlex",
    "Don't submit: integrity score < 50",
    "Don't submit: jury weighted mean < 5",
    "Revise (floor): any reference not found, or any cited work retracted",
    "Submit: weighted mean ≥ 7, every persona ≥ 5, integrity ≥ 80, at least one content (LLM) reviewer, no floor rule",
    "Otherwise: Revise",
]
MAX_BODY_CHARS = 150_000


def decide(audit: AuditReport | None, reviews: list[PersonaReview]) -> tuple[str, list[str], float | None]:
    scored = [r for r in reviews if r.score is not None and r.confidence is not None]
    wsum = sum(r.confidence for r in scored)
    mean = (sum(r.score * r.confidence for r in scored) / wsum) if wsum else None
    integrity = audit.score if audit else None
    s = audit.summary if audit else {}
    fired: list[str] = []
    dont = []
    if s.get("self_retracted"):
        dont.append(RULES[0])
    if s.get("not_found", 0) >= 3:
        dont.append(RULES[1] + f" ({s['not_found']} not found)")
    if integrity is not None and integrity < 50:
        dont.append(RULES[2] + f" ({integrity:.0f})")
    if mean is not None and mean < 5:
        dont.append(RULES[3] + f" ({mean:.1f})")
    if dont:
        return "dont_submit", dont, mean
    if s.get("not_found", 0) or s.get("retracted_cited", 0):
        fired.append(RULES[4] + f" (not found: {s.get('not_found', 0)}, retracted cited: {s.get('retracted_cited', 0)})")
    if audit is None:
        fired.append("No CiteGuard audit: Submit requires an integrity check")
    elif audit.low_confidence:
        fired.append("Low-confidence CiteGuard audit (>30% of references could not be verified): Submit requires verified references")
    content = [r for r in scored if r.persona != checklist.NAME]
    if mean is None:
        fired.append("No jury reviews available: Submit requires the jury")
    elif not content:
        fired.append("Only the rule-based checklist reviewed this paper (no LLM available): Submit requires a content reviewer")
    ok = (not fired and mean is not None and mean >= 7 and all(r.score >= 5 for r in scored)
          and integrity is not None and integrity >= 80)
    if ok:
        return "submit", [RULES[5] + f" (mean {mean:.1f}, integrity {integrity:.0f})"], mean
    if not fired:
        why = []
        if mean is not None and mean < 7:
            why.append(f"mean {mean:.1f} < 7")
        low = [r.persona for r in scored if r.score < 5]
        if low:
            why.append("persona below 5: " + ", ".join(low))
        if integrity is not None and integrity < 80:
            why.append(f"integrity {integrity:.0f} < 80")
        fired.append(RULES[6] + (f" ({'; '.join(why)})" if why else ""))
    return "revise", fired, mean


def citeguard_fixes(audit: AuditReport) -> list[RankedFix]:
    out: list[RankedFix] = []
    ss = audit.self_status
    if ss and ss.retraction == "retracted":
        out.append(RankedFix(rank=0, fix=f"This paper has been retracted (notice: {', '.join(ss.notices) or 'see Crossref'}). "
                             "It should not be submitted or cited.", source="citeguard", priority=100, blocking=True))
    for r in audit.references:
        if r.retraction == "retracted":
            out.append(RankedFix(rank=0, fix=f"Replace retracted citation {r.label} “{r.matched.title if r.matched else r.parsed.raw[:80]}” "
                                 f"(notice {', '.join(r.retraction_notices)}).", source="citeguard", priority=90, blocking=True))
        if r.status == "not_found":
            out.append(RankedFix(rank=0, fix=f"Reference {r.label} could not be found in Crossref, Semantic Scholar or OpenAlex. "
                                 f"Verify it exists or remove it: “{r.parsed.raw[:120]}”", source="citeguard", priority=85, blocking=True))
        elif r.status == "metadata_mismatch":
            diffs = "; ".join(f"{d.field}: paper says {d.in_paper!r}, record says {d.in_record!r}" for d in r.mismatches)
            out.append(RankedFix(rank=0, fix=f"Correct metadata of {r.label} ({diffs}).", source="citeguard", priority=55))
        if r.retraction in ("corrected", "expression_of_concern"):
            out.append(RankedFix(rank=0, fix=f"Cited work {r.label} has a {r.retraction.replace('_', ' ')} "
                                 f"({', '.join(r.retraction_notices)}); check the citation still holds.", source="citeguard", priority=50))
    for c in audit.claims:
        if c.label == "unsupported":
            out.append(RankedFix(rank=0, fix=f"p.{c.page + 1}: “{c.sentence[:140]}” cites ref {c.ref_index}, but its abstract "
                                 f"does not support this ({c.rationale})", source="citeguard", priority=70))
    for h in audit.phrases:
        out.append(RankedFix(rank=0, fix=f"p.{h.page + 1}: replace “{h.phrase}” with the established term “{h.expected}”.",
                             source="citeguard", priority=60))
    for o in audit.overlaps:
        out.append(RankedFix(rank=0, fix=f"p.{o.page + 1}: review paragraph for possible overlap with “{o.matched.title}” "
                             f"(similarity {o.similarity:.2f}); paraphrase and cite.", source="citeguard", priority=40))
    return out


async def persona_fixes(reviews: list[PersonaReview]) -> list[RankedFix]:
    raw = []
    for r in reviews:
        if r.score is None:
            continue
        for k, fx in enumerate(r.fixes):
            raw.append(RankedFix(rank=0, fix=fx, source=r.persona,
                                 priority=round((10 - r.score) * (r.confidence or 0.5) * (1 - 0.1 * k) * 8, 2)))
    if len(raw) < 2:
        return raw
    vecs = await embed_async([f.fix for f in raw])
    keep: list[int] = []
    for i in sorted(range(len(raw)), key=lambda i: -raw[i].priority):
        if all(float(vecs[i] @ vecs[j]) < 0.85 for j in keep):
            keep.append(i)
        else:
            j = next(j for j in keep if float(vecs[i] @ vecs[j]) >= 0.85)
            if raw[i].source not in raw[j].source:
                raw[j].source += f" + {raw[i].source}"
    return [raw[i] for i in keep]


async def run_jury(req: JuryRequest, ctx) -> str:
    parsed = docs.get_parsed(req.document_id)
    audit = None
    audit_id = req.audit_id
    if audit_id:
        a = get_store().get("audit", audit_id)
        cand = AuditReport.model_validate(a) if a else None
        if cand and cand.document_id == req.document_id:
            audit = cand
        else:
            audit_id = None
    if audit is None:
        ref = get_store().get("audit_by_doc", req.document_id)
        if ref and ref.get("audit_id"):
            a = get_store().get("audit", ref["audit_id"])
            cand = AuditReport.model_validate(a) if a else None
            if cand and cand.document_id == req.document_id:
                audit = cand

    end = parsed.refs_at
    body_pages = parsed.pages[: end[0] + 1] if end else parsed.pages
    if end:
        body_pages[-1] = body_pages[-1][: end[1]]
    body = one_line("\n".join(body_pages))
    if len(body) > MAX_BODY_CHARS:
        raise ValueError(f"Paper body is {len(body)} characters; above the {MAX_BODY_CHARS} limit for one review.")
    full_len, limit = len(body), llm.context_chars()
    condensed = full_len > limit
    if condensed:  # small local models: keep the opening (abstract, intro, method) and the ending (results, conclusion)
        head = int(limit * 0.65)
        body = body[:head] + "\n\n[… middle of the paper omitted for the local model's context window …]\n\n" + body[-(limit - head):]

    await ctx.update("related", "Fetching related work and venue data from OpenAlex", 0.05)
    related, _ = await related_papers(parsed.title, parsed.doi, limit=10)
    venue_list, vwarn = await venues.suggest(parsed.title)

    await ctx.update("checklist", "Running the rule-based readiness checklist", 0.12)
    check_review, check_items = checklist.review(parsed, audit)
    reviews: list[PersonaReview] = [check_review]
    if llm.available():
        roster = list(personas.PERSONAS.items())
        if req.venue:
            roster.append((f"Venue: {req.venue}", personas.venue_prompt(req.venue)))
        await ctx.update("jury", f"{len(roster)} reviewers reading the paper", 0.2)
        done = 0

        async def one(name, focus):
            nonlocal done
            r = await personas.review(name, focus, parsed.title, body, related if name == "Novelty" else None)
            done += 1
            await ctx.update("jury", f"{name} reviewer finished ({done}/{len(roster)})", 0.2 + 0.6 * done / len(roster))
            return r

        reviews += list(await asyncio.gather(*(one(n, f) for n, f in roster)))
    else:
        reviews += [PersonaReview(persona=n, error="No LLM available (set an API key or run Ollama locally)") for n in personas.PERSONAS]

    await ctx.update("verdict", "Combining jury scores with CiteGuard results", 0.9)
    decision, fired, mean = decide(audit, reviews)
    fixes = (citeguard_fixes(audit) if audit else []) + await persona_fixes(reviews)
    fixes.sort(key=lambda f: (not f.blocking, -f.priority))
    for i, f in enumerate(fixes, 1):
        f.rank = i
    if vwarn:
        fired.append(f"Note: {vwarn}")
    v = Verdict(review_id=uuid.uuid4().hex[:12], document_id=req.document_id, audit_id=audit.audit_id if audit else None,
                decision=decision, personas=reviews, weighted_mean=round(mean, 2) if mean is not None else None,
                integrity=audit.score if audit else None, triggered_rules=fired, rules=RULES,
                ranked_fixes=fixes, venue_suggestions=venue_list, venue=req.venue,
                checklist=[ChecklistItem(name=c.name, passed=c.passed, detail=c.detail) for c in check_items],
                llm={**llm.public_describe(), "condensed": condensed, "chars_read": min(full_len, limit), "chars_total": full_len},
                created_at=now())
    get_store().put("verdict", v.review_id, v)
    return v.review_id
