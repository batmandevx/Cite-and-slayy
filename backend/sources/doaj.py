"""DOAJ (Directory of Open Access Journals): live journal facts such as time to publication and APC."""
from __future__ import annotations

from functools import lru_cache

from backend.sources.http import SourceClient

BASE = "https://doaj.org/api/search/journals"


@lru_cache
def client() -> SourceClient:
    return SourceClient("doaj", min_interval=0.3, max_concurrency=2)


async def journal(issn: str, max_age: float = 7 * 86400) -> dict | None:
    f = await client().get(f"{BASE}/issn:{issn}", max_age=max_age)
    rows = (f.data or {}).get("results") or []
    if not rows:
        return None
    b = rows[0].get("bibjson") or {}
    apc = (b.get("apc") or {})
    price = (apc.get("max") or [{}])[0] if apc.get("has_apc") else None
    return {
        "weeks_to_publication": b.get("publication_time_weeks"),
        "apc": {"amount": price.get("price"), "currency": price.get("currency")} if price else ({"amount": 0, "currency": None} if apc.get("has_apc") is False else None),
        "waiver": (b.get("waiver") or {}).get("has_waiver"),
        "review": ", ".join((b.get("editorial") or {}).get("review_process") or []) or None,
        "license": ", ".join(x.get("type", "") for x in (b.get("license") or []) if x.get("type")) or None,
        "plagiarism_check": (b.get("plagiarism") or {}).get("detection"),
        "doaj_url": f"https://doaj.org/toc/{issn}",
    }
