"""Originality fixer: for each possible-overlap paragraph in an audit, rewrite it in original words and credit the source.

This is how overlap is properly fixed: paraphrase plus attribution. The citation uses the matched work's real metadata
(first-author surname and year from OpenAlex). Shared wording with the matched sentence is measured before and after,
so the user can see the change; every rewrite is a suggestion the author reviews and pastes.
"""
from __future__ import annotations

import asyncio
import re

from pydantic import BaseModel

from backend.llm import client as llm
from backend.sources import openalex
from backend.sources.http import SourceError

SYSTEM = ("You help an author fix possible overlap with a published source. Rewrite the paragraph in clearly original "
          "wording and sentence structure, keep its meaning, technical accuracy and length, and attribute ideas taken from "
          "the source with the given in-text citation. Do not add new claims, numbers or references. Return only the paragraph.")


def wording_overlap(text: str, source: str, n: int = 3) -> float:
    """Share of the source sentence's n-word sequences that also appear in the text (what similarity checkers look at)."""
    def grams(t: str) -> set[str]:
        w = re.findall(r"[a-z0-9]+", t.lower())
        return {" ".join(w[i:i + n]) for i in range(len(w) - n + 1)}
    src = grams(source)
    return round(len(src & grams(text)) / len(src), 3) if src else 0.0


class _Out(BaseModel):
    paragraph: str


async def _citation(matched: dict) -> str:
    year = matched.get("year") or "n.d."
    surname = None
    if matched.get("doi"):
        try:
            f = await openalex.work_by_doi(matched["doi"])
            authors = openalex.to_paper(f.data).authors if f.data else []
            if authors:
                surname = authors[0].split()[-1]
                if len(authors) > 1:
                    surname += " et al."
        except SourceError:
            surname = None
    if not surname:
        title = (matched.get("title") or "Source").split(":")[0]
        surname = f"“{title[:50]}”"
    return f"({surname}, {year})"


async def fix(audit: dict, limit: int = 10) -> dict:
    overlaps = (audit.get("overlaps") or [])[:limit]

    async def one(o: dict) -> dict:
        cite = await _citation(o["matched"])
        try:
            out = await llm.complete_json(SYSTEM, f"IN-TEXT CITATION TO USE: {cite}\nSOURCE TITLE: {o['matched'].get('title')}\n"
                                                  f"SOURCE SENTENCE IT RESEMBLES: {o['matched_text']}\n\nPARAGRAPH:\n{o['paragraph']}",
                                          _Out, effort="low", tier="fast")
            new = out.paragraph.strip()
        except llm.LLMError as e:
            return {"original": o["paragraph"], "rewritten": None, "error": llm.scrub(str(e))[:160], "citation": cite,
                    "source": o["matched"], "before": wording_overlap(o["paragraph"], o["matched_text"]), "after": None}
        if cite not in new:   # make sure the source is credited
            new = re.sub(r"([.!?])\s*$", f" {cite}\\1", new) if re.search(r"[.!?]\s*$", new) else f"{new} {cite}"
        before, after = wording_overlap(o["paragraph"], o["matched_text"]), wording_overlap(new, o["matched_text"])
        return {"original": o["paragraph"], "rewritten": new, "citation": cite, "source": o["matched"],
                "before": round(before, 3), "after": round(after, 3), "page": o.get("page")}

    paragraphs = await asyncio.gather(*(one(o) for o in overlaps))
    phrases = [{"found": p["phrase"], "use": p["expected"], "context": p["context"], "page": p.get("page")}
               for p in (audit.get("phrases") or [])]
    return {"paragraphs": paragraphs, "phrases": phrases,
            "note": "Review each suggestion before pasting it into your paper, and keep the added citations."}
