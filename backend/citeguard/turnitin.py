"""Turnitin-style Originality (Similarity / Plagiarism) & AI-Writing Scanner + Paid Reducer / Remover.

Hard guarantees:
- Every similarity match is grounded in a real scholarly record fetched from OpenAlex (with title, venue, year, DOI/URL)
  and scored by real 3/4-gram lexical containment + MiniLM semantic similarity. Never fabricates sources or percentages.
- Every AI-writing highlight reports its exact reproducible stylometric evidence (sentence-length burstiness CV,
  documented LLM discourse clichés, RLHF participial tail cadence, anaphora chains, and Cabanac et al. tortured phrases).
- The Reducer rewrites flagged paragraphs via the configured LLM (Claude on Amazon Bedrock for Pro/Max/Owner) while
  preserving math, inline citations, and quantitative facts, then re-scores against the exact same corpus to report
  verified Before% -> After% reductions.
"""
from __future__ import annotations

import asyncio
import math
import re
import statistics
import uuid
from collections import defaultdict
from typing import Literal

from pydantic import BaseModel, Field
from rapidfuzz import fuzz

from backend.app.venue_finder import build_search_queries
from backend.cache.store import get_store, now
from backend.citeguard.overlap import is_same_work
from backend.citeguard.phrases import find_phrases
from backend.documents import service as docs
from backend.embeddings.model import embed_async
from backend.llm import client as llm
from backend.sources import openalex
from backend.sources.http import SourceError

SOURCE_COLORS = [
    "#e11d48",  # [1] Crimson
    "#ea580c",  # [2] Tangerine
    "#2563eb",  # [3] Cobalt
    "#9333ea",  # [4] Amethyst
    "#0d9488",  # [5] Teal
    "#ca8a04",  # [6] Amber
    "#db2777",  # [7] Magenta
    "#4f46e5",  # [8] Indigo
    "#16a34a",  # [9] Emerald
    "#dc2626",  # [10] Red
]

# Documented high-frequency RLHF / LLM discourse markers and inflated adjectives in scientific prose
LLM_CLICHE_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    (label, re.compile(pat, re.I))
    for label, pat in [
        ("delve / delves", r"\bdelv(?:e|es|ed|ing)\b"),
        ("tapestry", r"\btapestr(?:y|ies)\b"),
        ("testament to", r"\btestament\s+to\b"),
        ("pivotal role", r"\bpivotal\s+(?:role|moment|step|shift)\b"),
        ("crucial role", r"\bcrucial\s+role\b"),
        ("underscores the", r"\bunderscor(?:e|es|ing)\s+the\b"),
        ("in the realm of", r"\bin\s+the\s+realm\s+of\b"),
        ("paradigm shift", r"\bparadigm\s+shift\b"),
        ("meticulously", r"\bmeticulously\b"),
        ("seamlessly", r"\bseamlessly\b"),
        ("multifaceted", r"\bmultifaceted\b"),
        ("intricate interplay", r"\bintricate\s+(?:interplay|balance|dance|web)\b"),
        ("it is worth noting", r"\bit\s+is\s+(?:worth\s+noting|important\s+to\s+note|imperative\s+to\s+note)\b"),
        ("comprehensive overview", r"\bcomprehensive\s+overview\b"),
        ("paves the way", r"\bpav(?:e|es|ing)\s+the\s+way\b"),
        ("sheds light on", r"\bshed(?:s|ding)?\s+light\s+on\b"),
        ("at the forefront of", r"\bat\s+the\s+forefront\s+of\b"),
        ("stands as a", r"\bstands\s+as\s+a\b"),
        ("poised to", r"\bpoised\s+to\b"),
        ("unlocking the potential", r"\bunlock(?:s|ing)?\s+the\s+(?:full\s+)?potential\b"),
        ("cornerstone of", r"\bcornerstone\s+of\b"),
        ("holistic approach", r"\bholistic\s+(?:approach|framework|view)\b"),
        ("fostering", r"\bfoster(?:s|ing)\b"),
        ("ever-evolving", r"\bever-evolving\b"),
        ("notably / moreover opener", r"^(?:notably|moreover|furthermore|importantly|crucially|additionally),\s"),
    ]
]

# Classic RLHF participial tail: "... , highlighting/underscoring/ensuring/showcasing/thereby ..."
PARTICIPIAL_TAIL_RE = re.compile(
    r",\s+(?:thereby\s+\w+ing|highlighting|underscoring|showcasing|demonstrating|ensuring|enabling|facilitating|paving|bolstering)\b[^.!?]{8,}[.!?]$",
    re.I,
)

