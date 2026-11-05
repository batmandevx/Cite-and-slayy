"""Paper-level quality checks shared by the pipeline and the benchmark.

- check_all_claims: every cited sentence is judged against each cited abstract (not a sample), including sentences that cite
  several papers. A multi-citation sentence whose citations are all unsupported/unclear is flagged as a possible
  "synthesis" claim that none of its sources makes on its own.
- repetition_rate: share of 8-word sequences that appear in more than one top-level section (cross-section repetition).
"""
from __future__ import annotations

import asyncio
import re

from backend.citeguard.claims import judge
from backend.llm import client as llm

_CITE = re.compile(r"\[(\d+(?:\s*[,–-]\s*\d+)*)\]")
_SKIP_SECTIONS = ("references", "abstract", "acknowledg")


def _nums(group: str) -> list[int]:
    out: list[int] = []
    for part in re.split(r"\s*,\s*", group):
        m = re.match(r"(\d+)\s*[–-]\s*(\d+)$", part)
        if m:
            a, b = int(m.group(1)), int(m.group(2))
            out += list(range(a, b + 1)) if 0 < b - a < 15 else [a, b]
        elif part.strip().isdigit():
            out.append(int(part))
    return out


def sections(md: str) -> list[tuple[str, str]]:
    """Top-level (# ) sections as (heading, body)."""
    parts = re.split(r"(?m)^# (.+)$", md)
    return [(parts[i].strip(), parts[i + 1]) for i in range(1, len(parts) - 1, 2)]


def _prose(body: str) -> str:
    """Body text without tables, code/mermaid blocks, display math and figure/table caption lines."""
    body = re.sub(r"```[\s\S]*?```", " ", body)
    body = re.sub(r"\$\$[\s\S]*?\$\$", " ", body)
    return "\n".join(l for l in body.splitlines() if not l.lstrip().startswith(("|", "Table:", "Figure:", "![")))


def cited_sentences(md: str) -> list[tuple[str, str, list[int]]]:
    """(section heading, sentence, cited numbers) for every sentence in the prose that carries a [n] citation."""
    out = []
    for h, body in sections(md):
        if h.lower().startswith(_SKIP_SECTIONS):
            continue
        for para in re.split(r"\n\s*\n", _prose(body)):
            para = " ".join(para.split())
            for s in re.split(r"(?<=[.!?])\s+(?=[A-Z(])", para):
                nums = sorted({n for g in _CITE.findall(s) for n in _nums(g)})
                if nums and len(s) > 25:
                    out.append((h, s.strip(), nums))
    return out


async def check_all_claims(md: str, refs: list[dict], cap: int = 160, batch: int = 8, on_progress=None) -> dict:
    """Judge every (sentence, cited paper) pair, up to `cap` pairs. refs: numbered list (1-based) of dicts with title/abstract."""
    pairs: list[tuple[int, str, int]] = []       # (sentence index, sentence, ref number)
    sents = cited_sentences(md)
    for si, (_, s, nums) in enumerate(sents):
        for n in nums:
            if 1 <= n <= len(refs) and (refs[n - 1].get("abstract") or "").strip():
                pairs.append((si, s, n))
    # spread the budget: first citation of each sentence first, then the rest
    pairs.sort(key=lambda p: (sents[p[0]][2].index(p[2]) > 0, p[0]))
    pairs = pairs[:cap]
    items = [(k, s, refs[n - 1].get("title", ""), refs[n - 1].get("abstract", "")) for k, (_, s, n) in enumerate(pairs)]
    sem = asyncio.Semaphore(4)
    judged: dict[int, object] = {}
    done = 0

    async def run(chunk):
        nonlocal done
        async with sem:
            try:
                judged.update(await judge(chunk))
            except llm.LLMError:
                pass
            done += len(chunk)
            if on_progress:
                await on_progress(done, len(items))
    await asyncio.gather(*(run(items[i:i + batch]) for i in range(0, len(items), batch)))

    results = []
    for k, (si, s, n) in enumerate(pairs):
        j = judged.get(k)
        results.append({"sentence": s, "section": sents[si][0], "n": n,
                        "label": getattr(j, "label", "not_assessed"), "rationale": getattr(j, "rationale", "")})
    # sentences citing several papers where no single citation supports the claim
    by_sent: dict[str, list[dict]] = {}
    for r in results:
        by_sent.setdefault(r["sentence"], []).append(r)
    synthesis = [s for s, rs in by_sent.items()
                 if len(rs) > 1 and all(r["label"] in ("unsupported", "unclear") for r in rs) and any(r["label"] == "unsupported" for r in rs)]
    assessed = [r for r in results if r["label"] != "not_assessed"]
    return {
        "pairs": results, "sentences": len(sents), "checked": len(assessed),
        "supported": sum(r["label"] == "supported" for r in assessed),
        "unclear": sum(r["label"] == "unclear" for r in assessed),
        "unsupported": sum(r["label"] == "unsupported" for r in assessed),
        "synthesis_flags": synthesis,
        "support_rate": round(sum(r["label"] == "supported" for r in assessed) / len(assessed), 3) if assessed else None,
    }


def _shingles(text: str, n: int = 8) -> set[str]:
    w = re.findall(r"[a-z0-9]+", text.lower())
    return {" ".join(w[i:i + n]) for i in range(len(w) - n + 1)}


def repetition_rate(md: str) -> float:
    """Share of 8-word sequences in the body that also occur in another top-level section."""
    secs = [(h, _shingles(_prose(b))) for h, b in sections(md) if not h.lower().startswith(_SKIP_SECTIONS)]
    total = sum(len(s) for _, s in secs)
    if not total:
        return 0.0
    rep = 0
    for i, (_, s) in enumerate(secs):
        others = set().union(*(o for j, (_, o) in enumerate(secs) if j != i)) if len(secs) > 1 else set()
        rep += len(s & others)
    return round(rep / total, 4)
