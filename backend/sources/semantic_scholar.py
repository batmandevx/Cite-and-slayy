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


async def search(query: str, limit: int = 40) -> Fetched:
    """Keyword search over papers (relevance-ranked)."""
    return await client().get(f"{BASE}/paper/search", {"query": query[:300], "fields": FIELDS, "limit": limit})


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


# ---------- keyed features (Paper Studio quality) ----------

ENRICH = "paperId,corpusId,externalIds,tldr,influentialCitationCount,citationCount,publicationTypes,openAccessPdf"


def s2_id(p: Paper) -> str | None:
    """An id the Graph API accepts for one of our papers."""
    if p.id.startswith("s2:"):
        return p.id[3:]
    if p.doi:
        return f"DOI:{p.doi}"
    m = (p.url or "") + " " + p.id
    import re
    a = re.search(r"arxiv\.org/abs/([\w.\-/]+?)(?:v\d+)?(?:\s|$)|arxiv:([\w.\-/]+)", m, re.I)
    return f"ARXIV:{a.group(1) or a.group(2)}" if a else None


async def batch(ids: list[str], fields: str = ENRICH) -> list[dict | None]:
    """Up to 500 papers in one request (keyed: counts as one request against the 1/s limit). None where not found."""
    if not ids:
        return []
    f = await client().post_json(f"{BASE}/paper/batch", {"ids": ids[:500]}, {"fields": fields})
    return list(f.data or [])


async def recommend(positive: list[str], limit: int = 40) -> list[Paper]:
    """Papers similar to a set of known-good papers (S2's recommender; catches what keyword search misses)."""
    f = await client().post_json(f"{REC}/papers", {"positivePaperIds": positive[:10]}, {"fields": FIELDS, "limit": limit})
    return [to_paper(p) for p in (f.data or {}).get("recommendedPapers", []) or []]


async def snippets(query: str, corpus_ids: list[str] | None = None, limit: int = 3) -> list[dict]:
    """Passages from papers' full text (or abstract) matching the query, optionally limited to given papers.
    Returns [{"text", "section", "corpus_id", "title"}]."""
    params = {"query": query[:500], "limit": limit}
    if corpus_ids:
        params["paperIds"] = ",".join(f"CorpusId:{c}" for c in corpus_ids[:20])
    f = await client().get(f"{BASE}/snippet/search", params)
    out = []
    for d in (f.data or {}).get("data", []) or []:
        sn, pp = d.get("snippet") or {}, d.get("paper") or {}
        if sn.get("text"):
            out.append({"text": sn["text"], "section": sn.get("section") or sn.get("snippetKind") or "",
                        "corpus_id": str(pp.get("corpusId") or ""), "title": pp.get("title") or "", "score": d.get("score")})
    return out
