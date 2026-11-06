"""Re-score already generated benchmark papers with one fixed evaluator (fair comparison between pipeline versions).

    .venv/bin/python scripts/paper_reeval.py bench/v3.json bench/v4.json

The citation check uses full-text passages where available, and the reviewer panel runs twice and is averaged.
"""
from __future__ import annotations

import asyncio
import json
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.cache.store import get_store  # noqa: E402
from backend.common.schemas import Paper  # noqa: E402
from backend.llm import client as llm  # noqa: E402
from backend.paper_studio import literature, quality, review  # noqa: E402


async def score(pid: str) -> dict:
    rec = get_store().get("paper_studio", pid)
    md = rec["markdown"]
    refs = [Paper.model_validate(r) for r in rec.get("_refs") or []]
    await literature.enrich([p for p in refs if not p.corpus_id])
    p1 = await review.panel(md)
    p2 = await review.panel(md + "\n")        # different prompt bytes: a fresh, uncached second opinion
    claims = await quality.check_all_claims(md, [p.model_dump() for p in refs], cap=160, fulltext_cap=40)
    overall = [x for x in (p1["overall"], p2["overall"]) if x]
    return {"panel": round(statistics.mean(overall), 2) if overall else None, "support": claims["support_rate"],
            "unsupported": claims["unsupported"], "checked": claims["checked"]}


async def main() -> None:
    llm.set_premium(True)
    llm.set_meter("bench:reeval")
    store = get_store()
    orig = store.get
    store.get = lambda kind, id: None if kind == "llm_cache" else orig(kind, id)   # type: ignore[method-assign]
    for path in sys.argv[1:]:
        rows = json.loads(Path(path).read_text())["rows"]
        res = await asyncio.gather(*(score(r["paper_id"]) for r in rows))
        print(f"\n== {path} ==")
        for r, s in zip(rows, res):
            print(f"{r['topic'][:42]:42} panel {s['panel']}  support {s['support']}  unsupported {s['unsupported']}/{s['checked']}")
        print("mean panel", round(statistics.mean(s["panel"] for s in res if s["panel"]), 2),
              "| mean support", round(statistics.mean(s["support"] for s in res if s["support"] is not None), 3),
              "| mean unsupported", round(statistics.mean(s["unsupported"] for s in res), 1))


if __name__ == "__main__":
    asyncio.run(main())
