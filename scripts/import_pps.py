"""Import tortured phrases from a Problematic Paper Screener (PPS) export into data/tortured_phrases.csv.

The PPS (https://www.irit.fr/~Guillaume.Cabanac/problematic-paper-screener) publishes its
tortured-phrase fingerprints. Download the list yourself, then:

    uv run python scripts/import_pps.py path/to/export.csv \
        --tortured-col "tortured phrase" --expected-col "expected phrase" \
        --source "Problematic Paper Screener" --source-url "<the URL you downloaded it from>"

Rows are appended (deduplicated, case-insensitive) with an empty `verified_by`, so they show as
"pending team verification" until someone signs them off. Nothing is invented: every row must
come from the file you pass in. Use --dry-run to preview.
"""
from __future__ import annotations

import argparse
import csv
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "data" / "tortured_phrases.csv"
FIELDS = ["tortured", "expected", "source", "source_url", "verified_by", "added_at"]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("export", type=Path)
    ap.add_argument("--tortured-col", required=True)
    ap.add_argument("--expected-col", required=True)
    ap.add_argument("--source", required=True)
    ap.add_argument("--source-url", required=True)
    ap.add_argument("--delimiter", default=",")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    existing: list[dict] = []
    if TARGET.exists():
        with TARGET.open(newline="", encoding="utf-8") as f:
            existing = list(csv.DictReader(f))
    seen = {r["tortured"].strip().lower() for r in existing}

    new: list[dict] = []
    with a.export.open(newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f, delimiter=a.delimiter)
        missing = {a.tortured_col, a.expected_col} - set(reader.fieldnames or [])
        if missing:
            sys.exit(f"Columns not found in export: {missing}. Available: {reader.fieldnames}")
        for row in reader:
            t, e = (row[a.tortured_col] or "").strip(), (row[a.expected_col] or "").strip()
            if not t or not e or t.lower() in seen:
                continue
            seen.add(t.lower())
            new.append({"tortured": t, "expected": e, "source": a.source, "source_url": a.source_url,
                        "verified_by": "", "added_at": date.today().isoformat()})

    print(f"{len(new)} new phrases ({len(existing)} already in {TARGET.relative_to(ROOT)})")
    for r in new[:10]:
        print(f"  {r['tortured']!r} -> {r['expected']!r}")
    if a.dry_run or not new:
        return
    with TARGET.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        w.writerows(existing + new)
    print("Written.")


if __name__ == "__main__":
    main()
