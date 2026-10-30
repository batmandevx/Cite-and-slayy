"""Crossref REST API: DOI resolution, bibliographic matching, retraction/correction status."""
from __future__ import annotations

from functools import lru_cache
from urllib.parse import quote

from backend.common.config import get_settings
from backend.common.schemas import Paper
from backend.sources.http import Fetched, SourceClient

BASE = "https://api.crossref.org"

# Crossref update types that matter for integrity.
UPDATE_TYPES = {
    "retraction": "retracted",
    "withdrawal": "retracted",
    "removal": "retracted",
    "partial_retraction": "retracted",
    "correction": "corrected",
    "erratum": "corrected",
    "corrigendum": "corrected",
    "expression_of_concern": "expression_of_concern",
}


@lru_cache
def client() -> SourceClient:
    s = get_settings()
    # Crossref: the public pool allows little concurrency; the polite pool (mailto) allows more.
    return SourceClient("crossref", min_interval=0.25 if s.contact_email else 0.4,
                        default_params={"mailto": s.contact_email},
                        max_concurrency=3 if s.contact_email else 1)


def doi_url(doi: str) -> str:
    return f"https://doi.org/{doi}"


async def get_work(doi: str) -> Fetched:
    return await client().get(f"{BASE}/works/{quote(doi, safe='/')}")


async def search_bibliographic(text: str, rows: int = 5) -> Fetched:
    return await client().get(f"{BASE}/works", {"query.bibliographic": text[:500], "rows": rows,
                                                "select": "DOI,title,author,issued,container-title,type,updated-by,is-referenced-by-count,volume,page"})


async def updates_for(doi: str) -> Fetched:
    """Notices (retractions, corrections, EoCs) that declare they update `doi`."""
    return await client().get(f"{BASE}/works", {"filter": f"updates:{doi}", "rows": 20,
                                                "select": "DOI,title,type,update-to"})


def first(xs: list | None) -> str | None:
    return xs[0] if xs else None


def year_of(item: dict) -> int | None:
    for k in ("issued", "published", "published-print", "published-online", "created"):
        parts = (item.get(k) or {}).get("date-parts") or []
        if parts and parts[0] and parts[0][0]:
            return int(parts[0][0])
    return None


def to_paper(item: dict) -> Paper:
    doi = item.get("DOI")
    authors = [a.get("family") or a.get("name") or "" for a in item.get("author", [])]
    return Paper(
        id=f"doi:{doi}", doi=doi, title=(first(item.get("title")) or "").strip(),
        year=year_of(item), url=doi_url(doi) if doi else None,
        venue=first(item.get("container-title")), cited_by=item.get("is-referenced-by-count"),
        authors=[a for a in authors if a], source="crossref",
    )


def classify_updates(updated_by: list[dict] | None, notices: list[dict] | None, doi: str) -> tuple[str, list[str], list[dict]]:
    """Combine the work's own `updated-by` field with notices found via `filter=updates:`.

    Returns (status, notice_dois, raw_entries). Status precedence: retracted > eoc > corrected.
    """
    raw: list[dict] = []
    for u in updated_by or []:
        raw.append({"notice_doi": u.get("DOI"), "type": u.get("type"), "source": u.get("source"),
                    "date": ((u.get("updated") or {}).get("date-time"))})
    for n in notices or []:
        for u in n.get("update-to", []):
            if (u.get("DOI") or "").lower() == doi.lower():
                raw.append({"notice_doi": n.get("DOI"), "type": u.get("type"), "source": u.get("source"),
                            "notice_title": first(n.get("title"))})
    kinds = {UPDATE_TYPES.get((r.get("type") or "").lower()) for r in raw} - {None}
    if "retracted" in kinds:
        status = "retracted"
    elif "expression_of_concern" in kinds:
        status = "expression_of_concern"
    elif "corrected" in kinds:
        status = "corrected"
    else:
        status = "none_found"
    notice_dois = sorted({r["notice_doi"] for r in raw if r.get("notice_doi")
                          and r["notice_doi"].lower() != doi.lower()
                          and UPDATE_TYPES.get((r.get("type") or "").lower())})
    return status, notice_dois, raw
