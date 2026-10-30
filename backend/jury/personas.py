"""Reviewer personas. Each returns structured JSON: score 1-10, top-3 weaknesses, top-3 fixes, confidence."""
from __future__ import annotations

from pydantic import BaseModel, Field

from backend.common.schemas import Paper, PersonaReview
from backend.llm import client as llm


class _Review(BaseModel):
    score: int = Field(ge=1, le=10)
    weaknesses: list[str]
    fixes: list[str]
    confidence: float = Field(ge=0, le=1)
    summary: str


COMMON = """You are one member of a reviewer jury assessing a research paper before submission.
Score 1-10 (10 = ready for a strong venue). List exactly 3 weaknesses (most important first) and exactly 3
concrete fixes an author could act on, each tied to a specific section/claim in the paper.
confidence (0-1) is how sure you are given only the text provided (e.g. lower it if figures/tables are missing).
Base everything on the paper text supplied; quote or point to passages. Do not invent results, citations or facts."""

PERSONAS: dict[str, str] = {
    "Methods": "Focus: soundness of the method and experiments - baselines, ablations, statistics, sample sizes, "
               "whether conclusions follow from evidence, threats to validity.",
    "Novelty": "Focus: originality relative to prior work. You are given a list of real related papers retrieved "
               "from OpenAlex; judge overlap with them explicitly, citing them by title. Do not claim other prior work exists.",
    "Clarity": "Focus: writing and presentation - structure, definitions, notation, figures/tables referenced, "
               "abstract-to-conclusion consistency, grammar and readability.",
    "Ethics & Reproducibility": "Focus: data/code availability, experimental details needed to reproduce, compute "
               "reporting, limitations section, ethical risks, consent/licensing of data, conflicts of interest.",
}


def venue_prompt(venue: str) -> str:
    return (f"Focus: fit for the venue '{venue}'. Judge scope, contribution type, length/format and rigour expectations "
            f"typical for this venue. You have no access to the venue's current call for papers, so say so where "
            f"specific requirements matter and lower confidence accordingly.")


async def review(persona: str, focus: str, title: str | None, body: str, related: list[Paper] | None = None) -> PersonaReview:
    rel = ""
    if related:
        rel = "\n\nRelated papers retrieved from OpenAlex (real records):\n" + "\n".join(
            f"- {p.title} ({p.year}, {p.venue or 'n/a'}): {(p.abstract or '')[:300]}" for p in related)
    prompt = f"Paper title: {title or 'unknown'}\n\n--- PAPER TEXT ---\n{body}\n--- END ---{rel}"
    try:
        out = await llm.complete_json(f"{COMMON}\n\nYour persona: {persona}. {focus}", prompt, _Review, effort="medium")
    except llm.LLMError as e:
        return PersonaReview(persona=persona, error=str(e))
    return PersonaReview(persona=persona, score=out.score, weaknesses=out.weaknesses[:3], fixes=out.fixes[:3],
                         confidence=out.confidence, summary=out.summary)
