"""Export saved Paper Studio papers to LaTeX, compile them, and report what would look wrong on Overleaf.

    .venv/bin/python scripts/latex_check.py                    # the 6 newest papers, IEEE template
    .venv/bin/python scripts/latex_check.py --ids a1,b2 --template plain --pages 3

Needs `tectonic` on PATH (brew install tectonic). Tectonic runs XeTeX, which accepts any Unicode, while Overleaf's default
is pdfLaTeX, which does not: so characters pdfLaTeX can't typeset are reported separately from the compile log.
Per paper it reports: compile errors, overfull boxes (text past the margin) and their worst width, undefined
references/citations, unsafe Unicode left in the .tex, figures, tables and pages. With --pages N it renders the first
N pages (and every page holding a table) to PNG next to the .tex for a visual check.
"""
from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.app import export as exporter  # noqa: E402
from backend.cache.store import get_store  # noqa: E402
from backend.paper_studio import studio  # noqa: E402

OUT = Path(__file__).resolve().parents[1] / "var" / "latex_check"
_FIG = re.compile(r"/api/paper-studio/([0-9a-f]+)/fig/([a-z0-9_]+)\.png")
PDFLATEX_OK = set(range(32, 127)) | {10, 13, 9}


def export_markdown(pid: str) -> tuple[str, str]:
    """The markdown the browser sends to the exporter (what GET /api/paper-studio/{pid} returns to a paid user)."""
    p = get_store().get("paper_studio", pid)
    md = studio.ensure_keywords(studio.repair_fences(p.get("markdown", "")), p.get("keywords") or [])
    if p.get("_facts") is not None:
        allowed = studio._allowed_numbers(p.get("_facts", ""), *((r.get("abstract") or "") for r in p.get("_refs") or []))
        md, _ = studio.strip_unmeasured_tables(md, allowed)
    return p["title"], md


def check(pid: str, template: str, pages: int) -> dict:
    title, md = export_markdown(pid)
    assets = exporter.Assets()
    for m in _FIG.finditer(md):
        png = studio.figure_png(m.group(1), m.group(2))
        if png:
            assets.images[m.group(0)] = png
    d = OUT / f"{pid}-{template}"
    shutil.rmtree(d, ignore_errors=True)
    d.mkdir(parents=True)
    with zipfile.ZipFile(__import__("io").BytesIO(exporter.latex_zip(md, title, template, "A. Author", "University", assets))) as z:
        z.extractall(d)
    tex = (d / "main.tex").read_text()
    bad = sorted({c for c in tex if ord(c) not in PDFLATEX_OK})
    proc = subprocess.run(["tectonic", "--keep-logs", "--chatter", "minimal", "main.tex"], cwd=d, capture_output=True, text=True, timeout=600)
    log = (d / "main.log").read_text(errors="ignore") if (d / "main.log").exists() else proc.stderr
    over = [float(x) for x in re.findall(r"Overfull \\hbox \(([\d.]+)pt too wide\)", log)]
    errors = re.findall(r"^! (.+)$", log, re.M) + ([proc.stderr.strip()[-400:]] if proc.returncode else [])
    row = {"id": pid, "title": title[:70], "ok": proc.returncode == 0, "errors": errors[:5],
           "overfull": len(over), "worst_overfull_pt": max(over, default=0),
           "undefined_refs": len(re.findall(r"(Citation|Reference) `[^']+' .*undefined", log)),
           "non_ascii": "".join(bad)[:80], "figures": tex.count("\\includegraphics"), "tables": tex.count("\\begin{tabular"),
           "placeholder_diagrams": tex.count("Diagram: export the Mermaid source")}
    pdf = d / "main.pdf"
    if pdf.exists():
        import fitz
        doc = fitz.open(pdf)
        row["pages"] = doc.page_count
        want = set(range(min(pages, doc.page_count)))
        if pages:
            want |= {i for i in range(doc.page_count) if "Table" in doc[i].get_text()[:20000] and i < 30}
        for i in sorted(want):
            doc[i].get_pixmap(dpi=70).save(d / f"page{i + 1:02d}.png")
    return row


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ids", default="")
    ap.add_argument("--template", default="ieee", choices=["ieee", "springer", "plain"])
    ap.add_argument("--pages", type=int, default=0)
    ap.add_argument("-n", type=int, default=6)
    a = ap.parse_args()
    ids = [x for x in a.ids.split(",") if x] or [r[0] for r in get_store()._conn.execute(
        "SELECT id FROM objects WHERE kind='paper_studio' ORDER BY updated_at DESC LIMIT ?", (a.n,)).fetchall()]
    for pid in ids:
        r = check(pid, a.template, a.pages)
        print(r, flush=True)


if __name__ == "__main__":
    main()
