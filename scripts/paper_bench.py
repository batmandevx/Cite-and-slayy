"""Paper-quality benchmark: generate papers on fixed topics and score them the same way every release.

    .venv/bin/python scripts/paper_bench.py --label baseline            # all topics, in parallel
    .venv/bin/python scripts/paper_bench.py --label v2 --topics 0,2
    .venv/bin/python scripts/paper_bench.py --compare bench/baseline.json bench/v2.json

Scores (higher is better unless marked):
  panel        mean overall score of the 3-reviewer panel (1-10), plus per-dimension scores
  support      share of checked (sentence, citation) pairs whose cited abstract supports the sentence
  unsupported  number of unsupported pairs (lower is better)
  repetition   share of 8-word sequences repeated across sections (lower is better)
  unmeasured   numbers / result claims not backed by measurements, outside design sections (lower is better)
Costs are metered separately for writing the paper and for evaluating it. Needs Bedrock (or another LLM) configured.
Every run spends real money on model calls.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.cache.store import get_store  # noqa: E402
from backend.llm import client as llm  # noqa: E402
from backend.paper_studio import quality, review, studio  # noqa: E402

TOPICS = [
    ("Graph neural networks for traffic forecasting", ""),
    ("Effect of smartphone use before bedtime on adolescent sleep quality", ""),
    ("Large language model tutors in school education: benefits, risks and evidence", ""),
]
OUT = Path(__file__).resolve().parents[1] / "bench"


class Ctx:
    def __init__(self, tag: str):
        self.tag = tag

    async def update(self, stage: str, message: str, progress: float | None = None) -> None:
        try:
            d = json.loads(message)
            if d.get("state") == "done":
                print(f"  [{self.tag}] {d.get('agent')}: {d.get('text', '')[:110]}", flush=True)
        except (ValueError, TypeError):
            pass


def _usd(uid: str) -> float:
    rec = get_store().get("usage", f"{uid}:cost:{datetime.now(timezone.utc):%Y-%m}") or {}
    return round(rec.get("usd", 0.0), 4)


async def bench_one(i: int, label: str, extra: dict) -> dict:
    topic, angle = TOPICS[i]
    tag = f"T{i}"
    llm.set_premium(True)
    run_uid = f"bench:{label}:{i}:{time.time():.0f}"
    llm.set_meter(run_uid)
    t0 = time.time()
    fields = set(studio.StudioRequest.model_fields)
    req = studio.StudioRequest(topic=topic, angle=angle, max_refs=32, **{k: v for k, v in extra.items() if k in fields})
    print(f"[{tag}] writing: {topic}", flush=True)
    pid = await studio.run(req, Ctx(tag))
    if isinstance(pid, str) and pid.startswith("pl"):          # co-pilot plans: write straight through for the benchmark
        pid = await studio.write_from_plan(pid, {}, Ctx(tag))
    secs = round(time.time() - t0)
    write_usd = _usd(run_uid)
    rec = get_store().get("paper_studio", pid)
    md, refs = rec["markdown"], rec.get("_refs") or []

    eval_uid = run_uid + ":eval"
    llm.set_meter(eval_uid)
    print(f"[{tag}] evaluating ({secs}s to write, ${write_usd})", flush=True)
    panel, claims = await asyncio.gather(review.panel(md), quality.check_all_claims(md, refs, cap=160))
    allowed = studio._allowed_numbers(rec.get("_facts", ""), *((r.get("abstract") or "") for r in refs))
    # same rules as the pipeline: prose paragraphs only, and each paper type's design sections are exempt
    from backend.paper_studio.paper_types import PLANS
    design = {x.heading for x in PLANS.get(rec.get("paper_type") or "method", PLANS["method"]).sections if x.design} | studio.DESIGN_SECTIONS
    unmeasured = sum(len(studio._unmeasured(t, allowed, rec.get("_method", ""))) for st, _, t in studio._paragraphs(md)
                     if studio._section_of(md, st) not in design and not studio._section_of(md, st).lower().startswith(("references", "abstract")))
    return {
        "topic": topic, "paper_id": pid, "title": rec.get("title"), "seconds": secs, "words": rec.get("words"),
        "references": len(refs), "write_usd": write_usd, "eval_usd": _usd(eval_uid),
        "panel": panel["overall"], "panel_scores": panel["scores"], "panel_reviews": panel["reviews"],
        "panel_issues": panel["issues"][:12],
        "support": claims["support_rate"], "checked": claims["checked"], "unsupported": claims["unsupported"],
        "synthesis_flags": len(claims["synthesis_flags"]), "repetition": quality.repetition_rate(md),
        "unmeasured": unmeasured, "paper_type": rec.get("paper_type", "method (legacy)"),
    }


def show(rows: list[dict], title: str) -> None:
    print(f"\n== {title} ==")
    print(f"{'topic':42} {'panel':>5} {'support':>7} {'unsup':>5} {'rep%':>5} {'unmeas':>6} {'words':>6} {'refs':>4} {'min':>4} {'$':>6}")
    for r in rows:
        print(f"{r['topic'][:42]:42} {r['panel'] or 0:5.2f} {r['support'] or 0:7.2f} {r['unsupported']:5d} "
              f"{100 * r['repetition']:5.1f} {r['unmeasured']:6d} {r['words'] or 0:6d} {r['references']:4d} "
              f"{r['seconds'] / 60:4.1f} {r['write_usd']:6.2f}")


def compare(a_path: str, b_path: str) -> None:
    a, b = json.loads(Path(a_path).read_text()), json.loads(Path(b_path).read_text())
    show(a["rows"], f"A: {a['label']}")
    show(b["rows"], f"B: {b['label']}")
    keys = [("panel", "+"), ("support", "+"), ("unsupported", "-"), ("repetition", "-"), ("unmeasured", "-"), ("write_usd", "-")]
    print("\nmean change B - A:")
    for k, better in keys:
        va = [r[k] for r in a["rows"] if r.get(k) is not None]
        vb = [r[k] for r in b["rows"] if r.get(k) is not None]
        if va and vb:
            d = sum(vb) / len(vb) - sum(va) / len(va)
            print(f"  {k:12} {sum(va) / len(va):8.3f} -> {sum(vb) / len(vb):8.3f}  ({'+' if d >= 0 else ''}{d:.3f}, {better} is better)")


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--label", default="run")
    ap.add_argument("--topics", default="")
    ap.add_argument("--compare", nargs=2)
    ap.add_argument("--no-cache", action="store_true", help="ignore cached model replies so costs are real")
    ap.add_argument("--extra", default="{}", help="JSON of extra StudioRequest fields, e.g. '{\"copilot\": false}'")
    args = ap.parse_args()
    if args.compare:
        compare(*args.compare)
        return
    if args.no_cache:
        store = get_store()
        orig = store.get
        store.get = lambda kind, id: None if kind == "llm_cache" else orig(kind, id)   # type: ignore[method-assign]
    idx = [int(x) for x in args.topics.split(",") if x.strip()] or list(range(len(TOPICS)))
    extra = json.loads(args.extra)
    results = await asyncio.gather(*(bench_one(i, args.label, extra) for i in idx), return_exceptions=True)
    rows = []
    for i, r in zip(idx, results):
        if isinstance(r, Exception):
            print(f"[T{i}] FAILED: {r!r}")
        else:
            rows.append(r)
    OUT.mkdir(exist_ok=True)
    path = OUT / f"{args.label}.json"
    path.write_text(json.dumps({"label": args.label, "at": datetime.now(timezone.utc).isoformat(), "rows": rows}, indent=2))
    show(rows, args.label)
    print(f"\nsaved {path}")


if __name__ == "__main__":
    asyncio.run(main())
