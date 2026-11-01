"""arXiv export API (Atom). Rate limit: one request every 3 seconds."""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from functools import lru_cache

from backend.common.schemas import Paper
from backend.sources.http import Fetched, SourceClient

BASE = "https://export.arxiv.org/api/query"
NS = {"a": "http://www.w3.org/2005/Atom", "arxiv": "http://arxiv.org/schemas/atom"}


@lru_cache
def client() -> SourceClient:
    return SourceClient("arxiv", min_interval=3.1, max_concurrency=1)


async def search(query: str, start: int = 0, max_results: int = 100) -> Fetched:
    return await client().get(BASE, {
        "search_query": f'all:"{query}"', "start": start, "max_results": max_results,
        "sortBy": "submittedDate", "sortOrder": "descending",
    }, as_text=True)


async def search_relevant(query: str, max_results: int = 40) -> Fetched:
    """Relevance-ranked search matching all the query's words (not the exact phrase)."""
    stop = {"the", "and", "for", "with", "from", "into", "onto", "under", "over", "its", "their", "impact", "effect", "effects",
            "role", "study", "analysis", "approach", "using", "based", "towards", "toward", "via", "new", "novel"}
    words = [w for w in re.findall(r"[A-Za-z0-9-]+", query) if len(w) > 2 and w.lower() not in stop][:4]
    q = " AND ".join(f"all:{w}" for w in words) or f'all:"{query}"'
    return await client().get(BASE, {"search_query": q, "start": 0, "max_results": max_results,
                                     "sortBy": "relevance", "sortOrder": "descending"}, as_text=True)


async def by_id(arxiv_id: str) -> Fetched:
    return await client().get(BASE, {"id_list": arxiv_id}, as_text=True)


def parse_feed(xml_text: str | None) -> list[Paper]:
    if not xml_text:
        return []
    root = ET.fromstring(xml_text)
    out: list[Paper] = []
    for e in root.findall("a:entry", NS):
        raw_id = (e.findtext("a:id", default="", namespaces=NS) or "").strip()
        m = re.search(r"abs/([^v\s]+)", raw_id)
        if not m:
            continue
        aid = m.group(1)
        title = re.sub(r"\s+", " ", e.findtext("a:title", default="", namespaces=NS)).strip()
        if title.lower() == "error":
            continue
        published = e.findtext("a:published", default="", namespaces=NS)
        doi = e.findtext("arxiv:doi", default=None, namespaces=NS)
        out.append(Paper(
            id=f"arxiv:{aid}", title=title, year=int(published[:4]) if published[:4].isdigit() else None,
            doi=doi, url=f"https://arxiv.org/abs/{aid}", venue="arXiv",
            abstract=re.sub(r"\s+", " ", e.findtext("a:summary", default="", namespaces=NS)).strip() or None,
            authors=[a.findtext("a:name", default="", namespaces=NS) for a in e.findall("a:author", NS)],
            date=published[:10] or None, source="arxiv",
        ))
    return out
