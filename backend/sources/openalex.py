"""OpenAlex API: bulk paper retrieval for Gap Radar, metadata fallback, venues."""
from __future__ import annotations

from functools import lru_cache
from typing import AsyncIterator
from urllib.parse import quote

from backend.common.config import get_settings
from backend.common.schemas import Paper
from backend.sources.http import Fetched, SourceClient

BASE = "https://api.openalex.org"
SELECT = ("id,doi,title,publication_year,publication_date,cited_by_count,authorships,"
          "abstract_inverted_index,primary_location,is_retracted,type")


@lru_cache
def client() -> SourceClient:
    s = get_settings()
    return SourceClient("openalex", min_interval=0.12,
                        default_params={"mailto": s.contact_email, "api_key": s.openalex_api_key})


def reconstruct_abstract(inv: dict | None) -> str | None:
    if not inv:
        return None
    pos: list[tuple[int, str]] = [(i, w) for w, idxs in inv.items() for i in idxs]
    return " ".join(w for _, w in sorted(pos)) or None


def to_paper(w: dict) -> Paper:
    doi = (w.get("doi") or "").replace("https://doi.org/", "") or None
    loc = w.get("primary_location") or {}
    src = loc.get("source") or {}
    return Paper(
        id=(w.get("id") or "").replace("https://openalex.org/", ""),
        title=(w.get("title") or "").strip(), year=w.get("publication_year"), doi=doi,
        url=w.get("id"), venue=src.get("display_name"), cited_by=w.get("cited_by_count"),
        abstract=reconstruct_abstract(w.get("abstract_inverted_index")),
        authors=[(a.get("author") or {}).get("display_name", "") for a in w.get("authorships") or []],
        date=w.get("publication_date"), source="openalex",
    )


async def work_by_doi(doi: str) -> Fetched:
    return await client().get(f"{BASE}/works/doi:{quote(doi, safe='/')}", {"select": SELECT})


async def search_title(title: str, per_page: int = 5) -> Fetched:
    return await client().get(f"{BASE}/works", {"search": title[:300], "per-page": per_page, "select": SELECT})


async def iter_search(query: str, from_year: int, max_results: int) -> AsyncIterator[tuple[list[dict], Fetched]]:
    """Paged search over title+abstract. Cursor paging needs an API key; without one, use page=N."""
    use_cursor = bool(get_settings().openalex_api_key)
    cursor, page, got = "*", 1, 0
    while got < max_results:
        params = {
            "search": query,
            "filter": f"from_publication_date:{from_year}-01-01,has_abstract:true,type:article|preprint|conference-paper",
            "per-page": 200, "select": SELECT,
        }
        params.update({"cursor": cursor} if use_cursor else {"page": page})
        f = await client().get(f"{BASE}/works", params)
        results = (f.data or {}).get("results", [])
        if not results:
            return
        got += len(results)
        yield results, f
        page += 1
        cursor = ((f.data or {}).get("meta") or {}).get("next_cursor")
        if use_cursor and not cursor:
            return


async def related_works(query: str, per_page: int = 25) -> Fetched:
    return await client().get(f"{BASE}/works", {"search": query[:400], "per-page": per_page, "select": SELECT})


async def trend(phrase: str, from_year: int = 2015) -> tuple[dict[int, int], Fetched]:
    """Publication counts per year for an exact phrase in title/abstract (a real, reproducible trend experiment)."""
    phrase = phrase.replace('"', "").strip()
    f = await client().get(f"{BASE}/works", {
        "filter": f'title_and_abstract.search:"{phrase}",from_publication_date:{from_year}-01-01',
        "group_by": "publication_year",
    })
    counts = {int(g["key"]): int(g["count"]) for g in (f.data or {}).get("group_by", []) if str(g.get("key", "")).isdigit()}
    return dict(sorted(counts.items())), f


async def works_by_ids(ids: list[str], select: str = SELECT) -> Fetched:
    """Up to 50 works by OpenAlex W-id in one request."""
    ids = [i.rsplit("/", 1)[-1] for i in ids if i][:50]
    return await client().get(f"{BASE}/works", {"filter": "openalex_id:" + "|".join(ids), "per-page": 50, "select": select})


async def referenced_ids(ids: list[str]) -> dict[str, list[str]]:
    """{work id: [ids of the works it cites]} for up to 50 works (used for citation snowballing)."""
    f = await works_by_ids(ids, select="id,referenced_works")
    return {(w.get("id") or "").rsplit("/", 1)[-1]: [r.rsplit("/", 1)[-1] for r in w.get("referenced_works") or []]
            for w in (f.data or {}).get("results", [])}


async def find_source(name: str) -> Fetched:
    """Journals / conferences by name (for a target venue's style)."""
    return await client().get(f"{BASE}/sources", {"search": name[:200], "per-page": 3,
                                                   "select": "id,display_name,type,works_count,host_organization_name"})


async def recent_in_source(source_id: str, from_year: int, n: int = 12) -> Fetched:
    sid = source_id.rsplit("/", 1)[-1]
    return await client().get(f"{BASE}/works", {
        "filter": f"primary_location.source.id:{sid},from_publication_date:{from_year}-01-01,has_abstract:true,type:article|conference-paper",
        "sort": "publication_date:desc", "per-page": n, "select": SELECT + ",referenced_works_count"})
