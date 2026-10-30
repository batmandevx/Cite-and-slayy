"""Check 4: tortured phrases, matched against data/tortured_phrases.csv.

CSV columns: tortured,expected,source,source_url,verified_by,added_at
Entries come only from published sources (see `source_url`). Rows with an empty
`verified_by` are "pending team verification"; set TORTURED_REQUIRE_VERIFIED=true
to ignore them. Import more with scripts/import_pps.py.
"""
from __future__ import annotations

import csv
import os
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from backend.common.config import ROOT
from backend.common.schemas import PhraseHit

CSV_PATH = ROOT / "data" / "tortured_phrases.csv"
FIELDS = ["tortured", "expected", "source", "source_url", "verified_by", "added_at"]


@dataclass(frozen=True)
class Phrase:
    tortured: str
    expected: str
    source: str
    source_url: str | None
    verified_by: str | None
    pattern: re.Pattern


def _compile(phrase: str) -> re.Pattern:
    words = [re.escape(w) for w in phrase.lower().split()]
    # tolerate line breaks / hyphenation between words and a plural "s" at the end
    return re.compile(r"\b" + r"[\s\-]+".join(words) + r"s?\b", re.I)


@lru_cache
def load_phrases(path: Path = CSV_PATH) -> tuple[Phrase, ...]:
    if not path.exists():
        return ()
    require = os.getenv("TORTURED_REQUIRE_VERIFIED", "false").lower() == "true"
    out = []
    with path.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            t = (row.get("tortured") or "").strip()
            if not t or t.startswith("#"):
                continue
            vb = (row.get("verified_by") or "").strip() or None
            if require and not vb:
                continue
            out.append(Phrase(t, (row.get("expected") or "").strip(), (row.get("source") or "").strip(),
                              (row.get("source_url") or "").strip() or None, vb, _compile(t)))
    return tuple(out)


def find_phrases(pages: list[str], refs_at: tuple[int, int] | None) -> list[PhraseHit]:
    hits: list[PhraseHit] = []
    for pi, text in enumerate(pages):
        if refs_at and pi > refs_at[0]:
            break
        limit = refs_at[1] if refs_at and pi == refs_at[0] else len(text)
        for ph in load_phrases():
            for m in ph.pattern.finditer(text, 0, limit):
                ctx = re.sub(r"\s+", " ", text[max(0, m.start() - 80): m.end() + 80])
                hits.append(PhraseHit(phrase=ph.tortured, expected=ph.expected, page=pi, start=m.start(),
                                      end=m.end(), context=ctx, source=ph.source, source_url=ph.source_url,
                                      verified_by=ph.verified_by))
    return hits
