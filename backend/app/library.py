"""Library: trending + latest papers, open books, AI research ideas. Legal sources only.

- Trending: OpenAlex works published in the last N days, sorted by citations, with open-access PDF links when they exist.
- Latest: newest arXiv preprints (free PDFs by design).
- Books: Open Library titles with *public* full-text access on the Internet Archive.
- Ideas: LLM-generated research ideas grounded in the trending papers shown (ids validated, as in Gap Radar).
"""
from __future__ import annotations

from datetime import date, timedelta
from functools import lru_cache

from pydantic import BaseModel

from backend.llm import client as llm
from backend.sources import arxiv, openalex
from backend.sources.http import SourceClient

SELECT = openalex.SELECT + ",best_oa_location,open_access,concepts"


async def trending(query: str, days: int = 365, limit: int = 12) -> list[dict]:
    since = (date.today() - timedelta(days=days)).isoformat()
    filt = f"from_publication_date:{since},has_abstract:true"
    params = {"filter": filt, "sort": "cited_by_count:desc", "per-page": limit, "select": SELECT}
    if query.strip():
        q = query.strip().replace(",", " ").replace('"', "")
        term = f'"{q}"' if " " in q else q   # quoted = phrase match, so "diffusion models" skips unrelated "diffusion"
        params["filter"] = filt + f",title_and_abstract.search:{term}"
    f = await openalex.client().get(f"{openalex.BASE}/works", params)
    out = []
    for w in (f.data or {}).get("results", []):
        p = openalex.to_paper(w)
        oa = w.get("best_oa_location") or {}
        out.append({"id": p.id, "title": p.title, "year": p.year, "date": p.date, "venue": p.venue, "cited_by": p.cited_by,
                    "authors": p.authors[:3], "abstract": (p.abstract or "")[:420],
                    "read_url": f"https://doi.org/{p.doi}" if p.doi else p.url,
                    "pdf_url": oa.get("pdf_url"), "is_oa": (w.get("open_access") or {}).get("is_oa", False)})
    return out


async def latest(query: str, limit: int = 12) -> list[dict]:
    f = await arxiv.search(query or "machine learning", 0, limit)
    out = []
    for p in arxiv.parse_feed(f.data):
        aid = p.id.split(":", 1)[1]
        out.append({"id": p.id, "title": p.title, "date": p.date, "authors": p.authors[:3], "abstract": (p.abstract or "")[:420],
                    "read_url": f"https://arxiv.org/abs/{aid}", "pdf_url": f"https://arxiv.org/pdf/{aid}", "is_oa": True, "venue": "arXiv"})
    return out


@lru_cache
def _ol() -> SourceClient:
    return SourceClient("openalex", min_interval=0.3)   # reuse the cached HTTP layer for Open Library


async def books(query: str, limit: int = 12) -> list[dict]:
    f = await _ol().get("https://openlibrary.org/search.json", {
        "q": query or "research methods", "ebook_access": "public", "has_fulltext": "true", "limit": limit,
        "fields": "title,author_name,first_publish_year,ia,key,cover_i"})
    out = []
    for d in (f.data or {}).get("docs", []):
        ia = (d.get("ia") or [None])[0]
        if not ia:
            continue
        out.append({"title": d.get("title"), "authors": (d.get("author_name") or [])[:2], "year": d.get("first_publish_year"),
                    "read_url": f"https://archive.org/details/{ia}", "openlibrary_url": f"https://openlibrary.org{d.get('key')}",
                    "cover": f"https://covers.openlibrary.org/b/id/{d['cover_i']}-M.jpg" if d.get("cover_i") else None})
    return out


class _Idea(BaseModel):
    title: str
    pitch: str
    method: str
    evidence_ids: list[int]


class _Ideas(BaseModel):
    ideas: list[_Idea]


async def ideas(query: str) -> dict:
    papers = await trending(query, days=540, limit=15)
    if not papers:
        return {"ideas": [], "papers": []}
    listing = "\n".join(f"[{i}] {p['title']} ({p.get('year')}): {p['abstract'][:300]}" for i, p in enumerate(papers, 1))
    out = await llm.complete_json(
        "You suggest fresh, feasible research ideas grounded ONLY in the numbered papers provided. Cite 1-3 of them by number.",
        f"Field: {query}\nRecent highly-cited papers:\n{listing}\n\nPropose 4 research ideas a small team could start in 3 months. "
        "For each: a catchy title, a 1-2 sentence pitch, and a concrete first experiment (method).", _Ideas, effort="medium")
    good = []
    for idea in out.ideas:
        ids = [i for i in idea.evidence_ids if 1 <= i <= len(papers)]
        if ids:
            good.append({"title": idea.title, "pitch": idea.pitch, "method": idea.method,
                         "evidence": [{"title": papers[i - 1]["title"], "url": papers[i - 1]["read_url"]} for i in dict.fromkeys(ids)]})
    return {"ideas": good, "dropped": len(out.ideas) - len(good)}