ANAPHORA_OPENER_RE = re.compile(r"^(?:this|these)\s+(?:approach|framework|architecture|mechanism|capability|design|method|system|finding|result)s?\b", re.I)

REFS_HEADING_RE = re.compile(r"(?m)^\s*(?:#{1,3}\s*)?(?:references|bibliography|works\s+cited)\s*$", re.I)
SENT_SPLIT_RE = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"“(])")


class _ParagraphRewrite(BaseModel):
    rewritten: str = Field(description="Rewritten academic paragraph preserving all citations, math, and quantitative facts.")
    changes_summary: str = Field(description="One-sentence note of how overlap and AI cadence were resolved.")


def _word_tokens(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", (text or "").lower())


def _ngram_set(words: list[str], n: int) -> set[tuple[str, ...]]:
    if len(words) < n:
        return set()
    return {tuple(words[i:i + n]) for i in range(len(words) - n + 1)}


def _ngram_containment(sent_words: list[str], src_words: list[str], n: int = 4) -> float:
    a = _ngram_set(sent_words, n)
    if not a:
        return 0.0
    b = _ngram_set(src_words, n)
    if not b:
        return 0.0
    return len(a & b) / len(a)


def _clean_markdown_for_scan(md: str, exclude_references: bool = True) -> str:
    s = md or ""
    if exclude_references:
        m = REFS_HEADING_RE.search(s)
        if m:
            s = s[:m.start()]
    # Remove figure placeholders and markdown table separator lines while keeping prose & headings readable
    s = re.sub(r"\[\[FIG:[A-Za-z0-9_-]+\]\]", "", s)
    lines: list[str] = []
    for ln in s.splitlines():
        stripped = ln.strip()
        if re.match(r"^\|[\s\-:|]+\|$", stripped):
            continue
        if stripped.startswith("|") and stripped.endswith("|"):
            # Skip dense markdown table rows from prose plagiarism/burstiness scan
            continue
        lines.append(ln)
    return "\n".join(lines).strip()


def _resolve_manuscript(
    text: str = "",
    title: str = "",
    document_id: str | None = None,
    paper_id: str | None = None,
    exclude_references: bool = True,
) -> tuple[str, str, list[dict]]:
    """Return (clean_title, clean_text, seed_papers_dicts)."""
    seed_papers: list[dict] = []
    if paper_id:
        rec = get_store().get("paper_studio", paper_id)
        if not rec:
            raise ValueError(f"Paper Studio draft '{paper_id}' not found")
        resolved_title = title.strip() or (rec.get("title") or "Untitled Manuscript")
        resolved_text = _clean_markdown_for_scan(rec.get("markdown") or "", exclude_references=exclude_references)
        for r in rec.get("_refs") or []:
            if isinstance(r, dict) and r.get("abstract") and r.get("title"):
                seed_papers.append(r)
        return resolved_title, resolved_text, seed_papers

    if document_id:
        parsed = docs.get_parsed(document_id)
        resolved_title = title.strip() or (parsed.title or "Uploaded Manuscript")
        pages: list[str] = []
        for pi, pg in enumerate(parsed.pages):
            if exclude_references and parsed.refs_at and pi > parsed.refs_at[0]:
                break
            limit = parsed.refs_at[1] if (exclude_references and parsed.refs_at and pi == parsed.refs_at[0]) else len(pg)
            pages.append(pg[:limit])
        raw_joined = "\n\n".join(pages)
        # Re-join hyphenated PDF line wraps and single line breaks within paragraphs
        cleaned = re.sub(r"(\w)-\n(\w)", r"\1\2", raw_joined)
        cleaned = re.sub(r"(?<!\n)\n(?!\n)", " ", cleaned)
        return resolved_title, cleaned.strip(), seed_papers

    cleaned = _clean_markdown_for_scan(text, exclude_references=exclude_references)
    inferred_title = title.strip()
    if not inferred_title:
        first_line = next((ln.lstrip("# ").strip() for ln in cleaned.splitlines() if ln.strip()), "")
        inferred_title = first_line[:140] if len(first_line.split()) <= 22 else "Submitted Manuscript"
    return inferred_title, cleaned, seed_papers


def _segment_paragraphs(text: str) -> list[dict]:
    """Split text into paragraphs and sentences. Headings and code/math fences are marked non-prose."""
    raw_paras = [p.strip() for p in re.split(r"\n\s*\n", text or "") if p.strip()]
    out: list[dict] = []
    for idx, p in enumerate(raw_paras):
        is_heading = bool(re.match(r"^#{1,4}\s+\S", p)) or (len(p.split()) <= 9 and not p.endswith((".", "!", "?")))
        is_fence = p.startswith(("```", "$$")) or p.startswith("|")
        if is_heading or is_fence:
            out.append({"index": idx, "kind": "heading" if is_heading else "block", "raw": p, "sentences": []})
            continue
        raw_sents = [s.strip() for s in SENT_SPLIT_RE.split(p) if s.strip()]
        sents = [{"text": s, "words": len(_word_tokens(s))} for s in raw_sents]
        out.append({"index": idx, "kind": "prose", "raw": p, "sentences": sents})
    return out


def _source_sentences(abstract: str, title: str = "") -> list[str]:
    chunks = [s.strip() for s in SENT_SPLIT_RE.split(abstract or "") if len(_word_tokens(s)) >= 6]
    if title and len(_word_tokens(title)) >= 6:
        chunks.insert(0, title.strip())
    return chunks[:14]


async def _gather_candidate_sources(title: str, paragraphs: list[dict], seed_papers: list[dict], max_sources: int = 35) -> tuple[list[dict], list[str]]:
    """Fetch real scholarly candidate works from OpenAlex using title + distinctive body sentences."""
    warnings: list[str] = []
    queries = list(build_search_queries(title, ""))
    prose_sents = [
        s["text"]
        for p in paragraphs if p["kind"] == "prose"
        for s in p["sentences"]
        if 10 <= s["words"] <= 38
    ]
    # Sample up to 3 distinctive sentences spread across the manuscript (intro, middle, late)
    if prose_sents:
        picks = {0, len(prose_sents) // 2, max(0, len(prose_sents) - 1)}
        for idx in sorted(picks):
            sq = build_search_queries(prose_sents[idx], "")
            if sq and sq[0] not in queries:
                queries.append(sq[0])

    queries = queries[:5]

    async def _fetch(q: str):
        try:
            f = await openalex.related_works(q, per_page=18)
            return (f.data or {}).get("results", []), None
        except SourceError as e:
            return [], e.reason

    batches = await asyncio.gather(*[_fetch(q) for q in queries]) if queries else []
    seen_keys: set[str] = set()
    sources: list[dict] = []

    def _add_candidate(pid: str, ptitle: str, authors: list[str], year: int | None, venue: str | None,
                       doi: str | None, url: str | None, abstract: str | None):
        if not ptitle or not abstract:
            return
        if title and is_same_work(ptitle, title):
            return
        key = (doi or pid or ptitle).strip().lower()
        if not key or key in seen_keys:
            return
        sents = _source_sentences(abstract, ptitle)
        if not sents:
            return
        seen_keys.add(key)
        clean_doi = (doi or "").replace("https://doi.org/", "").strip() or None
        sources.append({
            "key": key,
            "openalex_id": pid,
            "title": ptitle,
            "authors": [a for a in authors if a][:4],
            "year": year,
            "venue": venue or "Scholarly Venue",
            "doi": clean_doi,
            "url": f"https://doi.org/{clean_doi}" if clean_doi else (url or f"https://openalex.org/{pid}"),
            "abstract": abstract,
            "sentences": sents,
        })

    for sp in seed_papers:
        _add_candidate(
            str(sp.get("id") or ""),
            str(sp.get("title") or ""),
            list(sp.get("authors") or []),
            sp.get("year"),
            sp.get("venue"),
            sp.get("doi"),
            sp.get("url"),
            sp.get("abstract"),
        )

    for rows, err in batches:
        if err and not warnings:
            warnings.append(f"Some OpenAlex queries timed out ({err}); scored against available sources.")
        for w in rows:
            p = openalex.to_paper(w)
            _add_candidate(p.id, p.title, p.authors, p.year, p.venue, p.doi, p.url, p.abstract)
            if len(sources) >= max_sources:
                break
        if len(sources) >= max_sources:
            break

    return sources[:max_sources], warnings


async def _score_manuscript(
    title: str,
    text: str,
    sources: list[dict],
    exclude_quotes: bool = True,
) -> dict:
    """Annotate every paragraph & sentence with Turnitin-style similarity sources and AI stylometric signals."""
    paragraphs = _segment_paragraphs(text)
    tortured_hits = find_phrases([text], None)
    tortured_terms = {h.phrase.lower(): h for h in tortured_hits}

    # Flatten prose sentences for batched embedding comparison against source sentences
    flat_sents: list[tuple[int, int, str, list[str], bool]] = []
    for pi, p in enumerate(paragraphs):
        if p["kind"] != "prose":
            continue
        for si, s in enumerate(p["sentences"]):
            stext = s["text"]
            swords = _word_tokens(stext)
            is_quoted = bool(exclude_quotes and re.match(r'^["“].*["”][.!?]?$', stext.strip()))
            flat_sents.append((pi, si, stext, swords, is_quoted))

    # Build flat source sentence index
    flat_src: list[tuple[int, str, list[str]]] = []
    for src_idx, src in enumerate(sources):
        for ss in src["sentences"]:
            flat_src.append((src_idx, ss, _word_tokens(ss)))

    # Semantic similarity matrix (sentences x source_sentences)
    sim_matrix: list[list[float]] | None = None
    if flat_sents and flat_src:
        try:
            s_vecs = await embed_async([x[2][:500] for x in flat_sents])
            c_vecs = await embed_async([x[1][:500] for x in flat_src])
            mat = s_vecs @ c_vecs.T
            sim_matrix = mat.tolist()
        except Exception:
            sim_matrix = None

    raw_matches: dict[tuple[int, int], dict] = {}
    source_word_totals: dict[int, int] = defaultdict(int)
    source_hit_counts: dict[int, int] = defaultdict(int)

    for row_i, (pi, si, stext, swords, is_quoted) in enumerate(flat_sents):
        if is_quoted or len(swords) < 6 or not flat_src:
            continue
        best_score = 0.0
        best_kind: Literal["verbatim", "paraphrase"] | None = None
        best_src_idx = -1
        best_src_sent = ""
        best_ng4 = 0.0
        best_sem = 0.0

        for col_j, (src_idx, ss_text, ss_words) in enumerate(flat_src):
            ng4 = _ngram_containment(swords, ss_words, 4)
            ng3 = _ngram_containment(swords, ss_words, 3)
            sem = (
                float(sim_matrix[row_i][col_j])
                if sim_matrix is not None
                else fuzz.token_set_ratio(stext[:400], ss_text[:400]) / 100.0
            )
            kind: Literal["verbatim", "paraphrase"] | None = None
            combined = 0.0
            if ng4 >= 0.22 or ng3 >= 0.36:
                kind = "verbatim"
                combined = max(sem, min(0.99, 0.65 + ng4 * 0.7 + ng3 * 0.25))
            elif sem >= 0.80 or (sem >= 0.75 and ng3 >= 0.16):
                kind = "paraphrase"
                combined = sem

            if kind and combined > best_score:
                best_score = combined
                best_kind = kind
                best_src_idx = src_idx
                best_src_sent = ss_text
                best_ng4 = ng4
                best_sem = sem

        if best_kind and best_src_idx >= 0:
            raw_matches[(pi, si)] = {
                "raw_src_idx": best_src_idx,
                "kind": best_kind,
                "similarity": round(best_score, 3),
                "semantic_similarity": round(best_sem, 3),
                "ngram_overlap": round(best_ng4, 3),
                "matched_sentence": best_src_sent,
            }
            source_word_totals[best_src_idx] += len(swords)
            source_hit_counts[best_src_idx] += 1

    # Rank matched sources by total matched words descending -> assign Turnitin IDs 1..K
    ranked_srcs = sorted(source_word_totals.keys(), key=lambda k: -source_word_totals[k])
    src_id_map = {raw_idx: rank + 1 for rank, raw_idx in enumerate(ranked_srcs)}

    # Stylometric AI scoring + final sentence annotation
    total_words = 0
    sim_words = 0
    verbatim_words = 0
    paraphrase_words = 0
    ai_weighted_words = 0.0
    total_cliches = 0
    para_cvs: list[float] = []

    annotated_paragraphs: list[dict] = []
    flagged_sentences_flat: list[dict] = []

    for pi, p in enumerate(paragraphs):
        if p["kind"] != "prose":
            annotated_paragraphs.append({
                "index": pi,
                "kind": p["kind"],
                "raw": p["raw"],
                "burstiness_cv": None,
                "sentences": [],
            })
            continue

        lengths = [s["words"] for s in p["sentences"] if s["words"] >= 4]
        para_cv: float | None = None
        low_burstiness = False
        if len(lengths) >= 3:
            mean_len = statistics.mean(lengths)
            stdev_len = statistics.pstdev(lengths)
            para_cv = round(stdev_len / max(mean_len, 1.0), 3)
            para_cvs.append(para_cv)
            if para_cv < 0.22 and mean_len >= 13:
                low_burstiness = True

        # Check repetitive "This approach / This framework" openers across the paragraph
        anaphora_count = sum(1 for s in p["sentences"] if ANAPHORA_OPENER_RE.search(s["text"].strip()))

        sent_objs: list[dict] = []
        for si, s in enumerate(p["sentences"]):
            stext = s["text"]
            wc = s["words"]
            total_words += wc

            # 1) Similarity info
            m = raw_matches.get((pi, si))
            sim_obj = None
            if m:
                sid = src_id_map[m["raw_src_idx"]]
                color = SOURCE_COLORS[(sid - 1) % len(SOURCE_COLORS)]
                src_meta = sources[m["raw_src_idx"]]
                sim_words += wc
                if m["kind"] == "verbatim":
                    verbatim_words += wc
                else:
                    paraphrase_words += wc
                sim_obj = {
                    "source_id": sid,
                    "color": color,
                    "kind": m["kind"],
                    "similarity": m["similarity"],
                    "ngram_overlap": m["ngram_overlap"],
                    "matched_sentence": m["matched_sentence"],
                    "source_title": src_meta["title"],
                    "source_venue": src_meta["venue"],
                    "source_year": src_meta["year"],
                    "source_url": src_meta["url"],
                }

            # 2) Transparent stylometric AI signals
            ai_score = 0.0
            ai_reasons: list[str] = []

            matched_cliches: list[str] = []
            for label, pat in LLM_CLICHE_PATTERNS:
                found = pat.search(stext)
                if found:
                    matched_cliches.append(found.group(0).strip(" ,"))
            if matched_cliches:
                total_cliches += len(matched_cliches)
                ai_score += min(0.55, 0.34 * len(matched_cliches))
                ai_reasons.append(f"LLM cliché phrasing ({', '.join(repr(c) for c in matched_cliches[:3])})")

            if PARTICIPIAL_TAIL_RE.search(stext):
                ai_score += 0.28
                ai_reasons.append("RLHF participial tail clause (', highlighting / underscoring / thereby …')")

            if low_burstiness and wc >= 12:
                ai_score += 0.26
                ai_reasons.append(f"Uniform paragraph sentence cadence (burstiness CV={para_cv:.2f} < 0.22)")

            if anaphora_count >= 2 and ANAPHORA_OPENER_RE.search(stext.strip()):
                ai_score += 0.20
                ai_reasons.append("Repetitive demonstrative opener ('This framework / approach…')")

            stext_low = stext.lower()
            for tphrase, thit in tortured_terms.items():
                if tphrase in stext_low:
                    ai_score += 0.45
                    ai_reasons.append(f"Tortured phrase '{thit.phrase}' (expected '{thit.expected}')")

            # Moderate penalty for overly uniform 19-25 word zero-citation declarative sentences stacked together
            has_citation = bool(re.search(r"\[\d+(?:\s*[-,]\s*\d+)*\]|\([A-Z][A-Za-z\-]+(?:\s+et\s+al\.)?,?\s*\d{4}\)", stext))
            if low_burstiness and 17 <= wc <= 26 and not has_citation and not re.search(r"\d", stext):
                ai_score += 0.14
                if "Abstract declarative sentence without quantitative anchor or citation" not in ai_reasons:
                    ai_reasons.append("Unanchored mid-length declarative cadence without data or citation")

            ai_score = round(min(1.0, ai_score), 2)
            ai_band: Literal["high", "moderate", "low"] = (
                "high" if ai_score >= 0.52 else "moderate" if ai_score >= 0.34 else "low"
            )
            if ai_band == "high":
                ai_weighted_words += wc
            elif ai_band == "moderate":
                ai_weighted_words += wc * 0.5

            sent_id = f"p{pi}-s{si}"
            sobj = {
                "id": sent_id,
                "paragraph_index": pi,
                "sentence_index": si,
                "text": stext,
                "words": wc,
                "match": sim_obj,
                "ai_score": ai_score,
                "ai_band": ai_band,
                "ai_reasons": ai_reasons,
            }
            sent_objs.append(sobj)
            if sim_obj or ai_band in ("high", "moderate"):
                flagged_sentences_flat.append(sobj)

        annotated_paragraphs.append({
            "index": pi,
            "kind": "prose",
            "raw": p["raw"],
            "burstiness_cv": para_cv,
            "sentences": sent_objs,
        })

    denom = max(total_words, 1)
    similarity_pct = min(100, round(100 * sim_words / denom, 1))
    verbatim_pct = min(100, round(100 * verbatim_words / denom, 1))
    paraphrase_pct = min(100, round(100 * paraphrase_words / denom, 1))
    ai_pct = min(100, round(100 * ai_weighted_words / denom, 1))
    overall_cv = round(statistics.mean(para_cvs), 3) if para_cvs else 0.38

    matched_sources_out: list[dict] = []
    for raw_idx in ranked_srcs:
        sid = src_id_map[raw_idx]
        src = sources[raw_idx]
        mwords = source_word_totals[raw_idx]
        matched_sources_out.append({
            "id": sid,
            "color": SOURCE_COLORS[(sid - 1) % len(SOURCE_COLORS)],
            "title": src["title"],
            "authors": src["authors"],
            "year": src["year"],
            "venue": src["venue"],
            "doi": src["doi"],
            "url": src["url"],
            "matched_words": mwords,
            "occurrences": source_hit_counts[raw_idx],
            "pct": max(0.5, round(100 * mwords / denom, 1)),
        })

    return {
        "title": title,
        "total_words": total_words,
        "similarity_pct": similarity_pct,
        "verbatim_pct": verbatim_pct,
        "paraphrase_pct": paraphrase_pct,
        "ai_pct": ai_pct,
        "burstiness_cv": overall_cv,
        "cliche_count": total_cliches,
        "tortured_phrases": [h.model_dump() for h in tortured_hits],
        "flagged_count": len(flagged_sentences_flat),
        "sources_checked": len(sources),
        "sources": matched_sources_out,
        "paragraphs": annotated_paragraphs,
        "clean_text": text,
        "methodology": (
            "Similarity Index measures word-weighted sentence overlap against real OpenAlex scholarly works using "
            "4-gram/3-gram lexical containment (verbatim) and MiniLM cosine similarity >= 0.80 (paraphrase). "
            "AI Writing Indicator measures transparent stylometric signals: paragraph sentence-length burstiness (CV), "
            "documented RLHF discourse clichés, participial tail clauses, and Cabanac et al. tortured phrases."
        ),
    }


async def scan(
    text: str = "",
    title: str = "",
    document_id: str | None = None,
    paper_id: str | None = None,
    exclude_references: bool = True,
    exclude_quotes: bool = True,
) -> dict:
    """Run a full Turnitin-style Originality + AI Stylometric scan and persist the report."""
    resolved_title, resolved_text, seed_papers = _resolve_manuscript(
        text=text, title=title, document_id=document_id, paper_id=paper_id, exclude_references=exclude_references
    )
    if len(_word_tokens(resolved_text)) < 20:
        raise ValueError("Provide at least 20 words of manuscript text (or select a PDF / Paper Studio draft) to scan.")

    paragraphs = _segment_paragraphs(resolved_text)
    sources, warnings = await _gather_candidate_sources(resolved_title, paragraphs, seed_papers)
    scored = await _score_manuscript(resolved_title, resolved_text, sources, exclude_quotes=exclude_quotes)

    scan_id = uuid.uuid4().hex[:12]
    report = {
        "scan_id": scan_id,
        "document_id": document_id,
        "paper_id": paper_id,
        "exclude_references": exclude_references,
        "exclude_quotes": exclude_quotes,
        "warnings": warnings,
        "created_at": now().isoformat(),
        **scored,
        # Keep candidate sources internally so Reducer can re-score apples-to-apples without extra OpenAlex calls
        "_candidate_sources": sources,
    }
    get_store().put("originality_scan", scan_id, report)
    return {k: v for k, v in report.items() if not k.startswith("_")}


REDUCER_SYSTEM = """You are a senior IEEE/ACM academic copy-editor performing ethical originality & stylometric revision.
Rewrite the provided manuscript paragraph so that:
1. ZERO shared 4-gram phrasing remains with any listed external source sentence. Express background ideas in completely fresh clause structure, and when attributing prior work's findings, include a proper academic citation such as (Author et al., Year) if a matched source is listed and not already cited.
2. Natural human burstiness (CV > 0.35): deliberately vary sentence lengths! Combine at least one crisp, direct 7-11 word sentence with a richer 24-34 word analytical sentence. Do NOT write 3+ sentences of uniform ~20-word length.
3. Eliminate ALL AI-writing clichés and tells: never use 'delve', 'tapestry', 'testament to', 'pivotal', 'crucial role', 'underscores', 'in the realm of', 'paradigm shift', 'meticulously', 'seamlessly', 'multifaceted', 'it is worth noting', 'comprehensive overview', 'paves the way', 'sheds light on', 'fostering', or sentence-initial 'Moreover,' / 'Furthermore,' / 'Notably,'.
4. Eliminate participial '-ing' tail clauses (never end a sentence with ', highlighting...', ', underscoring...', ', showcasing...', ', ensuring...', ', thereby V-ing...'). Use active finite verbs instead.
5. Replace any tortured phrases with standard scientific terminology.
6. STRICT INTEGRITY: Preserve every existing citation marker (e.g. [1], [2, 3], (Smith, 2023)), every LaTeX math expression ($...$), every variable symbol, and every numerical value verbatim. Never invent experiments or numbers.
Return valid JSON matching the schema."""


def _deterministic_de_cliche(text: str) -> str:
    """Fast post-pass ensuring common LLM filler transitions are stripped even if an LLM left one behind."""
    replacements = [
        (r"\bIt is (?:worth noting|important to note|imperative to note) that\s+", ""),
        (r"\b(?:Moreover|Furthermore|Notably|Crucially|Importantly),\s+", ""),
        (r"\bdelves?\s+into\b", "examines"),
        (r"\bunderscores\s+the\b", "shows the"),
        (r"\bunderscore\s+the\b", "show the"),
        (r"\bpivotal\s+role\b", "central role"),
        (r"\bcrucial\s+role\b", "key role"),
        (r"\bin\s+the\s+realm\s+of\b", "in"),
        (r"\bmeticulously\b", "carefully"),
        (r"\bseamlessly\b", "directly"),
        (r"\bpaves\s+the\s+way\s+for\b", "enables"),
        (r"\bsheds\s+light\s+on\b", "clarifies"),
    ]
    out = text
    for pat, rep in replacements:
        out = re.sub(pat, rep, out, flags=re.I)
    # Capitalize sentence starts if stripping an opener left a lowercase letter
    out = re.sub(r"(^|[.!?]\s+)([a-z])", lambda m: m.group(1) + m.group(2).upper(), out)
    return out


async def reduce(
    scan_id: str | None = None,
    text: str = "",
    title: str = "",
    mode: Literal["both", "plagiarism", "ai"] = "both",
) -> dict:
    """Rewrite flagged paragraphs to reduce plagiarism overlap & AI stylometric markers, then re-score Before vs After."""
    if not llm.available():
        raise llm.LLMError("No LLM provider is configured to run the AI & Plagiarism Reducer.")

    stored = get_store().get("originality_scan", scan_id) if scan_id else None
    if not stored:
        fresh = await scan(text=text, title=title)
        stored = get_store().get("originality_scan", fresh["scan_id"])
    assert stored is not None

    sources: list[dict] = stored.get("_candidate_sources") or []
    paragraphs: list[dict] = stored["paragraphs"]

    # Identify prose paragraphs needing revision under the chosen mode
    targets: list[dict] = []
    for p in paragraphs:
        if p["kind"] != "prose":
            continue
        has_sim = any(s.get("match") for s in p["sentences"])
        has_ai = any(s.get("ai_band") in ("high", "moderate") for s in p["sentences"])
        need = (
            (has_sim or has_ai) if mode == "both"
            else has_sim if mode == "plagiarism"
            else has_ai
        )
        if need:
            targets.append(p)

    # Cap at 14 most-flagged paragraphs per single pass so latency stays interactive (~8-18s in parallel)
    targets.sort(
        key=lambda p: sum(
            (2.0 if s.get("match") else 0.0) + float(s.get("ai_score") or 0.0)
            for s in p["sentences"]
        ),
        reverse=True,
    )
    selected_indices = {p["index"] for p in targets[:14]}

    sem = asyncio.Semaphore(5)
    rewrites: dict[int, tuple[str, str]] = {}

    async def _rewrite_one(p: dict) -> None:
        flagged_notes: list[str] = []
        for s in p["sentences"]:
            m = s.get("match")
            if m and mode in ("both", "plagiarism"):
                src_raw = next((sr for sr in sources if sr["title"] == m["source_title"]), None)
                first_author = ((src_raw or {}).get("authors") or ["Author"])[0].split()[-1]
                yr = m.get("source_year") or "n.d."
                flagged_notes.append(
                    f"- SIMILARITY ({m['kind']}, {round(m['similarity'] * 100)}%): \"{s['text']}\"\n"
                    f"  Matched external source ({first_author} et al., {yr} — {m['source_title']}): \"{m['matched_sentence']}\""
                )
            if s.get("ai_band") in ("high", "moderate") and mode in ("both", "ai"):
                flagged_notes.append(
                    f"- AI STYLOMETRIC SIGNAL ({s['ai_band']}, score {s['ai_score']}): \"{s['text']}\"\n"
                    f"  Detected issues: {'; '.join(s.get('ai_reasons') or [])}"
                )

        prompt = (
            f"Manuscript Title: {stored['title']}\n"
            f"Revision Mode: {mode.upper()}\n\n"
            f"Original Paragraph:\n{p['raw']}\n\n"
            f"Flagged Sentences & Evidence to Fix:\n" + "\n".join(flagged_notes[:8]) + "\n\n"
            "Rewrite the full paragraph now so similarity overlap is eliminated (citing external prior work properly if needed) "
            "and sentence lengths have genuine human burstiness (mix one short <=10-word sentence with longer analytical clauses) "
            "with zero LLM clichés or participial '-ing' tails."
        )
        async with sem:
            res = await llm.complete_json(REDUCER_SYSTEM, prompt, _ParagraphRewrite, effort="medium")
            cleaned_para = _deterministic_de_cliche(res.rewritten.strip())
            rewrites[p["index"]] = (cleaned_para, res.changes_summary)

    if selected_indices:
        await asyncio.gather(*[_rewrite_one(p) for p in paragraphs if p["index"] in selected_indices])

    rebuilt_blocks: list[str] = []
    changes: list[dict] = []
    for p in paragraphs:
        idx = p["index"]
        if idx in rewrites:
            new_para, summary = rewrites[idx]
            rebuilt_blocks.append(new_para)
            changes.append({
                "paragraph_index": idx,
                "before": p["raw"],
                "after": new_para,
                "note": summary,
            })
        else:
            rebuilt_blocks.append(p["raw"])

    cleaned_text = "\n\n".join(rebuilt_blocks).strip()
    after_scored = await _score_manuscript(
        stored["title"], cleaned_text, sources, exclude_quotes=stored.get("exclude_quotes", True)
    )

    after_scan_id = uuid.uuid4().hex[:12]
    after_report = {
        "scan_id": after_scan_id,
        "document_id": stored.get("document_id"),
        "paper_id": stored.get("paper_id"),
        "exclude_references": stored.get("exclude_references", True),
        "exclude_quotes": stored.get("exclude_quotes", True),
        "warnings": stored.get("warnings", []),
        "created_at": now().isoformat(),
        **after_scored,
        "_candidate_sources": sources,
    }
    get_store().put("originality_scan", after_scan_id, after_report)

    return {
        "before_scan_id": stored["scan_id"],
        "after_scan_id": after_scan_id,
        "mode": mode,
        "paragraphs_rewritten": len(changes),
        "cleaned_text": cleaned_text,
        "before": {
            "similarity_pct": stored["similarity_pct"],
            "verbatim_pct": stored["verbatim_pct"],
            "paraphrase_pct": stored["paraphrase_pct"],
            "ai_pct": stored["ai_pct"],
            "burstiness_cv": stored["burstiness_cv"],
            "cliche_count": stored["cliche_count"],
            "flagged_count": stored["flagged_count"],
        },
        "after": {
            "similarity_pct": after_scored["similarity_pct"],
            "verbatim_pct": after_scored["verbatim_pct"],
            "paraphrase_pct": after_scored["paraphrase_pct"],
            "ai_pct": after_scored["ai_pct"],
            "burstiness_cv": after_scored["burstiness_cv"],
            "cliche_count": after_scored["cliche_count"],
            "flagged_count": after_scored["flagged_count"],
        },
        "changes": changes,
        "after_scan": {k: v for k, v in after_report.items() if not k.startswith("_")},
    }

