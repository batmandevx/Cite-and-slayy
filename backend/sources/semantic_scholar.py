"""Semantic Scholar Graph API: title matching, abstracts, recommendations."""
from __future__ import annotations

from functools import lru_cache
from urllib.parse import quote

from backend.common.config import get_settings
from backend.common.schemas import Paper
from backend.sources.http import Fetched, SourceClient

BASE = "https://api.semanticscholar.org/graph/v1"
REC = "https://api.semanticscholar.org/recommendations/v1"
FIELDS = "title,year,authors,abstract,externalIds,url,venue,citationCount"


@lru_cache
def client() -> SourceClient:
    s = get_settings()
    headers = {"x-api-key": s.s2_api_key} if s.s2_api_key else {}
    # Keyed: 1 req/s. Unkeyed: shared pool, so be more conservative.
    return SourceClient("semantic_scholar", min_interval=1.05 if s.s2_api_key else 2.0,
                        headers=headers, max_concurrency=1)


async def paper(paper_id: str) -> Fetched:
    """paper_id: 'DOI:...', 'ARXIV:...', or an S2 id."""
    return await client().get(f"{BASE}/paper/{quote(paper_id, safe=':/')}", {"fields": FIELDS})


async def match_title(title: str) -> Fetched:
    return await client().get(f"{BASE}/paper/search/match", {"query": title[:300], "fields": FIELDS})


async def recommendations(paper_id: str, limit: int = 10) -> Fetched:
    return await client().get(f"{REC}/papers/forpaper/{quote(paper_id, safe=':/')}",
                              {"fields": FIELDS, "limit": limit})


def to_paper(p: dict) -> Paper:
    ext = p.get("externalIds") or {}
    doi = ext.get("DOI")
    return Paper(
        id=f"s2:{p.get('paperId')}", title=p.get("title") or "", year=p.get("year"), doi=doi,
        url=p.get("url"), venue=p.get("venue") or None, cited_by=p.get("citationCount"),
        abstract=p.get("abstract"), authors=[a.get("name", "") for a in p.get("authors") or []],
        source="semantic_scholar",
    )
