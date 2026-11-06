"""Literature tools for Paper Studio.

- snowball():        citation chaining. Works cited by several of the most relevant papers are usually the field's
                     foundations, which keyword search often misses.
- balanced_select(): picks the reference list by relevance while guaranteeing some seminal (highly cited) and some
                     recent works.
- fill_gaps():       after drafting, finds sentences that need evidence, searches again and cites a new paper only when
                     the claim checker says its abstract supports the sentence (OpenScholar-style self-feedback retrieval).
- novelty():         searches for prior work that already does what the outline proposes, so the paper can cite it and
                     reposition its contribution instead of claiming something that exists (AI Scientist novelty check).
- venue_style():     a style card from recent papers in the target venue (length, abstract structure, tone, citation density).
"""
from __future__ import annotations

import re
import statistics
from collections import Counter
from datetime import date
from typing import Literal

import numpy as np
from pydantic import BaseModel, Field

from backend.citeguard.claims import judge
from backend.common.schemas import Paper
from backend.embeddings.model import embed_async
from backend.llm import client as llm
from backend.sources import openalex
from backend.sources import semantic_scholar as s2
from backend.sources.http import SourceError


def _ok(p: Paper) -> bool:
    return bool(p.title and p.abstract and len(p.abstract) > 180)


# ---------- Semantic Scholar enrichment and recommendations ----------

async def enrich(papers: list[Paper]) -> int:
    """Add TLDR, influential-citation count, publication types, open-access link and corpus id (one batch request)."""
    ids = [(p, s2.s2_id(p)) for p in papers]
    ids = [(p, i) for p, i in ids if i]
    if not ids:
        return 0
    try:
        rows = await s2.batch([i for _, i in ids])
    except SourceError:
        return 0
    n = 0
    for (p, _), r in zip(ids, rows):
        if not r:
            continue
        p.tldr = (r.get("tldr") or {}).get("text") or p.tldr
        p.influential = r.get("influentialCitationCount")
        p.corpus_id = str(r["corpusId"]) if r.get("corpusId") else p.corpus_id
        p.pub_types = r.get("publicationTypes") or []
        p.oa_url = (r.get("openAccessPdf") or {}).get("url") or p.oa_url
        if not p.cited_by and r.get("citationCount"):
            p.cited_by = r["citationCount"]
        n += 1
    return n


async def recommended(top: list[Paper], known: set[str], limit: int = 40) -> list[Paper]:
    """Semantic Scholar's recommender seeded with our most relevant papers."""
    pos = [s2.s2_id(p) for p in top]
    pos = [x for x in pos if x][:10]
    if len(pos) < 2:
        return []
    try:
        recs = await s2.recommend(pos, limit)
    except SourceError:
        return []
    titles = {t.strip().lower() for t in known}
    return [p for p in recs if _ok(p) and p.title.strip().lower() not in titles]


# ---------- duplicates and venue quality ----------

def _norm_title(t: str) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", (t or "").lower())[:14])


def dedupe(papers: list[Paper]) -> tuple[list[Paper], int]:
    """Drop the same work listed twice (preprint + published version, title variants). Keeps the published, cited one."""
    from rapidfuzz import fuzz
    kept: list[Paper] = []
    dropped = 0
    rank = lambda p: (bool(p.doi) and p.venue_type != "repository", p.cited_by or 0)   # noqa: E731
    for p in papers:
        nt = _norm_title(p.title)
        dup = next((i for i, q in enumerate(kept) if (p.doi and q.doi and p.doi.lower() == q.doi.lower())
                    or fuzz.ratio(nt, _norm_title(q.title)) >= 92), None)
        if dup is None:
            kept.append(p)
        else:
            dropped += 1
            if rank(p) > rank(kept[dup]):
                kept[dup] = p
    return kept, dropped


def venue_penalty(p: Paper) -> float:
    """Small relevance penalty for journal articles outside OpenAlex's core sources that few people cite."""
    if p.core is False and p.venue_type == "journal" and (p.cited_by or 0) < 25:
        return 0.06
    return 0.0


# ---------- snowballing ----------

