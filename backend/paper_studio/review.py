"""Reviewer panel: three aspect-specialist reviewers, each on a different model family, score a draft against a calibrated
rubric and list concrete, quotable problems. The pipeline revises the sections they flag, then the panel scores again.

Why this shape (see the research notes in the quality README):
- aspect-specific reviewers give far more specific comments than one generic reviewer (MARG: generic comments 60% -> 29%);
- reviewer models differ in harshness, so mixing families gives a fairer average (Agents4Science 2025);
- an explicit calibration scale keeps scores comparable between runs.
"""
from __future__ import annotations

import asyncio
import re
import statistics
from typing import Literal

from pydantic import BaseModel, Field

from backend.llm import client as llm

CALIBRATION = (
    "Score calibration (1-10): 3 = clear reject (major flaws); 5 = borderline workshop paper; 6 = solid workshop / weak journal paper; "
    "7 = good journal paper; 8 = strong journal paper; 9-10 = exceptional, reserve. Typical AI-drafted papers score 4-6: they overclaim, "
    "repeat themselves, cite loosely and use generic prose. Be strict and specific; never inflate."
)


class Issue(BaseModel):
    section: str = Field(description="The top-level section heading the problem is in, exactly as written")
    quote: str = Field(description="An exact short quote (5-25 words) copied from that section that shows the problem")
    problem: str
    fix: str = Field(description="A concrete instruction for how to fix it")
    severity: Literal["major", "minor"]


class Review(BaseModel):
    scores: dict[str, int] = Field(description="Score 1-10 for each rubric dimension, keyed by dimension name")
    overall: int = Field(description="Overall score 1-10")
    summary: str = Field(description="Two sentences: main strength and main weakness")
    issues: list[Issue] = Field(description="Up to 6 of the most important problems, most severe first")


# role, model preference (different families), rubric dimensions, what to look for
REVIEWERS: list[tuple[str, list[str], list[str], str]] = [
    ("soundness", ["us.anthropic.claude-sonnet-4-6"], ["soundness", "evidence"],
     "You check technical and logical soundness: are definitions, equations, proofs and arguments correct and internally consistent? "
     "Is every claim supported by the cited work or the reported measurements, without overclaiming? Are limitations honest?"),
    ("significance", ["moonshotai.kimi-k2.5"], ["novelty", "significance", "positioning"],
     "You judge novelty and significance: is the research question sharp and worth answering? Is the contribution clearly "
     "differentiated from the cited prior work, or is it a renamed version of it? Is the related work a real synthesis that "
     "compares and contrasts, rather than a list of summaries?"),
    ("clarity", ["us.anthropic.claude-haiku-4-5-20251001-v1:0"], ["clarity", "coherence", "concision"],
     "You judge presentation: is the paper easy to follow, with one thread of argument from introduction to conclusion? "
     "Flag repetition across sections, inconsistent terminology or notation, filler and generic sentences, vague claims, "
     "and figures or tables that are introduced but not discussed."),
]


def _clip(md: str, limit: int) -> str:
    return md if len(md) <= limit else md[:limit] + "\n\n[... truncated ...]"


async def _one(role: str, prefer: list[str], dims: list[str], focus: str, md: str, kind: str) -> Review | None:
    from datetime import date
    system = (f"You are an experienced, demanding peer reviewer for a {kind}. Today's date is {date.today():%d %B %Y}: works "
              f"dated {date.today().year} or earlier are not from the future. {focus}\n{CALIBRATION}\n"
              "Quote the paper exactly when you point at a problem. Do not comment on formatting of the Markdown itself.")
    prompt = (f"Rubric dimensions to score: {', '.join(dims)}.\n\nPAPER:\n{_clip(md, llm.context_chars() - 6000)}\n\n"
              "Return scores for every rubric dimension, an overall score, a two-sentence summary and up to 6 issues.")
    try:
        r = await llm.complete_json(system, prompt, Review, effort="medium", max_tokens=4000, prefer=prefer)
    except llm.LLMError:
        return None
    r.scores = {k: max(1, min(10, int(v))) for k, v in r.scores.items() if k in dims} or {d: r.overall for d in dims}
    r.overall = max(1, min(10, int(r.overall)))
    return r


async def panel(md: str, kind: str = "research paper") -> dict:
    """Run the three reviewers in parallel. Returns {"overall", "scores", "reviews": {role: Review}, "issues": [...]}"""
    out = await asyncio.gather(*(_one(role, prefer, dims, focus, md, kind) for role, prefer, dims, focus in REVIEWERS))
    reviews = {role: r for (role, *_), r in zip(REVIEWERS, out) if r}
    if not reviews:
        return {"overall": None, "scores": {}, "reviews": {}, "issues": []}
    scores: dict[str, int] = {}
    for r in reviews.values():
        scores.update(r.scores)
    issues = [dict(i.model_dump(), reviewer=role) for role, r in reviews.items() for i in r.issues]
    issues.sort(key=lambda i: i["severity"] != "major")
    return {"overall": round(statistics.mean(r.overall for r in reviews.values()), 2), "scores": scores,
            "reviews": {k: {"overall": v.overall, "summary": v.summary, "scores": v.scores} for k, v in reviews.items()},
            "issues": issues}


def issues_by_section(issues: list[dict], sections: list[tuple[str, str]]) -> dict[str, list[dict]]:
    """Map each issue to a real section heading. The quote decides when it is found verbatim; otherwise the reviewer's
    section name is matched loosely (reviewers sometimes paraphrase headings)."""
    norm = {re.sub(r"\W+", " ", h).strip().lower(): h for h, _ in sections}
    squash = lambda t: re.sub(r"\s+", " ", t).strip().lower()   # noqa: E731
    out: dict[str, list[dict]] = {}
    for i in issues:
        q = squash(i.get("quote", ""))
        h = next((hd for hd, body in sections if q and len(q) > 12 and q in squash(body)), None)
        if not h:
            key = re.sub(r"\W+", " ", i.get("section", "")).strip().lower()
            h = norm.get(key) or next((v for k, v in norm.items() if key and (key in k or k in key)), None)
        if h:
            out.setdefault(h, []).append(i)
    return out
