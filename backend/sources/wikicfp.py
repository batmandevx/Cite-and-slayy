"""WikiCFP: live calls for papers (upcoming conferences and their submission deadlines). Parsed from the public
search page; results are refreshed every few hours."""
from __future__ import annotations

import html
import re
from datetime import date, datetime
from functools import lru_cache

from backend.sources.http import SourceClient

BASE = "http://www.wikicfp.com/cfp/servlet/tool.search"
SITE = "http://www.wikicfp.com"
_ROW = re.compile(
    r'<td rowspan="2" align="left"><a href="(?P<href>/cfp/servlet/event\.showcfp\?eventid=\d+)[^"]*">(?P<acr>[^<]+)</a></td>\s*'
    r'<td align="left" colspan="3">(?P<name>[^<]*)</td></tr>\s*<tr[^>]*>\s*'
    r'<td align="left">(?P<when>[^<]*)</td>\s*<td align="left">(?P<where>[^<]*)</td>\s*<td align="left">(?P<deadline>[^<]*)</td>', re.S)
_DATE = re.compile(r"[A-Z][a-z]{2} \d{1,2}, \d{4}")


@lru_cache
def client() -> SourceClient:
    return SourceClient("wikicfp", min_interval=1.5, max_concurrency=1)


def _d(s: str) -> date | None:
    try:
        return datetime.strptime(s.strip(), "%b %d, %Y").date()
    except ValueError:
        return None


def parse(page: str | None) -> list[dict]:
    """Events from a WikiCFP search page: acronym, name, url, start/end, where, deadline(s)."""
    out = []
    for m in _ROW.finditer(page or ""):
        when = [_d(x) for x in _DATE.findall(m["when"])]
        deadlines = sorted(d for d in (_d(x) for x in _DATE.findall(m["deadline"])) if d)
        out.append({
            "acronym": html.unescape(m["acr"]).strip(),
            "name": html.unescape(m["name"]).strip(),
            "url": SITE + html.unescape(m["href"]),
            "start": when[0].isoformat() if when and when[0] else None,
            "end": when[-1].isoformat() if len(when) > 1 and when[-1] else None,
            "where": html.unescape(m["where"]).strip() or None,
            "deadlines": [d.isoformat() for d in deadlines],
        })
    return out


async def search(query: str, max_age: float = 6 * 3600) -> list[dict]:
    """Upcoming events matching the query (WikiCFP 'future' filter)."""
    f = await client().get(BASE, {"q": query[:120], "year": "f"}, as_text=True, max_age=max_age)
    return parse(f.data)