async def snowball(top: list[Paper], known: set[str], min_shared: int = 2, limit: int = 15) -> list[Paper]:
    """Works cited by at least `min_shared` of the `top` papers (OpenAlex ids only), not already known."""
    ids = [p.id for p in top if re.fullmatch(r"W\d+", p.id or "")][:25]
    if len(ids) < 3:
        return []
    try:
        refs = await openalex.referenced_ids(ids)
    except SourceError:
        return []
    counts = Counter(r for lst in refs.values() for r in set(lst))
    wanted = [w for w, c in counts.most_common(80) if c >= min_shared and w not in known][:50]
    if not wanted:
        return []
    try:
        f = await openalex.works_by_ids(wanted)
    except SourceError:
        return []
    found = [openalex.to_paper(w) for w in (f.data or {}).get("results", [])]
    found = [p for p in found if _ok(p)]
    found.sort(key=lambda p: (-counts.get(p.id, 0), -(p.cited_by or 0)))
    return found[:limit]


def balanced_select(pool: list[Paper], sims: np.ndarray, n: int, this_year: int, seeds: list[Paper],
                    snowballed: set[str] = frozenset()) -> list[Paper]:
    """Relevance-ranked, with quotas: >= 15% seminal (top citation decile among relevant), >= 20% recent (last 3 years),
    and up to 20% from snowballing. Seeds always come first."""
    order = list(np.argsort(-sims))
    relevant = [pool[i] for i in order[: max(n * 3, 40)]]
    picked: list[Paper] = list(seeds)
    seen = {p.id for p in picked}

    def take(cands, k):
        for p in cands:
            if k <= 0 or len(picked) >= n:
                return
            if p.id not in seen:
                picked.append(p)
                seen.add(p.id)
                k -= 1
    cites = sorted((p.cited_by or 0 for p in relevant), reverse=True)
    hi = cites[max(0, len(cites) // 10 - 1)] if cites else 0
    # seminal: rank by influential citations when Semantic Scholar knows them (a better signal than raw counts)
    take(sorted((p for p in relevant if (p.cited_by or 0) >= hi and hi > 0), key=lambda p: (-(p.influential or 0), -(p.cited_by or 0))),
         max(2, int(0.15 * n)))
    take([p for p in relevant if p.year and p.year >= this_year - 3], max(3, int(0.2 * n)))
    take([p for p in relevant if p.id in snowballed], int(0.2 * n))
    take(relevant, n)
    return picked[:n]


# ---------- gap-driven re-retrieval ----------

class _Gap(BaseModel):
    quote: str = Field(description="An exact sentence copied from the draft that makes a factual claim needing a citation")
    query: str = Field(description="A 3-7 word scholarly search query for evidence on that claim")


class _Gaps(BaseModel):
    gaps: list[_Gap]


def _cite_into(md: str, sentence: str, n: int) -> str:
    """Append [n] to the end of `sentence` inside md (before its final punctuation)."""
    i = md.find(sentence)
    if i < 0:
        return md
    s = sentence.rstrip()
    m = re.search(r"([.!?])$", s)
    new = (s[:-1].rstrip() + f" [{n}]" + m.group(1)) if m else s + f" [{n}]"
    return md[:i] + new + md[i + len(s):]


async def fill_gaps(md: str, refs: list[Paper], known_ids: set[str], max_new: int = 6, say=None) -> tuple[str, list[Paper], list[dict]]:
    """Returns (markdown with new citations, new papers appended after refs, log)."""
    body = re.sub(r"(?ms)^# References.*", "", md)
    try:
        g = await llm.complete_json(
            "You are a meticulous scholarly editor. Find sentences in this draft that state a factual, empirical or historical "
            "claim about the world or prior research but have NO citation, or whose claim is broader than its citation. Ignore "
            "sentences about this paper's own design, notation, assumptions, proofs, hypotheses or plans.",
            f"DRAFT:\n{body[: llm.context_chars() - 6000]}\n\nReturn up to {max_new + 2} such sentences, copied exactly, each with "
            "a search query.", _Gaps, effort="low", tier="fast")
    except llm.LLMError:
        return md, [], []
    gaps = [x for x in g.gaps if x.quote.strip() and x.quote.strip() in md][: max_new + 2]
    new: list[Paper] = []
    log: list[dict] = []
    seen = set(known_ids)

    passages: dict[str, str] = {}      # paper id -> full-text passage that matched the claim

    async def candidates(q: str, claim: str) -> list[Paper]:
        out: list[Paper] = []
        # full-text passages first: a paper whose body states the claim is the strongest candidate
        try:
            sn = await s2.snippets(claim[:400], limit=5)
            cids = list(dict.fromkeys(x["corpus_id"] for x in sn if x["corpus_id"]))[:5]
            if cids:
                rows = await s2.batch([f"CorpusId:{c}" for c in cids], fields=s2.FIELDS + ",corpusId")
                for r in rows:
                    if r:
                        p = s2.to_paper(r)
                        p.corpus_id = str(r.get("corpusId") or "")
                        txt = next((x["text"] for x in sn if x["corpus_id"] == p.corpus_id), "")
                        if txt:
                            passages[p.id] = txt
                        out.append(p)
        except SourceError:
            pass
        try:
            f = await openalex.related_works(q, per_page=8)
            out += [openalex.to_paper(w) for w in (f.data or {}).get("results", [])]
        except SourceError:
            pass
        try:
            f = await s2.search(q, limit=8)
            out += [s2.to_paper(w) for w in (f.data or {}).get("data", []) or []]
        except SourceError:
            pass
        titles = set()
        res = []
        for p in out:
            t = (p.title or "").strip().lower()
            if _ok(p) and p.id not in seen and t not in titles:
                titles.add(t)
                res.append(p)
        return res

    for gap in gaps:
        if len(new) >= max_new:
            break
        cands = await candidates(gap.query, gap.quote)
        if not cands:
            continue
        sv = await embed_async([gap.quote])
        av = await embed_async([f"{p.title}. {p.abstract}" for p in cands])
        order = list(np.argsort(-(av @ sv.T).ravel()))
        top = ([p for p in cands if p.id in passages][:2] + [cands[i] for i in order if cands[i].id not in passages])[:3]
        try:
            verdicts = await judge([(k, gap.quote, p.title, (p.abstract or "") + (f"\n\nFULL-TEXT PASSAGE: {passages[p.id]}" if p.id in passages else ""))
                                    for k, p in enumerate(top)])
        except llm.LLMError:
            continue
        best = next((top[k] for k in range(len(top)) if getattr(verdicts.get(k), "label", "") == "supported"), None)
        if best:
            n = len(refs) + len(new) + 1
            md = _cite_into(md, gap.quote.strip(), n)
            new.append(best)
            seen.add(best.id)
            log.append({"sentence": gap.quote, "added": best.title, "n": n, "full_text": best.id in passages})
            if say:
                await say("librarian", "run", f"Cited new evidence: “{best.title[:70]}”")
        else:
            log.append({"sentence": gap.quote, "added": None})
    return md, new, log


# ---------- novelty ----------

class _Novelty(BaseModel):
    verdict: Literal["novel", "incremental", "already_exists"]
    closest: list[int] = Field(description="Item numbers of the most similar prior works (up to 3)")
    explanation: str
    repositioning: str = Field(description="If not clearly novel: how to reposition the contribution so it is honest and distinct")


async def novelty(proposal: str, query: str, known_titles: set[str]) -> dict:
    """Search S2 + OpenAlex for prior work matching the proposal and judge overlap."""
    cands: list[Paper] = []
    try:
        f = await s2.search(query, limit=12)
        cands += [s2.to_paper(w) for w in (f.data or {}).get("data", []) or []]
    except SourceError:
        pass
    try:
        f = await openalex.related_works(query, per_page=12)
        cands += [openalex.to_paper(w) for w in (f.data or {}).get("results", [])]
    except SourceError:
        pass
    uniq, titles = [], set()
    for p in cands:
        t = (p.title or "").strip().lower()
        if _ok(p) and t not in titles:
            titles.add(t)
            uniq.append(p)
    if not uniq:
        return {"verdict": "unchecked", "closest": [], "explanation": "No search results", "repositioning": "", "papers": []}
    pv = await embed_async([proposal])
    av = await embed_async([f"{p.title}. {p.abstract}" for p in uniq])
    sims = (av @ pv.T).ravel()
    top_i = list(np.argsort(-sims)[:8])
    top = [uniq[i] for i in top_i]
    listing = "\n".join(f"[{k + 1}] {p.title} ({p.year})\n    {(p.abstract or '')[:600]}" for k, p in enumerate(top))
    try:
        v = await llm.complete_json(
            "You are a senior area chair checking whether a proposed contribution already exists in the literature. Judge only "
            "from the abstracts. 'already_exists' = a listed work does essentially the same thing; 'incremental' = closely "
            "related work exists and the difference is small; 'novel' = clearly distinct. In the explanation and repositioning, refer "
            "to works by their title (never by item number), because readers will not see this list.",
            f"PROPOSAL:\n{proposal}\n\nCANDIDATE PRIOR WORK:\n{listing}", _Novelty, effort="medium")
    except llm.LLMError:
        return {"verdict": "unchecked", "closest": [], "explanation": "Novelty check unavailable", "repositioning": "", "papers": []}
    closest = [top[i - 1] for i in v.closest if 1 <= i <= len(top)][:3]
    return {"verdict": v.verdict, "explanation": v.explanation, "repositioning": v.repositioning,
            "closest": [{"title": p.title, "year": p.year, "similarity": round(float(sims[top_i[top.index(p)]]), 3),
                         "known": p.title.strip().lower() in known_titles} for p in closest],
            "papers": closest}


# ---------- venue style ----------

class _StyleCard(BaseModel):
    card: str = Field(description="6-10 bullet points of concrete style guidance for writing for this venue")


async def venue_style(name: str) -> dict | None:
    """Style card from recent abstracts in the named venue. None if the venue can't be found."""
    try:
        f = await openalex.find_source(name)
        srcs = (f.data or {}).get("results", [])
        if not srcs:
            return None
        src = srcs[0]
        w = await openalex.recent_in_source(src["id"], date.today().year - 2, n=12)
    except SourceError:
        return None
    works = (w.data or {}).get("results", [])
    papers = [openalex.to_paper(x) for x in works]
    papers = [p for p in papers if _ok(p)]
    if len(papers) < 3:
        return None
    abs_words = [len((p.abstract or "").split()) for p in papers]
    title_words = [len(p.title.split()) for p in papers]
    ref_counts = [x.get("referenced_works_count") or 0 for x in works if (x.get("referenced_works_count") or 0) > 5]
    structured = sum(bool(re.search(r"\b(Background|Objective|Methods?|Results|Conclusions?)\s*:", p.abstract or "")) for p in papers)
    first_person = sum(bool(re.search(r"\b(we|our)\b", p.abstract or "", re.I)) for p in papers)
    stats = {
        "venue": src.get("display_name"), "type": src.get("type"), "publisher": src.get("host_organization_name"),
        "abstract_words_median": int(statistics.median(abs_words)), "title_words_median": int(statistics.median(title_words)),
        "references_median": int(statistics.median(ref_counts)) if ref_counts else None,
        "structured_abstracts": f"{structured}/{len(papers)}", "first_person_abstracts": f"{first_person}/{len(papers)}",
    }
    examples = "\n\n".join(f"TITLE: {p.title}\nABSTRACT: {(p.abstract or '')[:1100]}" for p in papers[:5])
    try:
        card = await llm.complete_json(
            "You are an experienced editor describing a venue's house style to authors. Base every point on the measured "
            "statistics and the example papers; do not invent requirements.",
            f"VENUE STATISTICS: {stats}\n\nRECENT PAPERS:\n{examples}\n\nDescribe: title pattern, abstract length and structure, "
            "tone and voice, how contributions are framed, typical depth of related work, and anything distinctive.",
            _StyleCard, effort="low", tier="fast")
    except llm.LLMError:
        return {"stats": stats, "card": ""}
    return {"stats": stats, "card": card.card}
