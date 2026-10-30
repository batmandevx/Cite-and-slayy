"""'Where to submit': venues where the most similar real papers were published (OpenAlex)."""
from __future__ import annotations

from collections import defaultdict

from backend.citeguard.overlap import is_same_work
from backend.common.schemas import VenueCount
from backend.sources import openalex
from backend.sources.http import SourceError

SKIP_TYPES = {"repository"}   # arXiv, institutional repositories, etc.


async def suggest(title: str | None, k: int = 30) -> tuple[list[VenueCount], str | None]:
    if not (title or "").strip():
        return [], "no title to search with"
    queries = [title.strip()]
    if ":" in title:   # "ACRONYM: descriptive title" - coined acronyms match nothing
        queries.append(title.split(":", 1)[1].strip())
    best: list[VenueCount] = []
    for q in queries:
        try:
            found = await _search(q, title, k)
        except SourceError as e:
            return best, f"venue lookup failed: {e.reason}"
        if len(found) > len(best):
            best = found
        if len(best) >= 3:
            break
    return best, None


async def _search(query: str, title: str, k: int) -> list[VenueCount]:
    f = await openalex.related_works(query, per_page=k)
    groups: dict[str, dict] = defaultdict(lambda: {"count": 0, "titles": [], "id": None})
    for w in (f.data or {}).get("results", []):
        if is_same_work(w.get("title") or "", title):
            continue
        src = ((w.get("primary_location") or {}).get("source")) or {}
        name = src.get("display_name")
        if not name or src.get("type") in SKIP_TYPES:
            continue
        g = groups[name]
        g["count"] += 1
        g["id"] = (src.get("id") or "").replace("https://openalex.org/", "") or None
        if len(g["titles"]) < 3:
            g["titles"].append(w.get("title") or "")
    ranked = sorted(groups.items(), key=lambda kv: -kv[1]["count"])[:6]
    return [VenueCount(venue=n, count=g["count"], example_titles=g["titles"], openalex_source_id=g["id"])
            for n, g in ranked]
