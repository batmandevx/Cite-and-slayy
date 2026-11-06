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
from backend.sources import semantic_scholar as s2
from backend.sources.http import SourceError

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


async def check_all_claims(md: str, refs: list[dict], cap: int | None = None, batch: int = 8, on_progress=None,
                           fulltext_cap: int = 0) -> dict:
    """Judge every (sentence, cited paper) pair unless an explicit cap is requested.

    The default is deliberately uncapped: silently skipping citation pairs makes a
    manuscript appear verified when its later sections were never checked.
    """
    pairs: list[tuple[int, str, int]] = []       # (sentence index, sentence, ref number)
    sents = cited_sentences(md)
    for si, (_, s, nums) in enumerate(sents):
        for n in nums:
            if 1 <= n <= len(refs) and (refs[n - 1].get("abstract") or "").strip():
                pairs.append((si, s, n))
    # spread the budget: first citation of each sentence first, then the rest
    pairs.sort(key=lambda p: (sents[p[0]][2].index(p[2]) > 0, p[0]))
    if cap is not None:
        pairs = pairs[:max(0, cap)]
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

    # Second pass on full text: when the abstract alone can't settle a claim, fetch the matching passage from the paper's
    # body (Semantic Scholar snippet search) and judge again with abstract + passage.
    fulltext = 0
    unclear = [r for r in results if r["label"] in ("unclear", "unsupported") and refs[r["n"] - 1].get("corpus_id")][:fulltext_cap]
    if unclear:
        found = []
        for r in unclear:                                        # sequential: the keyed API allows one request per second
            try:
                sn = await s2.snippets(re.sub(r"\[[\d,\s–-]+\]", "", r["sentence"])[:400], [refs[r["n"] - 1]["corpus_id"]], limit=2)
            except SourceError:
                continue
            if sn:
                found.append((r, sn[0]))
        items2 = [(k, r["sentence"], refs[r["n"] - 1].get("title", ""),
                   (refs[r["n"] - 1].get("abstract") or "")[:1500] + f"\n\nFULL-TEXT PASSAGE ({sn['section'] or 'body'}): {sn['text']}")
                  for k, (r, sn) in enumerate(found)]
        for i in range(0, len(items2), batch):
            try:
                again = await judge(items2[i:i + batch])
            except llm.LLMError:
                continue
            for k, j in again.items():
                if 0 <= k < len(found):
                    r, sn = found[k]
                    r.update(label=j.label, rationale=j.rationale, passage=sn["text"][:500], evidence="full text")
                    fulltext += 1
    # sentences citing several papers where no single citation supports the claim
    by_sent: dict[str, list[dict]] = {}
    for r in results:
        by_sent.setdefault(r["sentence"], []).append(r)
    synthesis = [s for s, rs in by_sent.items()
                 if len(rs) > 1 and all(r["label"] in ("unsupported", "unclear") for r in rs) and any(r["label"] == "unsupported" for r in rs)]
    assessed = [r for r in results if r["label"] != "not_assessed"]
    return {
        "pairs": results, "sentences": len(sents), "checked": len(assessed), "fulltext_checked": fulltext,
        "supported": sum(r["label"] == "supported" for r in assessed),
        "unclear": sum(r["label"] == "unclear" for r in assessed),
        "unsupported": sum(r["label"] == "unsupported" for r in assessed),
        "synthesis_flags": synthesis,
        "support_rate": round(sum(r["label"] == "supported" for r in assessed) / len(assessed), 3) if assessed else None,
    }


def publication_readiness(
    *,
    claims: dict,
    structural_blockers: list[str] | None = None,
    unmeasured_remaining: int = 0,
    copied_paragraphs: int = 0,
    invalid_equations: int = 0,
    diagrams_removed: int = 0,
    review_overall: float | None = None,
    references: int = 0,
) -> dict:
    """Return a conservative, explainable submission gate for the generated manuscript.

    This is not a venue acceptance prediction. It is a last-mile integrity gate:
    unresolved evidence or reproducibility problems must be visible even when the
    language-model reviewer is unavailable or overly generous.
    """
    blockers: list[str] = []
    warnings: list[str] = []
    blockers.extend(structural_blockers or [])
    unsupported = int(claims.get("unsupported", 0) or 0)
    unclear = int(claims.get("unclear", 0) or 0)
    checked = int(claims.get("checked", 0) or 0)
    support_rate = claims.get("support_rate")

    if unsupported:
        blockers.append(f"{unsupported} citation claim(s) remain unsupported")
    if unmeasured_remaining:
        blockers.append(f"{unmeasured_remaining} unmeasured claim(s) remain")
    if copied_paragraphs:
        blockers.append(f"{copied_paragraphs} paragraph(s) remain too close to source abstracts")
    if invalid_equations:
        blockers.append(f"{invalid_equations} equation(s) remain invalid")
    if diagrams_removed:
        warnings.append(f"{diagrams_removed} invalid diagram(s) were removed")
    if references < 15:
        warnings.append(f"only {references} references are included")
    if checked == 0 and references:
        blockers.append("no cited claims were assessed")
    elif checked and support_rate is not None and support_rate < 0.8:
        blockers.append(f"citation support rate is {support_rate:.0%}, below the 80% gate")
    elif unclear and checked and unclear / checked > 0.2:
        blockers.append(f"{unclear} citation claim(s) remain unclear ({unclear / checked:.0%})")
    elif unclear:
        warnings.append(f"{unclear} citation claim(s) remain unclear")
    if review_overall is None:
        blockers.append("review panel was unavailable")
    elif review_overall < 7:
        blockers.append(f"review panel score is {review_overall:.1f}/10, below the 7/10 gate")

    score = 10.0
    score -= min(3.0, unsupported * 0.5)
    score -= min(2.0, unmeasured_remaining * 0.5)
    score -= min(1.5, copied_paragraphs * 0.5)
    score -= min(1.5, invalid_equations * 0.5)
    if support_rate is not None:
        score -= max(0.0, min(2.0, (0.8 - support_rate) * 5))
    if review_overall is not None:
        score -= max(0.0, min(2.0, (7.0 - review_overall) * 0.5))
    return {
        "score": round(max(0.0, min(10.0, score)), 1),
        "ready": not blockers,
        "blockers": blockers,
        "warnings": warnings,
    }


def structural_issues(md: str, required_headings: set[str]) -> list[str]:
    """Find missing manuscript scaffolding before an LLM-written paper is exported."""
    headings = {m.group(1).strip().lower() for m in re.finditer(r"(?m)^# (.+?)\s*$", md)}
    issues = [f"missing required section: {h}" for h in sorted(required_headings)
              if h.strip().lower() not in headings]
    abstract = re.search(r"(?ms)^# Abstract\s*\n(.*?)(?=^# |\Z)", md)
    if not abstract or len(re.sub(r"\*\*Keywords:\*\*.*", "", abstract.group(1), flags=re.S).split()) < 80:
        issues.append("abstract is missing or too short")
    if not re.search(r"(?im)^\*\*Keywords:\*\*\s*\S+", md):
        issues.append("keywords are missing")
    if not re.search(r"(?im)^# Conclusion\s*$", md):
        issues.append("conclusion is missing")
    return issues


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
