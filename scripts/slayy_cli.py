"""Cite and Slayy command line: run the pipelines without the web UI.

    uv run python scripts/slayy_cli.py audit path/to/paper.pdf [--checks refs,retraction]
    uv run python scripts/slayy_cli.py gap "speculative decoding" [--papers 800]
    uv run python scripts/slayy_cli.py warm          # pre-fetch everything the 3-minute demo needs

Results are stored in the same SQLite database the web app uses, so they appear in the UI.
`warm` exists so a flaky venue Wi-Fi cannot break the live demo: every API response the demo
needs is fetched once (real data, with its fetch time) and served from the cache afterwards.
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.autoclaw_bridge import runner as claw  # noqa: E402
from backend.cache.store import get_store  # noqa: E402
from backend.citeguard.audit import run_audit  # noqa: E402
from backend.common.config import ROOT  # noqa: E402
from backend.common.schemas import AuditReport, AuditRequest, AutoClawRequest, GapRadarRequest, JuryRequest  # noqa: E402
from backend.documents import service as docs  # noqa: E402
from backend.gap_radar import pipeline as gap  # noqa: E402
from backend.jury.verdict import run_jury  # noqa: E402

DEMO_FIELD = "parameter-efficient fine-tuning"
DEMO_DOCS = [
    ROOT / "demo/autoclaw_run/deliverables/paper.pdf",
    ROOT / "demo/sample_pdfs/hcq_nanoparticles_covid_preprint.pdf",
    ROOT / "demo/sample_pdfs/retracted_PMC9402320.txt",
    ROOT / "demo/sample_pdfs/clean_speculative_decoding_arXiv2211.17192.pdf",
]


class PrintCtx:
    """Stand-in for the web job context: prints progress to the terminal."""

    async def update(self, stage: str, message: str, progress: float | None = None) -> None:
        pct = f"{progress * 100:5.1f}%" if progress is not None else "      "
        print(f"  [{pct}] {stage:12} {message}", flush=True)


def summarize(audit_id: str) -> None:
    r = AuditReport.model_validate(get_store().get("audit", audit_id))
    s = r.summary
    print(f"\n  audit {audit_id}: integrity {r.score}/100{' (low confidence)' if r.low_confidence else ''}")
    if r.self_status:
        print(f"  paper itself: {r.self_status.retraction} {' '.join(r.self_status.notices)}")
    print(f"  references: {s['verified']} verified, {s['metadata_mismatch']} mismatch, {s['not_found']} not found, "
          f"{s['could_not_verify']} could not verify; retracted citations: {s['retracted_cited']}")
    for ref in r.references:
        if ref.status != "verified" or ref.retraction in ("retracted", "corrected", "expression_of_concern"):
            print(f"    {ref.label:16} {ref.status:18} {ref.retraction:22} {(ref.matched.title if ref.matched else ref.parsed.raw)[:70]}")
    for w in r.warnings:
        print(f"  ! {w}")


async def cmd_audit(path: Path, checks: list[str]) -> str:
    info = docs.save_path(path)
    print(f"Auditing {info.title or info.filename} ({info.n_references} references)")
    audit_id = await run_audit(AuditRequest(document_id=info.document_id, checks=checks), PrintCtx())
    summarize(audit_id)
    return audit_id


async def cmd_gap(query: str, papers: int) -> None:
    print(f"Gap Radar: {query}")
    run_id = await gap.run(GapRadarRequest(query=query, max_papers=papers), PrintCtx())
    run = get_store().get("gap_run", run_id)
    print(f"\n  run {run_id}: {run['n_papers']} papers")
    for c in run["clusters"]:
        print(f"    {c['classification']:13} n={c['size']:4} growth={c['growth'] * 100:5.0f}%  cites/yr={c['cites_per_year']:5.1f}  {c['label']}")


async def cmd_warm() -> None:
    print("1/3 Gap Radar for the demo field")
    await cmd_gap(DEMO_FIELD, 800)
    print("\n2/3 AutoClaw demo replay")
    await claw.run(AutoClawRequest(topic="Gradient-spectral rank allocation for LoRA fine-tuning under a fixed parameter budget",
                                   demo=True), PrintCtx())
    print("\n3/3 CiteGuard + jury on the demo papers")
    for p in DEMO_DOCS:
        audit_id = await cmd_audit(p, ["refs", "retraction", "claims", "phrases", "overlap"])
        info = docs.save_path(p)
        await run_jury(JuryRequest(document_id=info.document_id, audit_id=audit_id), PrintCtx())
    print("\nCache warm. The demo now works from cached (real) API responses.")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("audit")
    a.add_argument("path", type=Path)
    a.add_argument("--checks", default="refs,retraction,claims,phrases,overlap")
    g = sub.add_parser("gap")
    g.add_argument("query")
    g.add_argument("--papers", type=int, default=800)
    sub.add_parser("warm")
    args = ap.parse_args()
    if args.cmd == "audit":
        asyncio.run(cmd_audit(args.path, args.checks.split(",")))
    elif args.cmd == "gap":
        asyncio.run(cmd_gap(args.query, args.papers))
    else:
        asyncio.run(cmd_warm())


if __name__ == "__main__":
    main()
