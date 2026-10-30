"""Check 3: does the cited paper's abstract support the citing sentence?

Signal 1: embedding cosine similarity (sentence vs. abstract).
Signal 2: LLM judgment (Supported / Unclear / Unsupported) with a one-line rationale.
The LLM label is authoritative; similarity is shown alongside. If no abstract can be
fetched the label is Unclear ("no abstract"), never Unsupported. If no LLM is configured
the label is "not_assessed" and only similarity is shown.
"""
from __future__ import annotations

import asyncio
from typing import Literal

from pydantic import BaseModel

from backend.common.schemas import ClaimCheck, Evidence, Paper
from backend.documents.parser import Citation
from backend.embeddings.model import embed_async
from backend.llm import client as llm
from backend.sources import openalex, semantic_scholar
from backend.sources.http import SourceError


async def fetch_abstract(p: Paper) -> tuple[str | None, Evidence | None]:
    if p.abstract:
        return p.abstract, Evidence(source=p.source, record_url=p.url, note="abstract from matched record")
    if p.doi:
        try:
            f = await openalex.work_by_doi(p.doi)
            if f.data:
                w = openalex.to_paper(f.data)
                if w.abstract:
                    return w.abstract, Evidence(source="openalex", request_url=f.url, fetched_at=f.fetched_at,
                                                record_url=w.url, note="abstract from OpenAlex")
        except SourceError:
            pass
        try:
            f = await semantic_scholar.paper(f"DOI:{p.doi}")
            if f.data and f.data.get("abstract"):
                return f.data["abstract"], Evidence(source="semantic_scholar", request_url=f.url,
                                                    fetched_at=f.fetched_at, record_url=f.data.get("url"),
                                                    note="abstract from Semantic Scholar")
        except SourceError:
            pass
    return None, None


class _Judgment(BaseModel):
    id: int
    label: Literal["supported", "unclear", "unsupported"]
    rationale: str


class _Batch(BaseModel):
    judgments: list[_Judgment]


SYSTEM = """You check whether a cited paper supports the sentence that cites it.
You see only the cited paper's abstract, so be calibrated:
- supported: the abstract clearly backs the specific claim the sentence attributes to this citation.
- unsupported: the abstract contradicts the claim, or is about a clearly different topic/finding.
- unclear: plausible but the abstract alone is not enough to tell (e.g. claim concerns details not in an abstract).
Give a one-sentence rationale quoting or paraphrasing the abstract. Do not use outside knowledge about the paper."""


async def judge(items: list[tuple[int, str, str, str]]) -> dict[int, _Judgment]:
    """items: (id, sentence, cited_title, abstract)."""
    prompt = "Judge each item.\n\n" + "\n\n".join(
        f"### Item {i}\nCiting sentence: {s}\nCited paper title: {t}\nCited paper abstract: {a[:2500]}"
        for i, s, t, a in items)
    out = await llm.complete_json(SYSTEM, prompt, _Batch, effort="low", tier="fast")
    by_id = {j.id: j for j in out.judgments}
    wanted = [i for i, *_ in items]
    if not set(wanted) & set(by_id) and len(out.judgments) == len(items):
        # Small models sometimes renumber items 1..n; the order is still the order we asked in.
        by_id = {i: j for i, j in zip(wanted, out.judgments)}
    return by_id


async def check_claims(citations: list[Citation], resolved: dict[int, Paper], max_claims: int,
                       on_progress=None) -> tuple[list[ClaimCheck], list[str]]:
    warnings: list[str] = []
    # One claim per (sentence, ref); spread across distinct references first.
    pairs, seen = [], set()
    for c in citations:
        for ri in c.ref_indices:
            key = (c.page, c.s_start, ri)
            if key not in seen:
                seen.add(key)
                pairs.append((c, ri))
    occurrence: dict[int, int] = {}
    ranked = []
    for c, ri in pairs:
        occurrence[ri] = occurrence.get(ri, 0) + 1
        ranked.append((occurrence[ri], c.page, c.s_start, c, ri))
    ranked.sort(key=lambda x: x[:3])
    pairs = [(c, ri) for *_, c, ri in ranked[:max_claims]]

    abstracts: dict[int, tuple[str | None, Evidence | None]] = {}
    sem = asyncio.Semaphore(4)

    async def get_abs(ri: int):
        async with sem:
            abstracts[ri] = await fetch_abstract(resolved[ri])

    await asyncio.gather(*(get_abs(ri) for ri in {ri for _, ri in pairs if ri in resolved}))

    checks: list[ClaimCheck] = []
    to_embed: list[int] = []
    for c, ri in pairs:
        paper = resolved.get(ri)
        abstract, ev = abstracts.get(ri, (None, None))
        base = dict(sentence=c.sentence, page=c.page, start=c.s_start, end=c.s_end, ref_index=ri,
                    cited_title=paper.title if paper else None, cited_abstract=abstract, similarity=None)
        if paper is None:
            checks.append(ClaimCheck(**base, label="not_assessed",
                                     rationale="Cited reference could not be resolved, so there is no abstract to compare."))
        elif not abstract:
            checks.append(ClaimCheck(**base, label="unclear", rationale="No abstract available from OpenAlex or Semantic Scholar.",
                                     evidence=[Evidence(source="openalex", record_url=paper.url, note="abstract unavailable")]))
        else:
            checks.append(ClaimCheck(**base, label="not_assessed", rationale="", evidence=[ev] if ev else []))
            to_embed.append(len(checks) - 1)

    if to_embed:
        sv = await embed_async([checks[i].sentence for i in to_embed])
        av = await embed_async([checks[i].cited_abstract or "" for i in to_embed])
        for k, i in enumerate(to_embed):
            checks[i].similarity = round(float(sv[k] @ av[k]), 3)
            checks[i].evidence.append(Evidence(source="embedding", matched_fields={"cosine": checks[i].similarity},
                                               note="all-MiniLM-L6-v2 cosine(sentence, abstract)"))

    if to_embed and llm.available():
        size = 4 if llm.is_local() else 8   # small local models do better with fewer items per call
        batches = [to_embed[i:i + size] for i in range(0, len(to_embed), size)]
        done = 0
        for b in batches:
            items = [(i, checks[i].sentence, checks[i].cited_title or "", checks[i].cited_abstract or "") for i in b]
            try:
                res = await judge(items)
            except llm.LLMError as e:
                warnings.append(f"LLM claim check failed for {len(b)} claims: {e}")
                for i in b:
                    checks[i].rationale = "LLM judgment failed; similarity only."
                continue
            for i in b:
                j = res.get(i)
                if j:
                    checks[i].label, checks[i].rationale = j.label, j.rationale
                    checks[i].evidence.append(Evidence(source="llm", note="Azora AI claim judge"))
                else:
                    checks[i].rationale = "LLM returned no judgment for this item; similarity only."
            done += len(b)
            if on_progress:
                await on_progress(done, len(to_embed))
    elif to_embed:
        warnings.append("No LLM configured: claim-support labels not assessed (similarity scores shown only).")
        for i in to_embed:
            checks[i].rationale = "No LLM configured; similarity only."
    return checks, warnings
