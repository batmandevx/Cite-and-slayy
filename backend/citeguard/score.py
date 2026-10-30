"""Integrity score (0-100). Every term is returned with its formula and inputs so the UI can show its work.

    refs     = 40 * (verified + 0.5*mismatch) / checkable        checkable = verified+mismatch+not_found
    claims   = 30 * (supported + 0.5*unclear) / assessed          assessed  = LLM-labelled claims whose abstract was found
    phrases  = 15 * max(0, 1 - hits/3)
    overlap  = 15 * (1 - flagged/total_paragraphs)

    score = 100 * sum(available terms) / sum(max of available terms)  -  15 * retracted_cited
    A term is "available" only if its check ran and had something to assess.
    The uploaded paper being retracted sets the score to 0.
    low_confidence if >30% of references could not be verified, or fewer than 2 terms are available.
"""
from __future__ import annotations

from backend.common.schemas import ClaimCheck, OverlapHit, PhraseHit, ReferenceCheck, ScoreTerm, SelfStatus


def compute(refs: list[ReferenceCheck], claims: list[ClaimCheck], phrases: list[PhraseHit] | None,
            overlaps: list[OverlapHit] | None, n_paragraphs: int, self_status: SelfStatus | None,
            ran: set[str]) -> tuple[float, list[ScoreTerm], bool]:
    terms: list[ScoreTerm] = []
    count = lambda xs, k: sum(1 for x in xs if x == k)

    st = [r.status for r in refs]
    v, mm, nf, cnv = count(st, "verified"), count(st, "metadata_mismatch"), count(st, "not_found"), count(st, "could_not_verify")
    checkable = v + mm + nf
    if "refs" in ran and checkable:
        terms.append(ScoreTerm(name="References", value=round(40 * (v + 0.5 * mm) / checkable, 2), max=40,
                               formula="40 × (verified + 0.5·mismatch) / (verified + mismatch + not_found)",
                               inputs={"verified": v, "mismatch": mm, "not_found": nf, "could_not_verify": cnv}))

    # Claims without a fetchable abstract carry no evidence either way: shown, but not scored.
    labels = [c.label for c in claims if c.cited_abstract]
    sup, unc, uns = count(labels, "supported"), count(labels, "unclear"), count(labels, "unsupported")
    assessed = sup + unc + uns
    if "claims" in ran and assessed:
        terms.append(ScoreTerm(name="Claim support", value=round(30 * (sup + 0.5 * unc) / assessed, 2), max=30,
                               formula="30 × (supported + 0.5·unclear) / assessed",
                               inputs={"supported": sup, "unclear": unc, "unsupported": uns,
                                       "not_assessed": count(labels, "not_assessed"),
                                       "no_abstract": sum(1 for c in claims if not c.cited_abstract)}))

    if "phrases" in ran and phrases is not None:
        h = len(phrases)
        terms.append(ScoreTerm(name="Tortured phrases", value=round(15 * max(0.0, 1 - h / 3), 2), max=15,
                               formula="15 × max(0, 1 − hits/3)", inputs={"hits": h}))

    if "overlap" in ran and overlaps is not None and n_paragraphs:
        fl = len({(o.page, o.start) for o in overlaps})
        terms.append(ScoreTerm(name="Overlap", value=round(15 * (1 - fl / n_paragraphs), 2), max=15,
                               formula="15 × (1 − flagged_paragraphs / paragraphs)",
                               inputs={"flagged_paragraphs": fl, "paragraphs": n_paragraphs}))

    retracted_cited = sum(1 for r in refs if r.retraction == "retracted")
    if terms:
        base = 100 * sum(t.value for t in terms) / sum(t.max for t in terms)
    else:
        base = 0.0
    penalty = 15 * retracted_cited
    if retracted_cited:
        terms.append(ScoreTerm(name="Retracted citations", value=-penalty, max=0,
                               formula="−15 × retracted cited works", inputs={"retracted_cited": retracted_cited}))
    score = max(0.0, base - penalty)
    if self_status and self_status.retraction == "retracted":
        terms.append(ScoreTerm(name="Paper itself retracted", value=-score, max=0,
                               formula="score set to 0 when the uploaded paper is retracted",
                               inputs={"self_retracted": 1}))
        score = 0.0
    total_refs = len(refs) or 1
    low_conf = (cnv / total_refs > 0.3) or len([t for t in terms if t.max > 0]) < 2
    return round(score, 1), terms, low_conf
