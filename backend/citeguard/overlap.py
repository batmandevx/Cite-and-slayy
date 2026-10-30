"""Check 5: possible-overlap hotspots.

Each body paragraph is embedded and compared against the abstracts of (a) the cited works
and (b) top related works from OpenAlex. Paragraphs above the threshold are flagged as
"possible overlap", with the most similar abstract sentence shown. This is a pointer for a
human to look at, not a plagiarism finding.
"""
from __future__ import annotations

import re

from rapidfuzz import fuzz

from backend.common.schemas import OverlapHit, Paper, PaperRef
from backend.documents.parser import Paragraph, norm
from backend.embeddings.model import embed_async
from backend.sources import openalex
from backend.sources.http import SourceError

THRESHOLD = 0.85   # calibrated on the demo papers: same-topic abstracts sit around 0.75-0.82


def is_same_work(a: str, b: str) -> bool:
    """Same work under a slightly different title (preprint vs. published, 'Retracted:' prefix, subtitle)."""
    na, nb = norm(a).replace("retracted ", ""), norm(b).replace("retracted ", "")
    if not na or not nb:
        return False
    short = min(len(na), len(nb))
    return fuzz.ratio(na, nb) >= 90 or (short >= 40 and fuzz.partial_ratio(na, nb) >= 95)


async def related_papers(title: str | None, own_doi: str | None, limit: int = 10) -> tuple[list[Paper], str | None]:
    if not title:
        return [], None
    try:
        f = await openalex.related_works(title, per_page=limit + 5)
    except SourceError as e:
        return [], f"related-work lookup failed: {e.reason}"
    out = []
    for w in (f.data or {}).get("results", []):
        p = openalex.to_paper(w)
        if not p.abstract:
            continue
        if own_doi and p.doi and p.doi.lower() == own_doi.lower():
            continue
        if is_same_work(p.title, title):
            continue  # the paper itself (or its published version)
        out.append(p)
    return out[:limit], None


def _sentences(text: str) -> list[str]:
    return [s for s in re.split(r"(?<=[.!?])\s+", text) if len(s.split()) >= 6]


async def find_overlaps(paragraphs: list[Paragraph], cited: list[Paper], related: list[Paper],
                        threshold: float = THRESHOLD) -> list[OverlapHit]:
    corpus = [(p, "cited") for p in cited if p.abstract] + [(p, "related") for p in related if p.abstract]
    if not paragraphs or not corpus:
        return []
    pv = await embed_async([p.text for p in paragraphs])
    av = await embed_async([p.abstract or "" for p, _ in corpus])
    sims = pv @ av.T
    hits: list[OverlapHit] = []
    for i, para in enumerate(paragraphs):
        j = int(sims[i].argmax())
        s = float(sims[i, j])
        if s < threshold:
            continue
        paper, rel = corpus[j]
        sents = _sentences(paper.abstract or "") or [paper.abstract or ""]
        sv = await embed_async(sents)
        best = sents[int((pv[i:i + 1] @ sv.T).argmax())]
        hits.append(OverlapHit(
            paragraph=para.text, page=para.page, start=para.start, end=para.end, similarity=round(s, 3),
            matched=PaperRef(id=paper.id, title=paper.title, year=paper.year, doi=paper.doi, url=paper.url,
                             venue=paper.venue, cited_by=paper.cited_by),
            matched_text=best, relation=rel))
    return hits
