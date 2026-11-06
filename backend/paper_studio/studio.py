"""Paper Studio: a multi-agent research team plans, writes, reviews and verifies a research paper from a topic.

PLAN (plan_paper; in co-pilot mode the user reviews and edits the plan before writing)
  Scout        plans searches, picks the paper type (method / empirical study / review / position paper), searches
               OpenAlex + Semantic Scholar (+ arXiv), reranks by embedding similarity.
  Librarian    citation chaining: works cited by several of the most relevant papers join the pool; the reference list is
               chosen with quotas for seminal and recent work; Crossref retraction screening.
  Analyst      measured bibliometrics (10-year trends, age profile, citation skew, venues) and 300-DPI figures.
  Roundtable   four topic-specific experts question the corpus; contradicting findings are extracted as explicit conflicts.
  Dossier      a 2.5-3.5k-word grounded research dossier every writer works from.
  Architect    outline for the paper type; best-of-N title and research question; target-venue style card.
  Novelty      searches for prior work that already does the proposal; if found, cites it and repositions the contribution.
WRITE (write_from_plan)
  Data         the user's CSV is analysed with vetted statistics (real results); or, for method papers, pilot experiments
               run only when a benchmark dataset actually matches the topic.
  Writers      sections in dependency stages (foundations first, Introduction last) sharing a running paper memory;
               content checklists instead of word-count targets.
  Editor       whole-manuscript consistency pass (repetition, terminology, contradictions, cross-references).
  Reviewers    three aspect reviewers on different model families score the draft; flagged sections are revised.
  Librarian    finds claims that still lack evidence, searches again, cites a new source only if its abstract supports it.
  Verifier     every cited sentence checked against each cited abstract (incl. multi-citation synthesis claims), verbatim and
               paraphrase overlap, unmeasured numbers, Mermaid and LaTeX validity. Reviser fixes flagged paragraphs.
  Figures      a vision model checks every figure against its caption.
  Editor       three candidate abstracts, the best one chosen by a judge; per-citation provenance for the reader.

Strict scientific honesty rules:
  - Every reference is a real scholarly record with a DOI or URL, checked against Crossref retraction notices.
  - Every empirical/bibliometric number comes from fetched OpenAlex/Crossref data, executed experiments or the user's data.
  - Work that has not been run is presented as a design, hypothesis or protocol, never as a result.
"""
from __future__ import annotations

import asyncio
import base64
import json
import re
import statistics
import uuid
from collections import Counter
from datetime import date
from typing import Any

import numpy as np
from typing import Literal

from pydantic import BaseModel, Field

from backend.cache.store import get_store, now
from backend.common.config import get_settings
from backend.citeguard.overlap import find_overlaps
from backend.citeguard.phrases import find_phrases
from backend.citeguard.resolver import retraction_status
from backend.common.schemas import Paper
from backend.documents.parser import Paragraph
from backend.embeddings.model import embed_async
from backend.llm import client as llm
from backend.paper_studio import dossier as dossier_mod
from backend.paper_studio import datasets, experiment_agent, experiments, figures, literature, quality, review, userdata
from backend.paper_studio.paper_types import CLASSIFY_HINT, METHOD, PLANS, TYPE_LABEL, TypePlan
from backend.sources import arxiv, openalex
from backend.sources import semantic_scholar as s2
from backend.sources.http import SourceError

N_REFS = 32
FIG_URL = "/api/paper-studio/{pid}/fig/{name}.png"

DESIGN_SECTIONS = {
    "Problem Formulation and System Model",
    "Proposed Method",
    "Theoretical and Formal Analysis",
    "Experimental Setup and Ablation Protocol",
    "Experimental Protocol",
}


class StudioRequest(BaseModel):
    topic: str
    angle: str = ""                  # optional: the user's own idea / constraints
    template: str = "ieee"
    author: str = ""
    affiliation: str = ""
    ai_disclosure: bool = True
    max_refs: int = N_REFS           # set by the server from the user's plan, not trusted from the client
    seed_document_ids: list[str] = []   # the user's own study papers (uploaded PDFs), cited or mined for real refs
    paper_type: str = "auto"         # auto | method | empirical | review | position
    venue: str = ""                  # optional target journal / conference: its house style guides the writing
    dataset_id: str = ""             # optional CSV the user uploaded: analysed for real results
    dataset_note: str = ""           # what the dataset contains, in the user's words
    copilot: bool = False            # stop after planning so the user can review and edit the plan


# ---------- agent output schemas ----------

class _Plan(BaseModel):
    queries: list[str]
    trend_phrases: list[str]
    paper_type: Literal["method", "empirical", "review", "position"]
    type_reason: str


class _Brief(BaseModel):
    key: str
    brief: str
    refs: list[int]


class _Outline(BaseModel):
    title: str
    research_question: str
    contributions: list[str]
    method_acronym: str = Field(description="method papers only, else empty")
    method_name: str = Field(description="method papers: '<ACRONYM>: <full name>'; empirical: the study design name; else empty")
    method_summary: str = Field(description="method: technical specification; empirical: design, population, measures, analysis; "
                                            "review: scope and synthesis approach; position: the argument in brief")
    formal_assumptions: list[str] = Field(description="method papers only (A1-A3), else empty")
    formal_claim: str = Field(description="method papers only, else empty")
    failure_boundary: str = Field(description="method papers only, else empty")
    hypotheses: list[str] = Field(description="empirical: H1-H3; review: review questions RQ1-RQ3; else empty")
    themes: list[str] = Field(description="review: 3-4 themes; position: the 3 supporting claims; else empty")
    thesis: str = Field(description="position papers: one-sentence thesis; else empty")
    briefs: list[_Brief]


class _TitleRQ(BaseModel):
    title: str
    research_question: str


class _Candidates(BaseModel):
    options: list[_TitleRQ]


class _Pick(BaseModel):
    best: int
    reason: str


class _Front(BaseModel):
    abstracts: list[str] = Field(description="Three distinct candidate abstracts")
    keywords: list[str]
    highlights: list[str]
    summary: str


class _Rewrite(BaseModel):
    paragraph: str


class _Memory(BaseModel):
    key_points: list[str] = Field(description="5-8 points this section establishes, specific enough to avoid repeating them")
    terms: list[str] = Field(description="Terms, symbols or labels it defines, each as 'term: meaning'")


class _Fix(BaseModel):
    find: str = Field(description="Exact text copied from the paper (one sentence or less)")
    replace: str = Field(description="Replacement text; empty string deletes it")
    reason: str


class _Fixes(BaseModel):
    edits: list[_Fix]


# The technical-paper section plan (other paper types live in paper_types.py).
SECTIONS: list[tuple[str, str, str]] = [(x.key, x.heading, x.task) for x in METHOD.active(False)]

RULES = """Writing rules (strict):
- Authoritative journal style: clear, dense, technically precise academic English in original wording. Every paragraph adds
  a new point; no filler, no restating what another section already said (check PAPER MEMORY), no generic sentences that
  would fit any paper.
- Never copy or closely paraphrase sentences from reference abstracts. Synthesize ideas in fresh scholarly prose.
- Cite only with bracketed numbers from REFERENCES, e.g. [3] or [2], [7]. Cite a paper ONLY for what its abstract supports,
  and prefer comparing papers to listing them. Name an author only exactly as shown in REFERENCES (e.g. "Smith et al. [4]").
- Claim novelty precisely and modestly: never "the first", "novel" or "unprecedented" unless the dossier's novelty check
  supports it; describe work this paper proposes but has not run in the future or conditional tense.
- Never announce a table, figure or list ("as follows:", "the table below") unless you include it right there.
- Numbers, thresholds, sample sizes and hypothesis wording must be identical everywhere they appear.
- Hypotheses state a direction or a range decided before analysis, never an estimated value from FACTS.
- Never restate a formula in a simplified or different form (especially in the Abstract, Discussion or Conclusion): refer to
  it by its name or equation number, or copy it exactly.
- Say each point once, in the section where it belongs; later sections refer back instead of restating it.
- Claims of absence ("no study has...", "none of the works...") must be limited to the corpus reviewed here and say so.
- Never invent empirical numbers, benchmark scores, dataset sizes, p-values, or experimental outcomes. The ONLY empirical/bibliometric numbers you may report are in FACTS (or explicitly attributed to a cited abstract that states them).
- Use the terminology and notation in PAPER MEMORY exactly; introduce new terms explicitly.
- Output Markdown only. Start with the exact level-1 heading you are given. Use ## for subsections.
- Every Markdown table MUST be preceded on the immediately previous line by 'Table: <informative caption>'. Every Mermaid block MUST be preceded on the immediately previous line by 'Figure: <informative caption>'.
- Math: valid KaTeX/LaTeX only, inline $...$ and display $$...$$; never place two ^ or two _ on one base (write {x^{a}}^{b}); balance all braces and \\left / \\right pairs. Write intervals as $[0, 1]$ inside math.
- No meta-commentary, no notes to the reader, and no mention of prompts or how the manuscript was drafted."""

TYPE_RULES = {
    "method": "- The proposed method has NOT been empirically executed. Never write that it achieves, outperforms, reduces error by X%, demonstrates empirically, or attains state-of-the-art results; phrase expectations as hypotheses, design goals, or formal properties under the stated assumptions.",
    "empirical": "- Unless DATA ANALYSIS appears in FACTS, the study has NOT been run: describe it as a proposed study and never report its results. If DATA ANALYSIS is present, report only those numbers and describe the analysis as a secondary analysis of that dataset.",
    "review": "- This is a review: every claim about findings must cite the studies that report them. Do not present your own new results; the only numbers are those in FACTS or stated in cited abstracts.",
    "position": "- This is a position paper: separate evidence (cited) from argument (yours) explicitly. Do not present new empirical results.",
}


# ---------- helpers ----------

def _ieee_ref(p: Paper) -> str:
    def short(name: str) -> str:
        parts = name.replace(".", " ").split()
        return (" ".join(f"{x[0]}." for x in parts[:-1]) + " " + parts[-1]).strip() if parts else name
    names = [short(a) for a in p.authors if a][:6]
    au = (names[0] + " and " + names[1]) if len(names) == 2 else (", ".join(names[:-1]) + ", and " + names[-1]) if names[2:] else (names[0] if names else "Anonymous")
    if len(p.authors) > 6:
        au = ", ".join(names[:3]) + " et al."
    tail = f" doi: {p.doi}." if p.doi else (f" [Online]. Available: {p.url}" if p.url else "")
    venue = f" *{p.venue}*," if p.venue else ""
    return f'{au}, "{p.title}",{venue} {p.year or "n.d."}.{tail}'


def _tags(p: Paper) -> str:
    t = []
    if any(x in ("Review", "MetaAnalysis") for x in p.pub_types):
        t.append("review" if "Review" in p.pub_types else "meta-analysis")
    if p.influential:
        t.append(f"{p.influential} influential citations")
    return f" [{'; '.join(t)}]" if t else ""


def _who(p: Paper) -> str:
    if not p.authors:
        return ""
    last = p.authors[0].split()[-1] if p.authors[0].split() else p.authors[0]
    return f"{last}{' et al.' if len(p.authors) > 2 else (' and ' + p.authors[1].split()[-1] if len(p.authors) == 2 and p.authors[1].split() else '')}, "


def _ref_listing(refs: list[Paper], ids: list[int] | None = None, abstract_chars: int = 440) -> str:
    rows = []
    for i, p in enumerate(refs, 1):
        if ids and i not in ids:
            rows.append(f"[{i}] {_who(p)}{p.title} ({p.year}){_tags(p)}" + (f" TL;DR: {p.tldr}" if p.tldr else ""))
        else:
            rows.append(f"[{i}] {_who(p)}{p.title} ({p.year}, {p.venue or 'n/a'}){_tags(p)}\n    Abstract: {(p.abstract or '')[:abstract_chars]}")
    return "\n".join(rows)


_CITE = re.compile(r"\[(\d+(?:\s*[,–-]\s*\d+)*)\]")


def _nums(group: str) -> list[int]:
    out: list[int] = []
    for part in re.split(r"\s*,\s*", group):
        if re.search(r"[–-]", part):
            a, b = (int(x) for x in re.split(r"\s*[–-]\s*", part)[:2])
            out += list(range(a, b + 1)) if 0 < b - a < 10 else [a, b]
        elif part.strip().isdigit():
            out.append(int(part))
    return out


_PROTECT = re.compile(r"```.*?```|\$\$.*?\$\$|(?<![\\$])\$[^$\n]+?\$", re.S)


def _sub_citations(md: str, fn) -> str:
    """Apply a citation substitution only outside code fences and math, so intervals like $[0, 1]$ are never touched."""
    out, pos = [], 0
    for m in _PROTECT.finditer(md):
        out.append(_CITE.sub(fn, md[pos:m.start()]))
        out.append(m.group(0))
        pos = m.end()
    out.append(_CITE.sub(fn, md[pos:]))
    return "".join(out)


def _iter_citations(md: str):
    """Citation groups outside code and math, in order (a group containing 0 is an interval, not a citation)."""
    plain = _PROTECT.sub(lambda m: " " * len(m.group(0)), md)
    for m in _CITE.finditer(plain):
        if 0 not in _nums(m.group(1)):
            yield m


def _fix_citations(md: str, n_refs: int) -> tuple[str, int]:
    """Drop citation numbers outside 1..n_refs. Returns (markdown, removed)."""
    removed = 0

    def sub(m: re.Match) -> str:
        nonlocal removed
        ns = _nums(m.group(1))
        if 0 in ns:                       # "[0, 1]" in prose is an interval, not a citation
            return m.group(0)
        ok = [n for n in dict.fromkeys(ns) if 1 <= n <= n_refs]
        removed += len(ns) - len(ok)
        return "[" + ", ".join(map(str, ok)) + "]" if ok else ""
    return _sub_citations(md, sub), removed


def _clip(text: str, n: int) -> str:
    """Shorten at a word boundary with an ellipsis (never mid-word)."""
    text = " ".join((text or "").split())
    return text if len(text) <= n else text[:n].rsplit(" ", 1)[0].rstrip(",;:") + "…"


_INTERNAL_TAG = re.compile(r"\s*\[(?:pipeline|executed|sandbox|facts?|data analysis|measured)\]", re.I)


def _merge_duplicate_refs(md: str, refs: list[Paper]) -> tuple[str, int]:
    """The same work can arrive twice from different databases (an OpenAlex and a Semantic Scholar id with one DOI).
    Point every citation of a duplicate at the first copy, so the reference list never shows one work twice."""
    from rapidfuzz import fuzz
    canon: dict[int, int] = {}
    keys: list[tuple[int, str, str]] = []
    for n, p in enumerate(refs, 1):
        doi, nt = (p.doi or "").lower().strip(), literature._norm_title(p.title)
        hit = next((k for k, d, t in keys if (doi and doi == d) or (nt and len(nt) > 15 and fuzz.ratio(nt, t) >= 94)), None)
        if hit is None:
            keys.append((n, doi, nt))
        else:
            canon[n] = hit
    if not canon:
        return md, 0

    def sub(m: re.Match) -> str:
        ns = _nums(m.group(1))
        if 0 in ns:
            return m.group(0)
        out = list(dict.fromkeys(canon.get(n, n) for n in ns))
        return "[" + ", ".join(map(str, out)) + "]"
    md = _sub_citations(md, sub)
    md = re.sub(r"(\[\d+(?:, \d+)*\])(?:,?\s*\1)+", r"\1", md)     # "[16], [16]" -> "[16]"
    return md, len(canon)


def _renumber(md: str) -> tuple[str, list[int]]:
    """Renumber citations by first appearance. Returns (markdown, old ids in new order)."""
    order: list[int] = []
    for m in _iter_citations(md):
        for n in _nums(m.group(1)):
            if n not in order:
                order.append(n)
    new = {old: i for i, old in enumerate(order, 1)}

    def sub(m: re.Match) -> str:
        ns = _nums(m.group(1))
        if 0 in ns:
            return m.group(0)
        ns = sorted({new[n] for n in ns if n in new})
        return "[" + ", ".join(map(str, ns)) + "]" if ns else ""
    return _sub_citations(md, sub), order


def _sanitize_mermaid(md: str) -> str:
    def clean(block: re.Match) -> str:
        body = re.sub(r"\[([^\]]*)\]", lambda m: "[" + re.sub(r"[()\"'`{}<>|;]", " ", m.group(1)).strip() + "]", block.group(2))
        body = re.sub(r"\{([^}]*)\}", lambda m: "{" + re.sub(r"[()\"'`<>|;\[\]]", " ", m.group(1)).strip() + "}", body)
        keep = re.compile(r"^\s*(flowchart|graph|subgraph|end\b|classDef|class |style |linkStyle|%%)|--|==|^\s*\w+\s*[\[\({]")
        body = "\n".join(ln for ln in body.splitlines() if not ln.strip() or keep.search(ln))
        return block.group(1) + body + block.group(3)
    return re.sub(r"(```mermaid\n)(.*?)(\n```)", clean, md, flags=re.S)


_NODE = (r"[A-Za-z][\w]*(?:\[\[[^\[\]]*\]\]|\[\([^()]*\)\]|\(\[[^\[\]]*\]\)|\(\([^()]*\)\)|\[[^\[\]()\"]*\]"
         r"|\([^()\[\]]*\)|\{[^{}()]*\}|>[^\]]*\])?")
_EDGE = r"\s*(?:-->|---|-\.->|==>|--[ox]|--\s+[^-|>]+\s+-->)(?:\|[^|]*\|)?\s*"
_FLOW_LINE = re.compile(rf"^\s*{_NODE}(?:\s*&\s*{_NODE})*(?:{_EDGE}{_NODE}(?:\s*&\s*{_NODE})*)*\s*;?\s*$")
_META_LINE = re.compile(r"^\s*(subgraph\b.*|end|classDef\b.*|class\s.*|style\s.*|linkStyle\s.*|%%.*|direction\s+\w+)\s*$")


def mermaid_problems(code: str) -> list[str]:
    """Lines that our flowchart subset can't parse (empty list = OK)."""
    lines = [ln for ln in code.splitlines() if ln.strip()]
    if not lines or not re.match(r"^\s*(flowchart|graph)\s+(LR|RL|TD|TB|BT)\s*$", lines[0]):
        return ["first line must be 'flowchart LR' or 'flowchart TD'"]
    bad = [ln.strip() for ln in lines[1:] if not (_FLOW_LINE.match(ln) or _META_LINE.match(ln))]
    if not any(re.search(r"-->|---|==>|-\.->", ln) for ln in lines[1:]):
        bad.append("no connections between nodes")
    return bad


class _Diagram(BaseModel):
    code: str


async def fix_diagrams(md: str) -> tuple[str, int, int]:
    """Validate every Mermaid block; repair with the model once, else drop bad lines, else remove the figure.
    Returns (markdown, repaired, removed)."""
    repaired = removed = 0
    blocks = list(re.finditer(r"(?:^Figure:[^\n]*\n)?```mermaid\n(.*?)\n```", md, re.S | re.M))
    for m in reversed(blocks):
        code = m.group(1)
        probs = mermaid_problems(code)
        if not probs:
            continue
        new = None
        try:
            out = await llm.complete_json(
                "You fix Mermaid flowchart code. Use only: 'flowchart LR' or 'flowchart TD' on the first line; node ids are "
                "letters/digits; labels in [ ] or { } with plain words (no brackets, quotes or parentheses inside); edges -->. "
                "Keep the same meaning. Return only the diagram code, no fences.",
                f"CODE:\n{code}\n\nPROBLEMS:\n- " + "\n- ".join(probs[:8]), _Diagram, effort="low", tier="fast")
            cand = re.sub(r"^```(?:mermaid)?\n?|\n?```$", "", out.code.strip())
            if not mermaid_problems(cand):
                new = cand
        except llm.LLMError:
            new = None
        if new is None:
            keep = [ln for ln in code.splitlines() if ln.strip() and (ln is code.splitlines()[0] or _FLOW_LINE.match(ln) or _META_LINE.match(ln))]
            cand = "\n".join(keep)
            new = cand if not mermaid_problems(cand) else None
        if new is None:
            md = md[: m.start()] + md[m.end():]
            removed += 1
        else:
            cap_end = m.group(0).find("```mermaid")
            md = md[: m.start()] + m.group(0)[:cap_end] + f"```mermaid\n{new}\n```" + md[m.end():]
            repaired += 1
    return md, repaired, removed


async def ensure_workflow_diagram(md: str) -> str:
    """Every paper gets an experimental-workflow flowchart in its protocol section (writers occasionally skip it)."""
    m = re.search(r"(?ms)^# (?:Experimental Setup and Ablation Protocol|Experimental Protocol)\s*\n(.*?)(?=^# )", md)
    if not m or "```mermaid" in m.group(1):
        return md
    try:
        out = await llm.complete_json(
            "You draw a Mermaid flowchart of an experimental workflow. First line 'flowchart TD'; 5-8 nodes; single-letter "
            "ids; labels in [ ] (or { } for a decision) with plain words only; edges -->. Return only the code.",
            f"EXPERIMENTAL PROTOCOL:\n{m.group(1)[:5000]}", _Diagram, effort="low", tier="fast")
        code = re.sub(r"^```(?:mermaid)?\n?|\n?```$", "", out.code.strip())
    except llm.LLMError:
        return md
    if mermaid_problems(code):
        return md
    block = f"\nFigure: Leak-free evaluation and ablation workflow\n```mermaid\n{code}\n```\n\n"
    return md[: m.end(1)].rstrip() + "\n" + block + md[m.end(1):]


_TABLE_OK = re.compile(r"notation|complexity|position|planned|ablation|per year|publication count|key works|representative|"
                       r"failure|mitigation|hypothes|assumption|dataset|baseline|metric|qualitative|comparison of|symbol", re.I)


def strip_unmeasured_tables(md: str, allowed: set[str]) -> tuple[str, int]:
    """Remove tables that report numbers nobody measured (e.g. 'results' of an experiment that was never run).
    Planned-evaluation, notation, complexity, positioning and bibliometric tables are kept."""
    removed = 0
    pat = re.compile(r"(?m)^Table:[^\n]*\n(?:[ \t]*\n)?(?:[ \t]*\|.*\|[ \t]*\n?)+")
    for m in reversed(list(pat.finditer(md))):
        block = m.group(0)
        caption = block.split("\n", 1)[0]
        if _TABLE_OK.search(caption) or "to be measured" in block.lower():
            continue
        cells = [c.strip() for ln in block.splitlines()[1:] if ln.strip().startswith("|") for c in ln.strip().strip("|").split("|")]
        nums = [n.replace(",", "") for c in cells for n in re.findall(r"(?<![\w$\\])\d+(?:[.,]\d+)?", re.sub(r"\$[^$]*\$", "", c))]
        bad = [n for n in nums if n not in allowed and not (len(n) == 4 and n.startswith(("19", "20"))) and not (n.isdigit() and int(n) <= 10)]
        if len(bad) >= 3:
            md = md[: m.start()] + md[m.end():]
            removed += 1
    return md, removed


def _paragraphs(md: str) -> list[tuple[int, int, str]]:
    """Prose paragraphs (start, end, text) outside code fences, tables, headings, lists, math, figures, blockquotes."""
    out, pos, fence = [], 0, False
    for chunk in re.split(r"(\n\s*\n)", md):
        start, end = pos, pos + len(chunk)
        pos = end
        s = chunk.strip()
        if s.count("```") % 2 == 1:
            fence = not fence
            continue
        if fence or not s or re.match(r"^(#|\||```|\$\$|!\[|figure:|table:|>\s|\*\*algorithm\s|\*proof|[-*+]\s|\d+[.)]\s|\[\[)", s, re.I):
            continue
        if len(s.split()) >= 25:
            out.append((start, end, chunk))
    return out


class _Redundant(BaseModel):
    ids: list[int] = Field(description="Paragraph numbers whose every point is already made earlier in the paper")
    reasons: list[str] = Field(description="For each id, where the point was already made")


_KEEP_SECTIONS = re.compile(r"abstract|result|simulation|experiment|data availability|conclusion", re.I)


async def cut_redundant(body: str, prefer: list[str] | None = None, max_share: float = 0.12) -> tuple[str, int]:
    """Delete prose paragraphs that only restate points made earlier (semantic repetition that sentence-level edits miss).
    Never touches results / simulation sections, the abstract or conclusion, tables, equations or figures."""
    paras = [(st, en, t) for st, en, t in _paragraphs(body) if not _KEEP_SECTIONS.search(_section_of(body, st))]
    if len(paras) < 12:
        return body, 0
    listing, sec = [], ""
    for k, (st, _, t) in enumerate(paras, 1):
        if (s_ := _section_of(body, st)) != sec:
            sec = s_
            listing.append(f"\n## {sec}")
        listing.append(f"[P{k}] {' '.join(t.split())}")
    limit = max(1, int(len(paras) * max_share))
    try:
        r = await llm.complete_json(
            "You are a journal editor cutting a manuscript for concision. You remove whole paragraphs that add nothing new.",
            "PARAGRAPHS (in paper order; results sections are not shown and stay as they are):\n" + "\n".join(listing)[: llm.context_chars() - 6000]
            + f"\n\nReturn the numbers of at most {limit} paragraphs whose EVERY point (claim, gap, motivation, definition, "
            "argument) is already made in an earlier paragraph, so deleting them loses nothing. Never pick a paragraph that is "
            "the only place a number, a citation's specific finding, a definition, a hypothesis or a design decision appears. "
            "If nothing is redundant, return an empty list.", _Redundant, effort="medium", max_tokens=3000, prefer=prefer)
    except llm.LLMError:
        return body, 0
    picked = sorted({i for i in r.ids if 1 <= i <= len(paras)})[:limit]
    for i in sorted(picked, reverse=True):
        st, en, _ = paras[i - 1]
        body = body[:st] + body[en:]
    return re.sub(r"\n{3,}", "\n\n", body), len(picked)


def _section_of(md: str, pos: int) -> str:
    heads = [m for m in re.finditer(r"^# (.+)$", md[:pos], re.M)]
    return heads[-1].group(1).strip() if heads else ""


def math_problem(tex: str) -> str | None:
    """Cheap LaTeX sanity check for the mistakes models make most (KaTeX would reject these)."""
    t = re.sub(r"\\[{}$%&#_^]", "", tex)
    depth = 0
    for ch in t:
        depth += (ch == "{") - (ch == "}")
        if depth < 0:
            return "unbalanced braces"
    if depth:
        return "unbalanced braces"
    if len(re.findall(r"\\left\b", t)) != len(re.findall(r"\\right\b", t)):
        return "\\left / \\right mismatch"
    if sorted(re.findall(r"\\begin\{(\w+\*?)\}", t)) != sorted(re.findall(r"\\end\{(\w+\*?)\}", t)):
        return "\\begin / \\end mismatch"
    flat = t
    while True:   # collapse innermost groups so scripts attach to single atoms
        nxt = re.sub(r"\{[^{}]*\}", "G", flat)
        if nxt == flat:
            break
        flat = nxt
    if re.search(r"\^\s*(?:G|\\[A-Za-z]+|[^\s^_])\s*\^", flat):
        return "double superscript"
    if re.search(r"_\s*(?:G|\\[A-Za-z]+|[^\s^_])\s*_", flat):
        return "double subscript"
    return None


def _math_spans(md: str) -> list[tuple[int, int, str, bool]]:
    """(start, end, tex, display) for $$...$$ and $...$ spans outside code fences."""
    out = []
    for m in re.finditer(r"\$\$(.+?)\$\$|(?<![\\$])\$([^$\n]+?)\$", md, re.S):
        out.append((m.start(), m.end(), m.group(1) if m.group(1) is not None else m.group(2), m.group(1) is not None))
    return out


class _Tex(BaseModel):
    latex: str


def _shingles(text: str, n: int = 8) -> set[str]:
    w = re.findall(r"[a-z0-9]+", text.lower())
    return {" ".join(w[i:i + n]) for i in range(len(w) - n + 1)}


def _verbatim(text: str, abstracts: set[str]) -> int:
    return len(_shingles(text) & abstracts)


_RESULT_CLAIM = re.compile(
    r"\b(we|our|this (?:paper|work|study|method|approach|framework|system)|the proposed|it)\b[^.]{0,80}\b("
    r"achiev\w*|outperform\w*|demonstrat\w*|improv\w* (?:\w+ )?by|reduc\w* (?:\w+ )?by|increas\w* (?:\w+ )?by|"
    r"yield\w*|attain\w*|surpass\w*|show(?:s|ed)? that)\b", re.I)
_NUM = re.compile(r"(?<![\w\[.])(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?(%|x\b|×)?")


def _allowed_numbers(*texts: str) -> set[str]:
    return {m.group(1).replace(",", "") for t in texts for m in _NUM.finditer(t)}


def _unmeasured(text: str, allowed: set[str], method: str = "") -> list[str]:
    """Sentences that state numbers we never measured, or claim results for the (unrun) proposed method."""
    names = [n for n in {re.sub(r"\s*\(.*?\)", "", method.split(":")[0]).strip(), *re.findall(r"\(([A-Z][\w-]{1,15})\)", method)} if len(n) > 1]
    by_name = [re.compile(re.escape(n) + r"\b[^.]{0,60}\b(achiev|outperform|demonstrat|surpass|attain|yield)", re.I) for n in names]
    out = []
    for sent in re.split(r"(?<=[.!?])\s+", text):
        clean = _CITE.sub("", re.sub(r"\$[^$]*\$", "", sent))
        clean_no_sec = re.sub(r"\b(?:Section|Sec\.|Fig\.|Figure|Table|Algorithm|Assumption|Proposition|Lemma|Theorem|Corollary|Eq\.|Equation|Hypothesis)\s+[A-Z]?\d+(?:\.\d+)?", "", clean, flags=re.I)
        nums = [m.group(1).replace(",", "") for m in _NUM.finditer(clean_no_sec)]
        bad = [n for n in nums if n not in allowed and not (len(n) == 4 and n.startswith(("19", "20")))
               and not (n.isdigit() and int(n) <= 10)]
        if bad:
            out.append(f"“{sent.strip()}” states unmeasured number(s) {', '.join(bad)}; remove them or attribute them to the cited source")
        elif (_RESULT_CLAIM.search(clean) or any(r.search(clean) for r in by_name)) and not re.search(r"\b(hypothes|expect|will|would|could|may|might|designed|aim|intend|propose|analytical|under assumption)", clean, re.I):
            out.append(f"“{sent.strip()}” claims a result for work that has not been run; rephrase it as a design goal or hypothesis")
    return out


# ---------- the run ----------
#
# Two stages. plan_paper() researches and designs the paper and stores a plan; write_from_plan() writes, checks and
# reviews it. In co-pilot mode the user edits the plan in between (title, research question, contributions, section
# briefs, excluded references, extra instructions). run() does both back to back.

PLAN_KIND = "paper_plan"


def _best() -> list[str]:
    """Strongest models for the quality-critical steps (paid users only: llm ignores `prefer` for the free engine)."""
    return [m.strip() for m in (get_settings().studio_models or "").split(",") if m.strip()]


class _Reposition(BaseModel):
    title: str
    research_question: str
    contributions: list[str]
    method_summary: str


def _say_fn(ctx):
    async def say(agent: str, state: str, text: str, progress: float | None = None, **extra: Any) -> None:
        await ctx.update(agent, json.dumps({"agent": agent, "state": state, "text": text, **extra}), progress)
    return say


def _squash(t: str) -> str:
    """Normalised sentence key: whitespace and citation markers removed (numbers change when citations are renumbered)."""
    return re.sub(r"\s+", " ", _CITE.sub("", t)).strip().lower()


async def run(req: StudioRequest, ctx) -> str:
    """Plan the paper and write it. In co-pilot mode, stop after planning and return the plan id (it starts with 'pl')."""
    plan_id = await plan_paper(req, ctx)
    if req.copilot:
        return plan_id
    return await write_from_plan(plan_id, {}, ctx)


async def _pick(kind: str, options: list[str], rubric: str, context: str = "") -> int:
    """LLM judge: index of the best option (0 if the judge is unavailable)."""
    if len(options) < 2:
        return 0
    try:
        out = await llm.complete_json(
            f"You are a demanding senior editor choosing the best {kind}. {rubric}",
            (f"CONTEXT:\n{context}\n\n" if context else "") + "\n\n".join(f"OPTION {i}:\n{o}" for i, o in enumerate(options))
            + "\n\nReturn the number of the best option and a one-sentence reason.", _Pick, effort="low")
        return out.best if 0 <= out.best < len(options) else 0
    except llm.LLMError:
        return 0


async def _best_title_rq(outline: _Outline, dossier: str, ptype: str) -> _Outline:
    """Best-of-N for the two shortest, highest-impact parts of the paper."""
    try:
        alts = await llm.complete_json(
            "You propose alternative titles and research questions for a paper. Each must be specific, honest about what the "
            "paper does (no overclaiming), and grounded in the dossier.",
            f"PAPER TYPE: {TYPE_LABEL[ptype]}\nCURRENT TITLE: {outline.title}\nCURRENT RESEARCH QUESTION: {outline.research_question}\n"
            f"CONTRIBUTIONS: {outline.contributions}\n\nDOSSIER (gap section is most relevant):\n{dossier[-6000:]}\n\n"
            "Give 3 distinct alternatives.", _Candidates, effort="low", tier="fast")
    except llm.LLMError:
        return outline
    opts = [_TitleRQ(title=outline.title, research_question=outline.research_question)] + alts.options[:3]
    k = await _pick("title and research question",
                    [f"Title: {o.title}\nResearch question: {o.research_question}" for o in opts],
                    "Prefer: a precise, informative title; one sharp, answerable research question that the contributions really "
                    "answer; no hype or claims of results that were not measured.",
                    f"Contributions: {outline.contributions}")
    outline.title, outline.research_question = opts[k].title, opts[k].research_question
    return outline


def _proposal(o: _Outline, ptype: str) -> str:
    if ptype == "method":
        return f"{o.method_name}. {o.method_summary}"
    if ptype == "empirical":
        return f"{o.research_question} {' '.join(o.hypotheses)} {o.method_summary}"
    if ptype == "review":
        return f"A literature review: {o.research_question} Themes: {'; '.join(o.themes)}"
    return f"{o.thesis} {' '.join(o.themes)}"


async def plan_paper(req: StudioRequest, ctx) -> str:
    pid = uuid.uuid4().hex[:10]
    plan_id = "pl" + uuid.uuid4().hex[:10]
    store = get_store()
    topic = req.topic.strip()[:300]
    angle = req.angle.strip()[:1500]
    this_year = date.today().year
    say = _say_fn(ctx)

    # ---- Scout ----
    await say("scout", "run", "Planning literature searches and choosing the paper type…", 0.02)
    seeds, seed_notes = await _seed_papers(req.seed_document_ids[:8], say)
    seed_hint = ("\nStudy notes from user-uploaded papers:\n" + "\n".join(seed_notes[:3])) if seed_notes else ""
    plan = await llm.complete_json(
        "You plan comprehensive scholarly literature searches and decide what kind of paper a topic calls for.",
        f"Topic: {topic}\nAuthor's angle: {angle or '(none)'}{seed_hint}\n\nPAPER TYPES: {CLASSIFY_HINT}\n\n"
        "Give 4 distinct, complementary search queries (3-6 words each) covering foundations, core methods or findings, recent "
        "work, and evaluation or evidence; 2-3 concise noun phrases (1-3 words, as they appear in titles/abstracts) whose "
        "10-year publication trend should be measured; the paper type that fits best; and a one-sentence reason.",
        _Plan, effort="low", tier="fast")
    ptype = req.paper_type if req.paper_type in PLANS else plan.paper_type
    tplan = PLANS[ptype]
    await say("scout", "run", f"Paper type: {TYPE_LABEL[ptype]}", 0.03)
    queries = [q for q in plan.queries if q.strip()][:4] or [topic]
    cands: dict[str, Paper] = {}
    sources_used: Counter = Counter()
    raw_seen: Counter = Counter()

    def _take(p: Paper, src: str) -> None:
        raw_seen[src] += 1
        if p.title and p.abstract and len(p.abstract) > 180 and p.id not in cands \
                and not any(c.title.strip().lower() == p.title.strip().lower() for c in cands.values()):
            cands[p.id] = p
            sources_used[src] += 1
    for q in queries:
        await say("scout", "run", f"Searching OpenAlex: “{q}”", 0.05)
        try:
            f = await openalex.related_works(q, per_page=45)
        except SourceError:
            continue
        for w in (f.data or {}).get("results", []):
            _take(openalex.to_paper(w), "OpenAlex")
    for q in [topic] + queries[:1]:
        await say("scout", "run", f"Searching Semantic Scholar: “{q}”", 0.06)
        try:
            f = await s2.search(q, limit=40)
        except SourceError:
            break
        for w in (f.data or {}).get("data", []) or []:
            _take(s2.to_paper(w), "Semantic Scholar")
    if len(cands) < 24:
        for q in [topic] + queries[:2]:
            await say("scout", "run", f"Searching arXiv: “{q}”", 0.07)
            try:
                f = await arxiv.search_relevant(q, max_results=40)
            except SourceError:
                break
            for p in arxiv.parse_feed(f.data):
                _take(p, "arXiv")
            if len(cands) >= 40:
                break
    for p in seeds:
        cands.pop(p.id, None)
    if len(cands) + len(seeds) < 6:
        raise RuntimeError("The scholarly databases returned too few papers just now (they may be busy). "
                           "Please try again in a few minutes, or rephrase the topic with more specific keywords.")
    pool = list(cands.values())
    tv = await embed_async([f"{topic}. {angle}"])
    sims = (await embed_async([f"{p.title}. {p.abstract}" for p in pool]) @ tv.T).ravel()

    # ---- Librarian: citation chaining from the most relevant papers ----
    await say("librarian", "run", "Following the reference lists of the most relevant papers…", 0.08)
    top = [pool[i] for i in np.argsort(-sims)[:20]] + seeds
    snow = await literature.snowball(top, set(cands) | {p.id for p in seeds})
    if snow:
        pool += snow
        sims = np.concatenate([sims, (await embed_async([f"{p.title}. {p.abstract}" for p in snow]) @ tv.T).ravel()])
    await say("librarian", "run", "Asking Semantic Scholar for related work and influence data…", 0.09)
    head = [pool[i] for i in np.argsort(-sims)[:80]] + seeds
    enriched = await literature.enrich(head)
    recs = await literature.recommended([p for p in head if p.corpus_id or p.id.startswith("s2:")][:10] or head[:10],
                                        {p.title for p in pool} | {p.title for p in seeds})
    if recs:   # keep only recommendations at least as relevant as the median of the top of the pool
        rs = (await embed_async([f"{p.title}. {p.abstract}" for p in recs]) @ tv.T).ravel()
        bar = float(np.median(np.sort(sims)[::-1][:40]))
        recs = [p for p, x in zip(recs, rs) if x >= bar]
    if recs:
        pool += recs
        sims = np.concatenate([sims, (await embed_async([f"{p.title}. {p.abstract}" for p in recs]) @ tv.T).ravel()])
        sources_used["Semantic Scholar recommendations"] += len(recs)
    await say("librarian", "done", f"{len(snow)} work(s) via citation chaining · {len(recs)} via recommendations · {enriched} enriched", 0.1)
    sims = sims - np.array([literature.venue_penalty(p) for p in pool])
    pool_d, dup_n = literature.dedupe([pool[i] for i in np.argsort(-sims)])
    keep = {id(p) for p in pool_d}
    mask = np.array([id(p) in keep for p in pool])
    pool, sims = [p for p in pool if id(p) in keep], sims[mask]
    ranked = literature.balanced_select(pool, sims, req.max_refs + 8, this_year, seeds, {p.id for p in snow} | {p.id for p in recs})
    ranked, _ = literature.dedupe(ranked)
    await say("scout", "run", f"{len(pool)} candidate papers; screening {len(ranked)} against Crossref retractions…", 0.1)
    sem = asyncio.Semaphore(6)

    async def status(p: Paper) -> str:
        if not p.doi:
            return "not_checked"
        async with sem:
            try:
                return (await retraction_status(p.doi))[0]
            except Exception:
                return "could_not_verify"
    statuses = await asyncio.gather(*(status(p) for p in ranked))
    dropped = [p for p, s in zip(ranked, statuses) if s in ("retracted", "expression_of_concern")]
    refs = [p for p, s in zip(ranked, statuses) if s not in ("retracted", "expression_of_concern")][:req.max_refs]
    checked = sum(s in ("none_found", "corrected") for s in statuses)
    await literature.enrich([p for p in refs if not p.corpus_id])
    await say("scout", "done", f"{len(refs)} verified references selected from {len(pool)} candidates · {checked} retraction-clear"
              + (f" · {len(dropped)} retracted work(s) excluded" if dropped else ""), 0.14)

    # ---- Analyst ----
    await say("analyst", "run", "Measuring 10-year publication trends, impact & venue distribution…", 0.16)
    phrases = [p.strip() for p in plan.trend_phrases if p.strip()][:3] or [topic]
    trends: dict[str, dict[int, int]] = {}
    for ph in phrases:
        try:
            counts, _ = await openalex.trend(ph, from_year=this_year - 10)
            counts = {y: n for y, n in counts.items() if y < this_year}   # a partial year only confuses readers
            if counts:
                trends[ph] = counts
        except SourceError:
            pass
    venue_counts = Counter(p.venue.strip() for p in pool + refs
                           if p.venue and p.venue.strip() and p.venue.strip().lower() not in ("n/a", "unknown"))
    top_venues = venue_counts.most_common(8)
    figs: dict[str, tuple[bytes, str]] = {}
    if trends:
        figs["trend"] = (figures.trend_chart(trends), "Annual publication trajectory for core topic phrases "
                         f"(OpenAlex, {this_year - 10}–{this_year - 1}, complete years only).")
    figs["years"] = (figures.reference_years_chart([p.year for p in refs if p.year]),
                     "Temporal distribution and median publication year of works in the reference corpus.")
    figs["impact"] = (figures.citation_impact_chart([(f"[{i}]", p.cited_by or 0) for i, p in enumerate(refs, 1)]),
                      "OpenAlex citation counts of the highest-impact anchoring works in the reference list.")
    if len(top_venues) >= 2:
        figs["venues"] = (figures.venues_chart(top_venues),
                          f"Primary peer-reviewed journals and proceedings across the {len(pool)}-paper candidate pool (OpenAlex).")
    for name, (png, _) in figs.items():
        store.put("paper_fig", f"{pid}-{name}", {"png": base64.b64encode(png).decode()})
    years = [p.year for p in refs if p.year]
    cites = [p.cited_by or 0 for p in refs]
    facts = [f"- Literature search: {len(queries)} queries ({'; '.join(queries)}); {sum(raw_seen.values())} records retrieved ("
             + ", ".join(f"{k}: {v}" for k, v in raw_seen.items()) + f"); {sum(raw_seen.values()) - len(cands)} removed as duplicates "
             "or for lacking a usable abstract; kept per database: "
             + ", ".join(f"{k} {v}" for k, v in sources_used.items())
             + f"; {len(snow)} further works found by citation chaining from the 20 most relevant papers and {len(recs)} via Semantic "
             f"Scholar recommendations; {len(pool)} unique "
             f"candidate works ranked by semantic relevance; {len(ranked)} screened against Crossref retraction notices; "
             f"{len(refs)} included in the bibliography."]
    for ph, c in trends.items():
        full = {y: n for y, n in c.items() if y < this_year}
        if not full:
            continue
        first, last = min(full), max(full)
        facts.append(f"- Phrase “{ph}”: {full[first]} indexed works in {first}, {full[last]} in {last}"
                     + (f" ({full[last] / full[first]:.1f}x)" if full[first] else "")
                     + "; complete years only. Yearly counts: "
                     + ", ".join(f"{y}: {n}" for y, n in sorted(c.items())))
    if years:
        recent_n = sum(1 for y in years if y >= this_year - 3)
        facts.append(f"- Reference list temporal span: {len(refs)} works published {min(years)}–{max(years)}, median year "
                     f"{int(statistics.median(years))}, with {recent_n} works published since {this_year - 3}.")
    if cites:
        q1, q3 = (int(np.percentile(cites, 25)), int(np.percentile(cites, 75))) if len(cites) >= 4 else (min(cites), max(cites))
        facts.append(f"- Reference list citation distribution (OpenAlex): median {int(statistics.median(cites))}, interquartile range "
                     f"{q1}–{q3}, mean {int(round(statistics.mean(cites)))}, maximum {max(cites)} ([{cites.index(max(cites)) + 1}]).")
    if top_venues:
        facts.append("- Top publication venues in candidate corpus: " + ", ".join(f"{v} ({n} works)" for v, n in top_venues[:6]) + ".")
    if dropped:
        facts.append(f"- {len(dropped)} candidate work(s) were excluded because Crossref lists a retraction or expression of concern.")
    facts_txt = "\n".join(facts)
    await say("analyst", "done", f"{len(trends)} trend series · {len(figs)} 300-DPI figures rendered", 0.22)

    # ---- Roundtable + conflicts -> dossier (and the venue's style, in parallel) ----
    await say("roundtable", "run", "Assembling an expert panel to question the literature…", 0.24)
    style_task = asyncio.create_task(literature.venue_style(req.venue.strip())) if req.venue.strip() else None
    notes, cs = await asyncio.gather(dossier_mod.roundtable(topic, angle, refs, facts_txt, say), dossier_mod.conflicts(refs))
    await say("roundtable", "done", f"{len(notes)} expert(s) consulted · {len(cs)} conflict(s) found in the evidence", 0.32)
    await say("dossier", "run", "Writing the research dossier…", 0.33)
    try:
        dossier = await dossier_mod.synthesize(topic, angle, TYPE_LABEL[ptype], refs, facts_txt, notes, cs, prefer=_best())
    except llm.LLMError:
        dossier = "\n\n".join(t for _, t in notes)
    await say("dossier", "done", f"Dossier: {len(dossier.split()):,} words", 0.4)
    style = await style_task if style_task else None
    if style_task:
        await say("dossier", "done", f"Style guide from {style['stats']['venue']}" if style else f"Couldn't find “{req.venue}”; using general style")

    # ---- Data scout: real open data the paper can analyse (skipped when the author brought their own) ----
    public = None
    if not req.dataset_id:
        await say("datascout", "run", "Searching 8,900 open datasets (OpenML, Our World in Data, World Bank)…", 0.405)
        try:
            need = ("This is a METHOD paper: a dataset qualifies ONLY if the proposed kind of method can itself be trained and "
                    "evaluated on it (same task, same data structure, e.g. sensors on a graph over time for a traffic GNN). "
                    "A generic tabular benchmark that a different model family would be run on is NOT acceptable: answer "
                    "use=false, and the paper will rely on its controlled simulation." if ptype == "method" else "")
            sc = await datasets.scout(topic, angle, dossier[-4000:], need=need)
            if sc and sc["candidates"]:
                ds = await datasets.fetch(sc["candidates"])
                if ds and ds.rows >= 30:
                    store.put("studio_public_data", plan_id, datasets.to_record(ds))
                    public = {"name": ds.name, "rows": ds.rows, "columns": ds.columns[:40], "profile": ds.profile[:2500],
                              "sources": ds.sources, "questions": sc["choice"]["questions"], "rationale": sc["choice"]["rationale"]}
        except Exception as e:   # noqa: BLE001 - open data is a bonus; the paper never fails for lack of it
            print(f"data scout failed: {type(e).__name__}: {e}"[:300])
            public = None
        await say("datascout", "done", (f"Found open data: {', '.join(x['title'][:50] for x in public['sources'])} ({public['rows']:,} rows)"
                                        if public else "No open dataset fits this topic closely; the paper will design a study instead"), 0.41)

    # ---- Architect ----
    await say("architect", "run", f"Designing the {TYPE_LABEL[ptype].lower()}…", 0.42)
    specs = tplan.active(bool(req.dataset_id or public))
    outline = await llm.complete_json(
        f"You are a principal investigator designing a rigorous {TYPE_LABEL[ptype].lower()} grounded strictly in the dossier, "
        "the references and the measured facts.",
        f"Topic: {topic}\nAuthor's angle: {angle or '(none)'}{seed_hint}\nPAPER TYPE: {TYPE_LABEL[ptype]}. Design {tplan.architect}.\n"
        + (f"USER DATASET (analysed after this plan; hypotheses must be testable with it): {req.dataset_note or 'provided'}\n" if req.dataset_id else "")
        + (f"OPEN DATA (it WILL be analysed with real code after this plan, so design the research question and hypotheses to be "
           f"testable with it; the paper reports those real results):\nSOURCES: {[x['title'] for x in public['sources']]}\n"
           f"{public['profile'][:1800]}\nQUESTIONS IT CAN ANSWER: {public['questions']}\n" if public else "")
        + f"\nDOSSIER:\n{dossier}\n\nFACTS (measured):\n{facts_txt}\n\nREFERENCES:\n{_ref_listing(refs, abstract_chars=220)}\n\n"
        + (f"TARGET VENUE STYLE:\n{style['card']}\n\n" if style and style.get("card") else "")
        + "Fill: title (specific and informative; method papers may start with '<ACRONYM>: '); research_question (one sharp "
        "question); contributions (4, phrased as what this paper formulates, proposes, analyses or synthesises, never unrun "
        "results); the fields for this paper type (leave the others empty); and briefs: for EVERY key in "
        f"{[x.key for x in specs]}, a 3-sentence brief naming the points that section must make, plus 6-14 relevant reference numbers.",
        _Outline, effort="high", prefer=_best())
    outline = await _best_title_rq(outline, dossier, ptype)
    await say("architect", "done", f"“{outline.title}”", 0.46, title=outline.title)

    # ---- Novelty check ----
    await say("novelty", "run", "Searching for prior work that already does this…", 0.47)
    short = re.sub(r"\s*\(.*?\)", "", (outline.method_name or "").split(":")[-1]).strip()
    nov = await literature.novelty(_proposal(outline, ptype), f"{topic} {short}".strip()[:200], {p.title.strip().lower() for p in refs})
    if nov["verdict"] == "unchecked" and short:
        nov = await literature.novelty(_proposal(outline, ptype), topic, {p.title.strip().lower() for p in refs})
    close_papers = nov.pop("papers", [])
    novelty_note = ""
    if nov["verdict"] in ("incremental", "already_exists") and close_papers:
        idx = []
        for p in close_papers:
            k = next((i for i, r in enumerate(refs, 1) if literature._norm_title(r.title) == literature._norm_title(p.title)
                      or (p.doi and r.doi and p.doi.lower() == r.doi.lower())), None)
            if k is None:
                refs.append(p)
                k = len(refs)
            idx.append(k)
        try:
            rp = await llm.complete_json(
                "You reposition a paper's contribution honestly against closely related prior work.",
                f"TITLE: {outline.title}\nRESEARCH QUESTION: {outline.research_question}\nCONTRIBUTIONS: {outline.contributions}\n"
                f"SUMMARY: {outline.method_summary}\n\nCLOSEST PRIOR WORK:\n"
                + "\n".join(f"[{i}] {refs[i - 1].title}: {(refs[i - 1].abstract or '')[:700]}" for i in idx)
                + f"\n\nASSESSMENT: {nov['explanation']}\nSUGGESTION: {nov['repositioning']}\n\nRewrite the title, research question, "
                "contributions and summary so the paper credits this prior work and claims only what is genuinely different.",
                _Reposition, effort="medium")
            outline.title, outline.research_question = rp.title, rp.research_question
            outline.contributions, outline.method_summary = rp.contributions or outline.contributions, rp.method_summary or outline.method_summary
        except llm.LLMError:
            pass
        novelty_note = (f"Closely related prior work: {', '.join(f'[{i}]' for i in idx)}. {nov['explanation']} Credit these works "
                        "explicitly in the Introduction and Related Work and state precisely how this paper differs.")
    await say("novelty", "done", {"novel": "Contribution looks novel", "incremental": "Close prior work found; contribution repositioned",
                                  "already_exists": "Very similar work exists; paper repositioned to credit it"}.get(nov["verdict"], "Novelty check skipped"), 0.49)

    store.put(PLAN_KIND, plan_id, {
        "plan_id": plan_id, "pid": pid, "req": req.model_dump(), "paper_type": ptype, "type_reason": plan.type_reason,
        "refs": [p.model_dump() for p in refs], "candidates": len(pool), "checked": checked, "snowballed": len(snow),
        "dropped": [{"title": p.title, "doi": p.doi} for p in dropped], "queries": queries,
        "facts": facts_txt, "trends": {k: sorted(v.items()) for k, v in trends.items()},
        "figs": {k: cap for k, (_, cap) in figs.items()}, "outline": outline.model_dump(), "dossier": dossier,
        "conflicts": cs, "experts": [p.role for p, _ in notes], "style": style, "novelty": nov, "novelty_note": novelty_note,
        "seeded": [p.title for p in seeds], "created_at": now().isoformat(), "status": "planned", "public_data": public,
    })
    await say("plan", "done", "Plan ready", 0.5, plan_id=plan_id)
    return plan_id


def _core(o: _Outline, ptype: str, method_label: str, facts_txt: str, novelty_note: str, style: dict | None, extra: str) -> str:
    lines = [f"PAPER TYPE: {TYPE_LABEL[ptype]}", f"PAPER TITLE: {o.title}", f"RESEARCH QUESTION: {o.research_question}"]
    if ptype == "method":
        lines += [f"PROPOSED METHOD: {method_label} — {o.method_summary}",
                  "FORMAL ASSUMPTIONS (A1–A3):\n" + "\n".join(f"- {a}" for a in o.formal_assumptions[:4]),
                  f"TARGET ANALYTICAL PROPERTY: {o.formal_claim}", f"BOUNDARY / FAILURE REGIME: {o.failure_boundary}"]
    elif ptype == "empirical":
        lines += [f"STUDY DESIGN: {o.method_name} — {o.method_summary}", "HYPOTHESES:\n" + "\n".join(f"- {h}" for h in o.hypotheses)]
    elif ptype == "review":
        lines += [f"SCOPE AND APPROACH: {o.method_summary}", "REVIEW QUESTIONS:\n" + "\n".join(f"- {h}" for h in o.hypotheses),
                  "THEMES:\n" + "\n".join(f"- {t}" for t in o.themes)]
    else:
        lines += [f"THESIS: {o.thesis}", f"ARGUMENT: {o.method_summary}", "CLAIMS:\n" + "\n".join(f"- {t}" for t in o.themes)]
    lines.append("CONTRIBUTIONS:\n" + "\n".join(f"- {c}" for c in o.contributions[:5]))
    if novelty_note:
        lines.append(f"NOVELTY: {novelty_note}")
    if style and style.get("card"):
        lines.append(f"TARGET VENUE STYLE ({style['stats'].get('venue')}):\n{style['card']}")
    if extra:
        lines.append(f"AUTHOR'S INSTRUCTIONS FOR THE WRITERS: {extra}")
    lines.append(f"\nFACTS (measured — the ONLY empirical/bibliometric numbers you may report):\n{facts_txt}")
    return "\n".join(lines)


async def _check_figure(png: bytes, caption: str) -> tuple[str | None, str | None]:
    """Vision check: does the image show what the caption says, and is it readable? Returns (better caption, issue)."""
    try:
        txt = await llm.vision(
            f"This figure will appear in a research paper with the caption: “{caption}”.\nCheck: (1) does the image show what "
            "the caption says? (2) are axis labels, legends and text readable? Reply with JSON only: {\"matches\": true or "
            "false, \"readable\": true or false, \"issue\": \"short description or empty\", \"better_caption\": \"a precise "
            "caption describing exactly what is shown, or empty if the caption is right\"}", [("image/png", png)])
        d = llm._extract_json(txt)
    except Exception:   # noqa: BLE001 - the figure check is advisory
        return None, None
    if not isinstance(d, dict):
        return None, None
    better = (d.get("better_caption") or "").strip()
    issue = (d.get("issue") or "").strip() if (d.get("matches") is False or d.get("readable") is False) else None
    return (better if d.get("matches") is False and len(better) > 20 else None), issue


async def write_from_plan(plan_id: str, edits: dict, ctx) -> str:
    store = get_store()
    pl = store.get(PLAN_KIND, plan_id)
    if not pl:
        raise RuntimeError("This plan has expired. Start the paper again.")
    say = _say_fn(ctx)
    req = StudioRequest.model_validate(pl["req"])
    pid, ptype = pl["pid"], pl["paper_type"]
    tplan: TypePlan = PLANS[ptype]
    refs = [Paper.model_validate(r) for r in pl["refs"]]
    outline = _Outline.model_validate(pl["outline"])
    # ---- the author's edits from the co-pilot review ----
    if (t := str(edits.get("title") or "").strip()):
        outline.title = t[:300]
    if (t := str(edits.get("research_question") or "").strip()):
        outline.research_question = t[:600]
    if isinstance(edits.get("contributions"), list) and any(str(c).strip() for c in edits["contributions"]):
        outline.contributions = [str(c).strip()[:400] for c in edits["contributions"] if str(c).strip()][:6]
    for b in outline.briefs:
        if (t := str((edits.get("briefs") or {}).get(b.key) or "").strip()):
            b.brief = t[:1500]
    excluded = {int(n) for n in edits.get("exclude_refs") or [] if str(n).isdigit() and 1 <= int(n) <= len(refs)}
    extra = str(edits.get("instructions") or "").strip()[:1500]
    facts_txt, dossier, novelty_note, style = pl["facts"], pl["dossier"], pl.get("novelty_note", ""), pl.get("style")
    captions: dict[str, str] = dict(pl["figs"])
    trends = {k: dict(v) for k, v in pl["trends"].items()}
    method_label = (outline.method_name if outline.method_acronym and outline.method_acronym in outline.method_name
                    else f"{outline.method_name} ({outline.method_acronym})" if outline.method_acronym else outline.method_name)
    briefs = {b.key: b for b in outline.briefs}

    # ---- Data: the author's dataset, else the open dataset found by the data scout; method papers also get a simulation ----
    exp = experiments.Experiments()
    data = None
    data_error, data_sources, analysis_code = "", [], ""
    if req.dataset_id and (rec := store.get("studio_data", req.dataset_id)):
        await say("statistician", "run", "Analysing your dataset…", 0.51)
        try:
            data = await userdata.analyse(base64.b64decode(rec["csv"]), req.dataset_note or rec.get("note", ""),
                                          "\n".join(outline.hypotheses) or outline.research_question, say)
        except userdata.DataError as e:
            data_error = str(e)
        data_sources = [{"title": f"Author-provided dataset ({rec.get('name', 'data.csv')})", "url": "", "licence": "", "citation": ""}]
        await say("statistician", "done", f"{len(data.facts) - 1 if data else 0} analyses run" if data else f"Dataset skipped: {data_error}", 0.53)
        origin = "the author's dataset"
    elif edits.get("use_public_data", True) is not False and pl.get("public_data") and (prec := store.get("studio_public_data", plan_id)):
        ds = datasets.from_record(prec)
        await say("experimenter", "run", f"Analysing real open data ({ds.rows:,} rows) with code…", 0.51)
        design_q = (f"RESEARCH QUESTION: {outline.research_question}\nHYPOTHESES: {outline.hypotheses or outline.contributions}\n"
                    f"DESIGN: {outline.method_summary}\nQUESTIONS THE DATA CAN ANSWER: {pl['public_data'].get('questions')}")
        data = await experiment_agent.run(ds, design_q, say, prefer=_best())
        data_error = (data.report or {}).get("error", "")
        data_sources, analysis_code = ds.sources, data.code
        await say("experimenter", "done", (f"Real-data analysis: {data.report.get('metrics', 0)} results · {data.report.get('tables', 0)} tables · "
                                           f"{data.report.get('figures', 0)} figures · {data.report.get('critic_rounds', 0)} methods review(s)")
                  if data.facts else f"Open-data analysis skipped: {data_error[:120]}", 0.53)
        origin = "an open dataset"
    if data and data.facts:
        facts_txt += (f"\nDATA ANALYSIS (executed by the pipeline on {origin}; report exactly these numbers):\n" + "\n".join(data.facts))
        for name, (png, cap) in data.figures.items():
            captions[name] = cap
            store.put("paper_fig", f"{pid}-{name}", {"png": base64.b64encode(png).decode()})
    if tplan.experiments:
        design = ("ASSUMPTIONS:\n" + "\n".join(outline.formal_assumptions) + f"\nANALYTICAL CLAIM: {outline.formal_claim}\n"
                  f"FAILURE REGIME: {outline.failure_boundary}\nCONTRIBUTIONS: {outline.contributions}")
        exp = await experiments.run_for_paper(req.topic, method_label, outline.method_summary, say, design=design, prefer=_best())
        for name, (png, cap) in exp.figures.items():
            captions[name] = cap
            store.put("paper_fig", f"{pid}-{name}", {"png": base64.b64encode(png).decode()})
        if exp.facts:
            facts_txt += (("\nSIMULATION STUDY (executed by the pipeline; these ARE this paper's results: report them as results, "
                           "with their uncertainty, and never call them pilot, illustrative or planned):\n")
                          if exp.report.get("study") else
                          "\nPILOT EXPERIMENTS (executed by the pipeline; illustrative, not a full evaluation of the proposed method):\n") + "\n".join(exp.facts)
    elif ptype == "empirical" and not (data and data.facts):
        # No data to analyse: evaluate the design itself by simulation, so the paper reports real computed evidence
        design_txt = (f"{outline.method_summary}\nMETHODS BRIEF: {briefs['methods'].brief if 'methods' in briefs else ''}")
        exp = await experiments.run_design_for_paper(req.topic, outline.research_question, outline.hypotheses, design_txt,
                                                     dossier, say, prefer=_best())
        for name, (png, cap) in exp.figures.items():
            captions[name] = cap
            store.put("paper_fig", f"{pid}-{name}", {"png": base64.b64encode(png).decode()})
        if exp.facts:
            facts_txt += ("\nDESIGN SIMULATION (an executed Monte Carlo study of THIS study's planned analysis on simulated data. These "
                          "numbers describe the design's power, error rates, bias and coverage. They are NOT findings about the "
                          "population: never present them as observed effects. Use them to justify the sample size, the minimum "
                          "detectable effect and the analysis plan, and report the planned N's power exactly as given):\n"
                          + "\n".join(exp.facts))
    if exp.code and not analysis_code:
        analysis_code = exp.code                 # published with the paper, so every simulated number can be re-run
    specs = tplan.active(bool(data and data.facts))

    # ---- Writers: in dependency stages, sharing a paper memory ----
    core = _core(outline, ptype, method_label, facts_txt, novelty_note, style, extra)
    type_rule = TYPE_RULES[ptype]
    if exp.report.get("study"):
        type_rule = ("- The proposed method was evaluated in the controlled SIMULATION STUDY in FACTS, and nowhere else. Report "
                     "those results as this paper's results, with their uncertainty, exactly as given, including where the method "
                     "does not win. Never claim real-world or benchmark performance: the real-data evaluation is future work, "
                     "described in the conditional tense.")
    elif exp.report.get("design_study"):
        type_rule += ("\n- A DESIGN SIMULATION of this study's planned analysis is in FACTS: use its power, minimum detectable effect, "
                      "false-positive rate and coverage to justify the sample size and analysis plan, quoting the numbers exactly. "
                      "They describe the design, not the population: never present them as observed effects.")
    system = (f"You are a senior journal author writing one section of a {TYPE_LABEL[ptype].lower()}.\n" + RULES + "\n" + type_rule)
    texts: dict[str, str] = {}
    memory: list[str] = []
    foundation = {s.key for s in specs if s.stage == 1 and s.design}
    done_n = 0

    async def write(sp, mem: str, found: str) -> str:
        nonlocal done_n
        await say(f"writer:{sp.key}", "run", f"Drafting {sp.heading}…", name=sp.heading)
        b = briefs.get(sp.key)
        ids = [i for i in (b.refs if b else []) if 1 <= i <= len(refs) and i not in excluded]
        prompt = (f"{core}\n\nRESEARCH DOSSIER (what the literature establishes; your main source of substance):\n{dossier}\n\n"
                  f"PAPER MEMORY (sections already written: do not repeat their points; reuse their terms):\n{mem}\n\n"
                  + (f"FOUNDATION SECTIONS (full text; reuse this notation exactly):\n{found}\n\n" if found else "")
                  + f"REFERENCES:\n{_ref_listing(refs, ids or None, abstract_chars=700)}\n"
                  + (f"DO NOT CITE these excluded references: {sorted(excluded)}\n" if excluded else "")
                  + f"\nSECTION: # {sp.heading}\nARCHITECT BRIEF: {b.brief if b else ''}\nCHECKLIST (every item is required): {sp.task}\n"
                  "Length: as short as the checklist allows, typically 600-1,100 words (the whole paper should read at 7,000-8,500 words). "
                  "Every paragraph must add something new; cut throat-clearing, restatements and generic sentences.")
        tier = "fast" if sp.key == tplan.analysis_key else "main"     # reporting measured counts needs no frontier model
        text = re.sub(r"^```(?:markdown)?\n|\n```$", "", (await llm.complete(system, prompt, effort="medium", max_tokens=8000, tier=tier,
                                                                         prefer=_best() if tier == "main" else None)).strip())
        if not text.lstrip().startswith("# "):
            text = f"# {sp.heading}\n\n{text}"
        text = normalize_section(text, sp.heading)
        done_n += 1
        await say(f"writer:{sp.key}", "done", f"{sp.heading}: {len(text.split())} words", 0.53 + 0.17 * done_n / len(specs), name=sp.heading)
        return text

    async def remember(sp, text: str) -> str:
        try:
            m = await llm.complete_json("Summarise what this paper section establishes, for the authors of later sections.",
                                        text[:16000], _Memory, effort="low", tier="fast")
            return f"## {sp.heading}\n" + "\n".join(f"- {p}" for p in m.key_points) + ("\nDefined: " + "; ".join(m.terms) if m.terms else "")
        except llm.LLMError:
            return f"## {sp.heading}\n" + text[:1200]

    for stage in sorted({s.stage for s in specs}):
        batch = [s for s in specs if s.stage == stage]
        found = "\n\n".join(texts[k] for k in texts if k in foundation)
        mem = "\n\n".join(memory) or "(nothing written yet)"
        # full foundation text only where notation is reused (design sections and the discussion); others get the memory
        for sp, t in zip(batch, await asyncio.gather(*(write(sp, mem, found if (sp.design or sp.key == "discussion") else "")
                                                       for sp in batch))):
            texts[sp.key] = t
        memory += await asyncio.gather(*(remember(sp, texts[sp.key]) for sp in batch))
    body = "\n\n".join(texts[s.key] for s in specs)

    # ---- Consistency editor: one pass over the whole manuscript ----
    await say("editor", "run", "Reading the whole draft for repetition, terminology and contradictions…", 0.71)
    consistency, consistency_error = 0, ""
    ask = ("PAPER:\n{paper}\n\nList up to {n} edits: delete or shorten passages that repeat a point already made in an earlier "
           "section; make terminology and notation consistent (keep the first definition); fix contradictions between sections; "
           "fix wrong cross-references to sections, figures, tables or equations. Copy `find` exactly from the paper (one sentence "
           "or less). Never edit tables, equations, Mermaid code or [[...]] tokens.")
    fx = None
    for n, tier in ((20, "main"), (12, "fast")):          # one retry on the other model if the first reply fails
        try:
            fx = await llm.complete_json("You are the handling editor doing a whole-manuscript consistency pass. You make surgical edits only.",
                                         ask.format(paper=body[: llm.context_chars() - 8000], n=n), _Fixes, effort="medium",
                                         max_tokens=9000, tier=tier, prefer=_best() if tier == "main" else None)
            break
        except llm.LLMError as e:
            consistency_error = str(e)[:200]
    for e in (fx.edits if fx else []):
        f_ = e.find.strip()
        if len(f_) > 12 and body.count(f_) == 1 and not re.search(r"\[\[|```|\$\$|^\|", f_, re.M):
            body = body.replace(f_, e.replace.strip())
            consistency += 1
    if fx:
        consistency_error = ""
    await say("editor", "done", f"{consistency} consistency edit(s) applied", 0.73)

    # ---- Reviewer panel, then revise what it flags; a second round if major issues remain ----
    async def respond(h: str, iss: list[dict], cur: str) -> tuple[str, str | None]:
        await say("reviser", "run", f"Addressing reviewer comments in {h}…")
        try:
            new = await llm.complete(
                system, f"{core}\n\nREFERENCES:\n{_ref_listing(refs, sorted({n for g in _CITE.findall(cur) for n in _nums(g)}) or None, abstract_chars=400)}"
                f"\n\nCURRENT SECTION:\n{cur}\n\nREVIEWER ISSUES:\n"
                + "\n".join(f"- [{i['severity']}] {i['problem']} (quote: “{i['quote']}”). Fix: {i['fix']}" for i in iss)
                + "\n\nRevise the section so every issue is resolved. Keep every table, equation, diagram, algorithm block, token "
                "line ([[...]]) and valid citation; add no new numbers or references. Where an issue cannot be fixed honestly "
                "(e.g. it asks for results that were not measured), state the limitation instead. Return the complete section "
                "starting with its level-1 heading.", effort="medium", max_tokens=8000, prefer=_best())
        except llm.LLMError:
            return h, None
        new = normalize_section(re.sub(r"^```(?:markdown)?\n|\n```$", "", new.strip()), h)
        kept = all(t in new for t in re.findall(r"\[\[[A-Z]+:[a-z]+\]\]", cur)) and new.count("```mermaid") >= cur.count("```mermaid")
        return h, (new if kept and len(new.split()) > 0.6 * len(cur.split()) else None)

    rounds: list[dict] = []
    revised_sections = 0
    for rnd, cap in ((1, 3), (2, 2)):
        await say("reviewers", "run", "Three reviewers are scoring the draft…" if rnd == 1 else "Second review round…", 0.74 if rnd == 1 else 0.77)
        pan = await review.panel(f"# {outline.title}\n\n{body}", TYPE_LABEL[ptype].lower())
        secs = _sections(body)
        by_sec = review.issues_by_section(pan["issues"], secs)
        targets = sorted(((h, iss) for h, iss in by_sec.items()
                          if any(i["severity"] == "major" for i in iss) or (rnd == 1 and len(iss) >= 2)),
                         key=lambda kv: -sum(i["severity"] == "major" for i in kv[1]))[:cap]
        rounds.append({"round": rnd, "overall": pan["overall"], "scores": pan["scores"], "issues": len(pan["issues"]),
                       "major": sum(i["severity"] == "major" for i in pan["issues"]), "revised": 0})
        await say("reviewers", "done", (f"Round {rnd}: {pan['overall']}/10 · {rounds[-1]['major']} major issue(s) · revising {len(targets)} section(s)"
                                        if pan["overall"] else "Review panel unavailable"), 0.76 if rnd == 1 else 0.78)
        if not targets or not pan["overall"]:
            break
        cur_of = dict(secs)
        for h, new in await asyncio.gather(*(respond(h, iss, cur_of[h]) for h, iss in targets)):
            if new:
                body = body.replace(cur_of[h], new.rstrip() + "\n\n", 1)
                revised_sections += 1
                rounds[-1]["revised"] += 1
    pan = {"overall": rounds[0]["overall"], "scores": rounds[0]["scores"], "reviews": {}, "issues": [None] * rounds[0]["issues"]}

    # ---- Gap filling: cite new evidence where claims still lack it ----
    await say("librarian", "run", "Looking for claims that still need evidence…", 0.78)
    body, new_refs, gaplog = await literature.fill_gaps(body, refs, {p.id for p in refs}, max_new=6, say=say)
    refs += new_refs
    await literature.enrich([p for p in new_refs if not p.corpus_id])
    await say("librarian", "done", f"{len(new_refs)} new source(s) cited for unsupported claims", 0.8)

    # ---- Verifier ----
    await say("verifier", "run", "Auditing every citation claim, originality, equations, diagrams & numbers…", 0.81)
    body, bad_cites = _fix_citations(body, len(refs))
    if excluded:
        def drop_excluded(m: re.Match) -> str:
            ns = _nums(m.group(1))
            if 0 in ns:
                return m.group(0)
            keep = [n for n in ns if n not in excluded]
            return "[" + ", ".join(map(str, keep)) + "]" if keep else ""
        body = _sub_citations(body, drop_excluded)
    body = _sanitize_mermaid(body)
    body, diagrams_repaired, diagrams_removed = await fix_diagrams(body)
    if tplan.protocol_heading:
        body = await ensure_workflow_diagram(body)
    abs_shingles = set().union(*(_shingles(p.abstract or "") for p in refs))
    paras = _paragraphs(body)
    flags: dict[int, list[str]] = {}
    for k, (_, _, t) in enumerate(paras):
        if (v := _verbatim(t, abs_shingles)):
            flags.setdefault(k, []).append(f"{v} eight-word sequence(s) copied verbatim from a cited abstract")
    ov = await find_overlaps([Paragraph(page=0, start=0, end=0, text=t) for _, _, t in paras], refs, [])
    para_idx = {t: k for k, (_, _, t) in enumerate(paras)}
    for h in ov:
        if (k := para_idx.get(h.paragraph)) is not None:
            flags.setdefault(k, []).append(f"too close to the abstract of “{h.matched.title}” (similarity {h.similarity:.2f}); "
                                           f"closest sentence: “{h.matched_text}”")
    claims = await quality.check_all_claims(body, [p.model_dump() for p in refs], fulltext_cap=40)
    judged = {(_squash(r["sentence"]), r["n"]): r for r in claims["pairs"]}
    sq_paras = [(k, _squash(t)) for k, (_, _, t) in enumerate(paras)]

    def para_of(sentence: str) -> int | None:
        s_ = _squash(sentence)[:160]
        return next((k for k, t in sq_paras if s_ in t), None)
    for r in claims["pairs"]:
        if r["label"] == "unsupported" and (k := para_of(r["sentence"])) is not None:
            flags.setdefault(k, []).append(f"the sentence “{r['sentence']}” cites [{r['n']}], whose abstract does not support it ({r['rationale']})")
    for s_ in claims["synthesis_flags"]:
        if (k := para_of(s_)) is not None:
            flags.setdefault(k, []).append(f"the sentence “{s_}” combines several citations into a claim none of them supports on its own")
    allowed = _allowed_numbers(facts_txt, *(p.abstract or "" for p in refs))
    body, fabricated_tables = strip_unmeasured_tables(body, allowed)
    paras = _paragraphs(body)
    for k in dangling_announcements(body):
        flags.setdefault(k, []).append("this paragraph announces a table or list that is not there; rewrite it so it stands on "
                                       "its own (give the content as prose, or drop the announcement)")
    design = {s.heading for s in specs if s.design}
    unmeasured = 0
    for k, (st, _, t) in enumerate(paras):
        if _section_of(body, st) in design:
            continue
        if (issues := _unmeasured(t, allowed, method_label)):
            unmeasured += len(issues)
            flags.setdefault(k, []).extend(issues)
    flags = {k: v for k, v in flags.items() if k < len(paras)}
    await say("verifier", "done", f"{claims['checked']} citation claims checked · {claims['unsupported']} unsupported · "
              f"{unmeasured} unmeasured claim(s) · {len(flags)} paragraph(s) queued for revision", 0.86)

    # ---- Reviser ----
    revised = 0

    async def fix(k: int) -> tuple[int, str]:
        _, _, t = paras[k]
        try:
            out = await llm.complete_json(
                "You revise one paragraph of a research paper to fix the listed problems. " + RULES + "\n" + type_rule,
                f"REFERENCES:\n{_ref_listing(refs, abstract_chars=300)}\n\nPARAGRAPH:\n{t.strip()}\n\nPROBLEMS:\n- "
                + "\n- ".join(flags[k]) + "\n\nRewrite the paragraph in original wording; remove or replace any citation that its "
                "abstract does not support; remove every number that is not in FACTS or a cited abstract. Keep similar length."
                "\n\nFACTS:\n" + facts_txt, _Rewrite, effort="low", tier="fast")
            return k, out.paragraph.strip()
        except llm.LLMError:
            return k, t
    if flags:
        await say("reviser", "run", f"Revising {len(flags)} flagged paragraph(s)…", 0.87)
        for k, new in await asyncio.gather(*(fix(k) for k in flags)):
            s, e, old = paras[k]
            if new and new != old.strip():
                body = body.replace(old, old[: len(old) - len(old.lstrip())] + new + old[len(old.rstrip()):], 1)
                revised += 1
        body, more_bad = _fix_citations(body, len(refs))
        bad_cites += more_bad
        await say("reviser", "done", f"{revised} paragraph(s) rewritten", 0.89)

    # ---- Second verification pass on the revised text: catch what the rewrite (or Opus's richer prose) still gets wrong ----
    await say("verifier", "run", "Re-checking every citation in the revised text…", 0.895)
    claims = await quality.check_all_claims(body, [p.model_dump() for p in refs], fulltext_cap=40)
    judged = {(_squash(r["sentence"]), r["n"]): r for r in claims["pairs"]}
    paras = _paragraphs(body)
    sq_paras = [(k, _squash(t)) for k, (_, _, t) in enumerate(paras)]
    flags = {}
    for r in claims["pairs"]:
        if r["label"] == "unsupported" and (k := para_of(r["sentence"])) is not None:
            flags.setdefault(k, []).append(f"the sentence “{r['sentence']}” cites [{r['n']}], whose abstract and full text do not support it ({r['rationale']})")
    for s_ in claims["synthesis_flags"]:
        if (k := para_of(s_)) is not None:
            flags.setdefault(k, []).append(f"the sentence “{s_}” combines several citations into a claim none of them supports on its own")
    second = 0
    if flags:
        for k, new in await asyncio.gather(*(fix(k) for k in flags)):
            s0, e0, old = paras[k]
            if new and new != old.strip():
                body = body.replace(old, old[: len(old) - len(old.lstrip())] + new + old[len(old.rstrip()):], 1)
                second += 1
        body, more_bad = _fix_citations(body, len(refs))
        bad_cites += more_bad
        # the rewritten sentences no longer match the stored verdicts; drop them so the reader sees 'edited after check'
        judged = {key: r for key, r in judged.items() if r["label"] != "unsupported"}
    revised += second
    await say("verifier", "done", f"Second pass: {claims['unsupported']} unsupported citation(s) found · {second} paragraph(s) fixed", 0.9)
    bad_math = [(st, en, tex, disp, err) for st, en, tex, disp in _math_spans(body) if (err := math_problem(tex))]
    math_fixed = 0
    if bad_math:
        async def fix_tex(tex: str, err: str) -> str | None:
            try:
                out = await llm.complete_json("You fix LaTeX math so it compiles in KaTeX and LaTeX. Keep the meaning. Return only the math, without $ delimiters.",
                                              f"Problem: {err}\nLaTeX: {tex}", _Tex, effort="low", tier="fast")
                new = out.latex.strip().strip("$").strip()
                return new if new and not math_problem(new) else None
            except llm.LLMError:
                return None
        fixes = await asyncio.gather(*(fix_tex(tex, err) for _, _, tex, _, err in bad_math))
        for (st, en, tex, disp, _), new in sorted(zip(bad_math, fixes), key=lambda x: -x[0][0]):
            if new:
                body = body[:st] + (f"$${new}$$" if disp else f"${new}$") + body[en:]
                math_fixed += 1
    for st, en, tex, disp in reversed(_math_spans(body)):
        if math_problem(tex):
            body = body[:st] + (f"`{tex}`" if not disp else f"```\n{tex}\n```") + body[en:]

    # ---- Concision: cut paragraphs that only restate earlier ones (reviewers' lowest score is always concision) ----
    await say("editor", "run", "Cutting paragraphs that repeat earlier points…", 0.905)
    body, cut = await cut_redundant(body, prefer=_best())
    await say("editor", "done", f"{cut} redundant paragraph(s) removed", 0.908)

    # ---- Figure check (vision) ----
    await say("figures", "run", "Checking every figure against its caption…", 0.91)
    to_check = [(n, png) for n in captions if (n in ("trend", "years", "impact", "venues") or n.startswith(("exp_", "data")))
                and (png := figure_png(pid, n))][:8]
    fig_names = [n for n, _ in to_check]
    fig_issues: list[str] = []
    recaptioned = 0
    for name, (better, issue) in zip(fig_names, await asyncio.gather(*(_check_figure(png, captions[n]) for n, png in to_check))):
        if better:
            captions[name] = better
            recaptioned += 1
        if issue:
            fig_issues.append(f"{name}: {issue}")
    await say("figures", "done", f"{len(fig_names)} figure(s) checked · {recaptioned} caption(s) corrected", 0.92)

    # ---- Editor: front matter, best of three abstracts ----
    await say("editor", "run", "Drafting three candidate abstracts and choosing the strongest…", 0.93)
    st_ = (style or {}).get("stats") or {}
    lo, hi = ((max(120, st_["abstract_words_median"] - 30), st_["abstract_words_median"] + 30) if st_.get("abstract_words_median") else (175, 235))
    content = {
        "method": "context and gap, the formal problem and proposed method (with its acronym), its analytical properties and failure boundary, the bibliometric synthesis (FACTS numbers only) and the evaluation protocol",
        "empirical": "background, objective, design and methods, results (only if USER DATA ANALYSIS exists; otherwise what the study will measure), and conclusions",
        "review": "background, review questions, how the literature was searched (FACTS counts), main themes and findings, conflicting evidence, and the research agenda",
        "position": "the issue, the thesis, the supporting argument, the main counterargument, and the recommendations",
    }[ptype]
    front = await llm.complete_json(
        "You are the Editor-in-Chief finalizing front matter. Formal academic English, original wording. Never invent empirical "
        "numbers; the only numbers allowed are in FACTS. Never mention how the text was produced.",
        f"{core}\n\nPAPER BODY:\n{body[: llm.context_chars() - 9000]}\n\nWrite:\n1. abstracts: THREE distinct candidate abstracts, "
        f"each {lo}-{hi} words, covering {content}. No citations; no unmeasured results.\n2. keywords: 6 index terms.\n"
        "3. highlights: 4 crisp one-sentence takeaways.\n4. summary: a 3-4 sentence plain-language summary.", _Front, effort="medium",
        prefer=_best())
    cands_abs = [a for a in front.abstracts if len(a.split()) > 60] or front.abstracts[:1] or [""]
    abstract = cands_abs[await _pick("abstract", cands_abs, "Prefer the abstract that is most specific, accurate to the paper "
                                     "body, free of hype, and states exactly what was done and found (or proposed).")]
    abs_issues = _unmeasured(abstract, allowed, method_label)
    if abs_issues:
        try:
            abstract = (await llm.complete_json(
                f"You revise a research-paper abstract to fix the listed problems. Keep it {lo}-{hi} words, original wording, no citations.",
                f"FACTS (the only numbers allowed):\n{facts_txt}\n\nABSTRACT:\n{abstract}\n\nPROBLEMS:\n- " + "\n- ".join(abs_issues),
                _Rewrite, effort="low", tier="fast")).paragraph.strip() or abstract
        except llm.LLMError:
            pass
    highlights = [h for h in front.highlights if not _unmeasured(h, allowed, method_label)]
    # ---- Final consistency check across abstract and body: numbers, thresholds, hypotheses and claims must agree ----
    final_fixes = 0
    try:
        fx = await llm.complete_json(
            "You are a meticulous copy editor checking a finished manuscript for internal inconsistencies only.",
            f"ABSTRACT:\n{abstract}\n\nPAPER:\n{body[: llm.context_chars() - 12000]}\n\nList up to 12 edits that make the paper "
            "consistent: numbers, thresholds, sample sizes, hypothesis wording, design details, names of methods or measures, "
            "and claims that differ between the abstract and the body or between sections. Prefer changing the place that "
            "disagrees with the Methods / formulation. Copy `find` exactly (one sentence or less) from the ABSTRACT or the PAPER.",
            _Fixes, effort="medium", max_tokens=5000)
        for e in fx.edits:
            f_ = e.find.strip()
            if len(f_) < 8 or re.search(r"\[\[|```|\$\$|^\|", f_, re.M):
                continue
            if abstract.count(f_) == 1:
                abstract = abstract.replace(f_, e.replace.strip())
                final_fixes += 1
            elif body.count(f_) == 1:
                body = body.replace(f_, e.replace.strip())
                final_fixes += 1
    except llm.LLMError:
        pass
    await say("editor", "done", f"Abstract, keywords, highlights & summary ready · {final_fixes} final consistency fix(es)", 0.95)

    remaining = sum(len(_unmeasured(t, allowed, method_label)) for st, _, t in _paragraphs(body)
                    if _section_of(body, st) not in design) + len(_unmeasured(abstract, allowed, method_label))
    copied_after = sum(1 for _, _, t in _paragraphs(body) if _verbatim(t, abs_shingles))
    phrase_hits = find_phrases([body], None)
    # The editor and consistency pass can change cited prose after the reviser's
    # last check. Re-run the complete claim audit on the final body so the report
    # describes the manuscript that will actually be exported.
    claims = await quality.check_all_claims(body, [p.model_dump() for p in refs], fulltext_cap=40)

    # ---- Assemble ----
    body = enforce_headings(body, {s.heading for s in specs} | {"Conclusion", "Pilot Experiments", "Simulation Study", "Simulation-Based Design Analysis", "Data Availability"})
    body = _INTERNAL_TAG.sub("", body)      # provenance labels from FACTS that writers sometimes copy into prose
    body = re.sub(r"\b(DESIGN SIMULATION|SIMULATION STUDY|DATA ANALYSIS|PILOT EXPERIMENTS|PAPER MEMORY|FACTS)\b",
                  lambda m: {"PAPER MEMORY": "this paper", "FACTS": "the measured results"}.get(m.group(1), m.group(1).lower()), body)
    body, _ = _merge_duplicate_refs(body, refs)
    body, order = _renumber(body)
    old_to_new = {old: new for new, old in enumerate(order, 1)}
    cited_refs = [refs[o - 1] for o in order]

    def fig_block(name: str) -> str:
        return f"Figure: {captions[name]}\n![{captions[name]}]({FIG_URL.format(pid=pid, name=name)})" if name in captions else ""

    trend_rows = ""
    if trends:
        yrs = sorted({y for c in trends.values() for y in c})
        trend_rows = ("Table: Annual OpenAlex publication counts matching each phrase (complete years)\n| Year | " + " | ".join(trends) + " |\n|---|" + "---|" * len(trends) + "\n"
                      + "\n".join(f"| {y} | " + " | ".join(str(c.get(y, 0)) for c in trends.values()) + " |" for y in yrs))
    top = sorted(((old_to_new[i], p) for i, p in enumerate(refs, 1) if i in old_to_new), key=lambda t: -(t[1].cited_by or 0))[:10]
    ref_table = ("Table: Representative foundational and recent works in the cited corpus (metadata via OpenAlex)\n"
                 "| Ref. | Title | Year | Venue | Citations |\n|---|---|---|---|---|\n"
                 + "\n".join(f"| [{n}] | {_clip(p.title, 110).replace('|', '/')} | {p.year or ''} | {_clip(p.venue or '–', 60).replace('|', '/')} | {p.cited_by or 0:,} |"
                             for n, p in sorted(top, key=lambda t: t[0])))
    heading_of = {s.key: s.heading for s in specs}
    analysis_anchor = "\n# " + heading_of.get(tplan.analysis_key, "")
    refs_anchor = "\n# " + heading_of.get(tplan.refs_table_key, heading_of.get(tplan.analysis_key, ""))
    results_anchor = "\n# " + heading_of.get("results", heading_of.get("methods", ""))
    tokens = {
        "[[FIG:trend]]": (fig_block("trend"), analysis_anchor), "[[FIG:years]]": (fig_block("years"), analysis_anchor),
        "[[FIG:impact]]": (fig_block("impact"), analysis_anchor), "[[FIG:venues]]": (fig_block("venues"), analysis_anchor),
        "[[TABLE:trend]]": (trend_rows, analysis_anchor), "[[TABLE:refs]]": (ref_table, refs_anchor),
        "[[DATA:tables]]": ("\n\n".join(data.tables) if data else "", results_anchor),
        "[[DATA:figures]]": ("\n\n".join(fig_block(n) for n in (data.figures if data else {})), results_anchor),
    }
    exp_md = experiments.section(exp, fig_block)
    if exp_md:
        # before the protocol (method papers), else before the Discussion (empirical papers), else at the end
        anchor = next((a for a in (f"\n# {tplan.protocol_heading}" if tplan.protocol_heading else "", "\n# Discussion") if a and a in body), "")
        body = body.replace(anchor, f"\n{exp_md}\n{anchor}", 1) if anchor else body + f"\n\n{exp_md}"

    def insert_after_section(md: str, anchor: str, block: str) -> str:
        """Put a block at the end of the section that starts at `anchor` (or at the end of the body)."""
        i = md.find(anchor)
        if i < 0:
            return md + f"\n\n{block}"
        j = md.find("\n# ", i + len(anchor))
        return md[:j] + f"\n\n{block}\n" + md[j:] if j >= 0 else md + f"\n\n{block}"
    for tok, (rep, anchor) in tokens.items():
        if tok in body:   # a block always gets its own lines: writers often put the token mid-sentence
            body = body.replace(tok, f"\n\n{rep}\n\n" if rep else "", 1).replace(tok, "")
        elif rep:
            body = insert_after_section(body, anchor, rep)
    figs_png = figures.citation_impact_chart([(f"[{old_to_new[i]}]", p.cited_by or 0) for i, p in enumerate(refs, 1) if i in old_to_new])
    store.put("paper_fig", f"{pid}-impact", {"png": base64.b64encode(figs_png).decode()})

    availability = ""
    if data and data.facts and data_sources:
        availability = ("# Data Availability\n\n" + "\n".join(
            f"- {x['title']}" + (f", {x['citation']}" if x.get("citation") else "") + (f". Available at {x['url']}" if x.get("url") else "")
            + (f" (licence: {x['licence']})" if x.get("licence") else "") + "." for x in data_sources)
            + ("\n\nThe complete analysis script that produced every reported number, table and figure accompanies this "
               "manuscript (analysis.py)." if analysis_code else "") + "\n\n")
    md = (f"# Abstract\n\n{abstract.strip()}\n\n**Keywords:** {', '.join(front.keywords[:6])}\n\n{body.strip()}\n\n" + availability
          + ("# Acknowledgment\n\nThe authors used AI-assisted research and drafting tools to prepare portions of this manuscript "
             "and verified all formal derivations, citations, and bibliometric figures. Bibliometric statistics were computed "
             "directly from OpenAlex and Crossref metadata.\n\n" if req.ai_disclosure else "")
          + "# References\n\n" + "\n".join(f"{i}. {_ieee_ref(p)}" for i, p in enumerate(cited_refs, 1)) + "\n")
    # Audit the exact assembled manuscript, including the generated front matter,
    # disclosure and references—not only the intermediate body.
    claims = await quality.check_all_claims(md, [p.model_dump() for p in cited_refs], fulltext_cap=40)
    readiness = quality.publication_readiness(
        claims=claims,
        structural_blockers=quality.structural_issues(
            md, {s.heading for s in specs} | {"Abstract", "Conclusion"} |
            ({"Acknowledgment"} if req.ai_disclosure else set())),
        unmeasured_remaining=remaining,
        copied_paragraphs=copied_after,
        invalid_equations=max(0, len(bad_math) - math_fixed),
        diagrams_removed=diagrams_removed,
        review_overall=rounds[-1]["overall"] if rounds and rounds[-1].get("overall") is not None else None,
        references=len(cited_refs),
    )

    # ---- Provenance: for every citation, the sentences that use it, the check verdict and the closest abstract sentence ----
    provenance: dict[str, list[dict]] = {}
    final_sents = quality.cited_sentences(md)
    pairs = [(s_, n) for _, s_, ns in final_sents for n in ns if 1 <= n <= len(cited_refs)][:260]
    if pairs:
        abs_sents = {n: [x.strip() for x in re.split(r"(?<=[.!?])\s+", cited_refs[n - 1].abstract or "") if len(x.strip()) > 30][:14]
                     for n in {n for _, n in pairs}}
        flat = [(n, x) for n, xs in abs_sents.items() for x in xs]
        if flat:
            av = await embed_async([x for _, x in flat])
            sv = await embed_async([s_ for s_, _ in pairs])
            for (s_, n), vec in zip(pairs, sv):
                rows = [i for i, (m, _) in enumerate(flat) if m == n]
                quote = flat[max(rows, key=lambda i: float(av[i] @ vec))][1] if rows else ""
                j = judged.get((_squash(s_), order[n - 1]))
                lst = provenance.setdefault(str(n), [])
                if len(lst) < 6:
                    lst.append({"sentence": s_[:500], "label": j["label"] if j else "revised", "rationale": (j or {}).get("rationale", ""),
                                "quote": ((j or {}).get("passage") or quote)[:500],
                                "source": "full text" if (j or {}).get("passage") else "abstract"})

    report = {
        "paper_type": ptype, "references": len(cited_refs), "candidates": pl["candidates"], "retraction_checked": pl["checked"],
        "retracted_excluded": pl["dropped"], "snowballed": pl.get("snowballed", 0), "experts": pl.get("experts", []),
        "conflicts_found": len(pl.get("conflicts") or []), "novelty": pl.get("novelty"),
        "venue_style": (style or {}).get("stats", {}).get("venue"), "consistency_edits": consistency, "final_consistency_fixes": final_fixes,
        "consistency_error": consistency_error or None,
        "review_panel": {"overall": pan["overall"], "scores": pan["scores"], "issues": len(pan["issues"]),
                         "sections_revised": revised_sections, "rounds": rounds,
                         "final": rounds[-1]["overall"] if len(rounds) > 1 else None},
        "gaps_filled": len(new_refs), "gap_log": gaplog[:8],
        "invalid_citations_removed": bad_cites, "claims_checked": claims["checked"], "claims_unsupported": claims["unsupported"],
        "claims_supported": claims["supported"], "claims_unclear": claims["unclear"], "synthesis_flags": len(claims["synthesis_flags"]),
        "claims_fulltext_checked": claims.get("fulltext_checked", 0),
        "publication_readiness": readiness,
        "paragraphs_flagged": len(flags), "diagrams_repaired": diagrams_repaired, "diagrams_removed": diagrams_removed,
        "equations_repaired": math_fixed, "equations_still_invalid": max(0, len(bad_math) - math_fixed),
        "unmeasured_claims_found": unmeasured + len(abs_issues), "unmeasured_claims_remaining": remaining,
        "paragraphs_revised": revised, "verbatim_paragraphs_after": copied_after, "unmeasured_tables_removed": fabricated_tables,
        "tortured_phrases": [h.phrase for h in phrase_hits], "uncited_refs_dropped": len(refs) - len(cited_refs),
        "figures_checked": len(fig_names), "captions_corrected": recaptioned, "figure_issues": fig_issues,
        "experiments": exp.report,
        "data_analysis": ({**(data.report or {}), "sources": [x["title"] for x in data_sources]} if data and data.facts
                          else ({"error": data_error} if data_error else None)),
    }
    result = {
        "paper_id": pid, "plan_id": plan_id, "paper_type": ptype, "topic": req.topic, "angle": req.angle, "title": outline.title,
        "markdown": md, "highlights": highlights[:5], "summary": front.summary, "keywords": front.keywords[:6],
        "research_question": outline.research_question, "contributions": outline.contributions,
        "report": report, "words": len(re.findall(r"\w+", md)), "provenance": provenance,
        "measured_facts": [ln[2:] for ln in facts_txt.splitlines() if ln.startswith("- ")],
        "references": [{"n": i, "title": p.title, "year": p.year, "doi": p.doi, "url": f"https://doi.org/{p.doi}" if p.doi else p.url,
                        "venue": p.venue, "cited_by": p.cited_by} for i, p in enumerate(cited_refs, 1)],
        "template": req.template, "author": req.author, "affiliation": req.affiliation, "created_at": now().isoformat(),
        "seeded": pl.get("seeded", []),
        "_refs": [p.model_dump() for p in cited_refs], "_facts": facts_txt + ("\n" + exp.markdown if exp.markdown else ""),
        "_method": method_label, "versions": [], "_analysis_code": analysis_code,
        "has_analysis_code": bool(analysis_code),
    }
    store.put("paper_studio", pid, result)
    if plan_owner := store.owner_of(PLAN_KIND, plan_id):   # own it now, not only when the job ends (a restart in between orphans it)
        store.set_owner("paper_studio", pid, plan_owner)
    store.put(PLAN_KIND, plan_id, {**pl, "status": "written", "paper_id": pid})
    await say("done", "done", "Paper generated" + ("" if readiness["ready"] else
                                                    f" · {len(readiness['blockers'])} publication blocker(s) remain"), 1.0)
    return pid


async def _seed_papers(doc_ids: list[str], say) -> tuple[list[Paper], list[str]]:
    """Match uploaded study papers to published OpenAlex records so they can be cited; if an uploaded PDF is an
    unpublished working paper, harvest up to 3 of its verified references + a brief context note without ever
    fabricating an unpublished citation."""
    from rapidfuzz import fuzz

    from backend.documents import service as docs
    out: list[Paper] = []
    notes: list[str] = []
    seen_ids: set[str] = set()
    for did in doc_ids:
        try:
            info = docs.info(did)
        except docs.DocumentError:
            continue
        p = None
        try:
            if info.doi:
                f = await openalex.work_by_doi(info.doi)
                p = openalex.to_paper(f.data) if f.data else None
            if p is None and info.title:
                f = await openalex.search_title(info.title, per_page=3)
                for w in (f.data or {}).get("results", []):
                    if fuzz.ratio((w.get("title") or "").lower(), info.title.lower()) >= 88:
                        p = openalex.to_paper(w)
                        break
        except SourceError:
            p = None
        if p and p.title and p.id not in seen_ids:
            if not p.abstract:
                pages = docs.get_parsed(did).pages
                p.abstract = " ".join(pages[:1])[:1500]
            seen_ids.add(p.id)
            out.append(p)
            await say("scout", "run", f"Matched seed paper: “{p.title[:70]}”")
        else:
            # Unpublished manuscript (e.g. a working draft or showcase paper): extract context + up to 3 real cited refs
            try:
                parsed = docs.get_parsed(did)
                snippet = " ".join((parsed.pages or [""])[:1])[:550].strip()
                if snippet:
                    notes.append(f"- {info.title or info.filename}: {snippet}")
                harvested = 0
                for ref in (parsed.references or [])[:12]:
                    if harvested >= 3:
                        break
                    rp = None
                    try:
                        if ref.doi:
                            f = await openalex.work_by_doi(ref.doi)
                            rp = openalex.to_paper(f.data) if f.data else None
                        elif ref.title and len(ref.title) > 16:
                            f = await openalex.search_title(ref.title, per_page=2)
                            for w in (f.data or {}).get("results", []):
                                if fuzz.ratio((w.get("title") or "").lower(), ref.title.lower()) >= 88:
                                    rp = openalex.to_paper(w)
                                    break
                    except SourceError:
                        rp = None
                    if rp and rp.title and rp.abstract and rp.id not in seen_ids:
                        seen_ids.add(rp.id)
                        out.append(rp)
                        harvested += 1
                await say("scout", "run", f"Extracted study context + {harvested} verified citation(s) from “{(info.title or info.filename)[:55]}”")
            except Exception:
                await say("scout", "run", f"Couldn't match “{(info.title or info.filename)[:60]}” to a published record")
    return out, notes


class _Edit(BaseModel):
    heading: str
    action: str          # rewrite | add_after
    new_heading: str
    instruction: str


class _EditPlan(BaseModel):
    edits: list[_Edit]
    reply: str


def ensure_keywords(md: str, keywords: list[str]) -> str:
    """Keep the **Keywords:** line right after the abstract (a rewritten abstract can drop it)."""
    if "**Keywords:**" in md or not keywords:
        return md
    m = re.search(r"(?ms)^# Abstract\s*\n(.*?)(?=^# )", md)
    if not m:
        return md
    return md[: m.end(1)].rstrip() + f"\n\n**Keywords:** {', '.join(keywords[:6])}\n\n" + md[m.end(1):]


_SPILL = re.compile(r"^(\s*\|.*\|)\s*([^|]{30,})$")


def repair_fences(md: str) -> str:
    """Close code fences the model left open (before the next level-1 heading, and at the end of the text), and move
    prose that was run onto the last row of a table (a table token placed mid-sentence) into its own paragraph:
    Markdown renderers drop cells beyond the header, so that text was silently lost."""
    out, open_ = [], False
    for line in md.splitlines():
        if line.strip().startswith("```"):
            open_ = not open_
        elif open_ and re.match(r"^#{1,2} \S", line):
            out.append("```")
            open_ = False
        elif not open_ and (m := _SPILL.match(line)) and len(m.group(2).split()) >= 5:
            out += [m.group(1), "", m.group(2).strip()]
            continue
        out.append(line)
    if open_:
        out.append("```")
    return _drop_placeholder_tables("\n".join(out))


_PLACEHOLDER = re.compile(r"^(to be (measured|determined|reported)|tbd|tbc|n/?a|pending|\?+|[-–—]+|\.\.\.|…)$", re.I)


def _drop_placeholder_tables(md: str) -> str:
    """A results table whose cells are mostly 'to be measured' / 'TBD' / dashes reads as 'no results' to every reviewer:
    remove it together with its caption line."""
    lines = md.split("\n")
    out: list[str] = []
    i = 0
    while i < len(lines):
        if lines[i].lstrip().startswith("|"):
            j = i
            while j < len(lines) and lines[j].lstrip().startswith("|"):
                j += 1
            rows = [[c.strip() for c in ln.strip().strip("|").split("|")] for ln in lines[i:j]]
            body = [r for r in rows[1:] if not all(re.fullmatch(r":?-{2,}:?", c) for c in r)]
            cells = [c for r in body for c in r[1:]]           # first column is the row label
            if cells and sum(bool(_PLACEHOLDER.match(c)) for c in cells) >= 0.4 * len(cells):
                if out and re.match(r"^table:", out[-1].strip(), re.I):
                    out.pop()
                i = j
                continue
            out += lines[i:j]
            i = j
            continue
        out.append(lines[i])
        i += 1
    return "\n".join(out)


def normalize_section(text: str, heading: str, allow: tuple[str, ...] = ("Conclusion",)) -> str:
    """Keep exactly one level-1 heading per section: later '# X' lines become '## X', and a 'heading' that is really a
    paragraph (long, or ends with a full stop) becomes plain text."""
    out, seen_first = [], False
    fence = False
    for line in text.splitlines():
        if line.strip().startswith("```"):
            fence = not fence
        m = None if fence else re.match(r"^(#{1,6})\s+(.*)$", line)
        if m:
            title = m.group(2).strip()
            if len(title) > 110 or (title.endswith(".") and len(title.split()) > 8):
                out.append(title)
                continue
            if len(m.group(1)) == 1:
                if not seen_first:
                    seen_first = True
                    out.append(f"# {heading}" if title.lower() == heading.lower() else line)
                    continue
                if title not in allow:
                    line = f"## {title}"
        out.append(line)
    return repair_fences("\n".join(out))


_ANNOUNCE = re.compile(r"\b(?:the (?:following|table|list) (?:below|table|list)|as follows|summari[sz]ed (?:below|in the table below))\b", re.I)
_BLOCK_START = ("|", "Table:", "Figure:", "-", "*", "+", "$$", "```", "![", ">", "**Algorithm")


def dangling_announcements(md: str) -> list[int]:
    """Indexes (into _paragraphs) of paragraphs that announce a table or list that does not follow."""
    out = []
    for k, (st, en, t) in enumerate(_paragraphs(md)):
        nxt = md[en:en + 400].lstrip()
        follows = nxt.startswith(_BLOCK_START) or bool(re.match(r"\d+[.)]\s", nxt))
        if (t.rstrip().endswith(":") or _ANNOUNCE.search(t[-220:])) and not follows:
            out.append(k)
    return out


def enforce_headings(md: str, allowed: set[str]) -> str:
    """Only planned sections may be top-level: any other '# X' (outside code) becomes '## X'; empty duplicate headings go."""
    out, fence, seen = [], False, set()
    for line in md.splitlines():
        if line.strip().startswith("```"):
            fence = not fence
        m = None if fence else re.match(r"^# (.+)$", line)
        if m:
            t = m.group(1).strip()
            if t not in allowed:
                line = f"## {t}"
            elif t in seen:
                continue
            else:
                seen.add(t)
        out.append(line)
    return "\n".join(out)


def _sections(md: str) -> list[tuple[str, str]]:
    parts = re.split(r"(?m)^(?=# )", md)
    out = []
    for part in parts:
        if not part.strip():
            continue
        m = re.match(r"# (.+)\n?", part)
        out.append((m.group(1).strip() if m else "", part))
    return out


async def revise(pid: str, instruction: str, ctx) -> str:
    """Apply a plain-language change request: plan which sections change, rewrite them in parallel, then re-verify."""
    store = get_store()
    paper = store.get("paper_studio", pid)
    if not paper or not paper.get("_refs"):
        raise RuntimeError("This paper was created before revisions were supported. Generate it again to revise it.")
    refs = [Paper.model_validate(r) for r in paper["_refs"]]
    facts, method = paper.get("_facts", ""), paper.get("_method", "")
    ptype = paper.get("paper_type") or "method"
    type_rules = TYPE_RULES.get(ptype, TYPE_RULES["method"])
    design_secs = {x.heading for x in PLANS.get(ptype, METHOD).sections if x.design} | (DESIGN_SECTIONS if ptype == "method" else set())

    async def say(agent: str, state: str, text: str, progress: float | None = None) -> None:
        await ctx.update(agent, json.dumps({"agent": agent, "state": state, "text": text}), progress)

    secs = _sections(paper["markdown"])
    editable = [h for h, _ in secs if h not in ("References", "Acknowledgment")]
    await say("architect", "run", "Planning your changes…", 0.05)
    plan = await llm.complete_json(
        "You are the lead author deciding how to apply a co-author's change request to a paper.",
        f"PAPER TITLE: {paper['title']}\nSECTIONS: {editable}\nREQUEST: {instruction}\n\nList the edits needed: for each, the existing "
        "section heading, action 'rewrite' (change that section) or 'add_after' (insert a new section after it, with new_heading), "
        "and a precise instruction for the writer. Change as little as needed. Also write a one-sentence reply to the user "
        "describing what will change.", _EditPlan, effort="medium")
    edits = [e for e in plan.edits if e.heading in editable][:6]
    if not edits:
        raise RuntimeError("I couldn't map that request to a section. Try naming the section, e.g. “expand the Method”.")
    await say("architect", "done", plan.reply, 0.15)
    ref_list = _ref_listing(refs, abstract_chars=300)
    core = f"PAPER TITLE: {paper['title']}\nPROPOSED METHOD: {method}\n\nFACTS (measured, the only numbers you may use):\n{facts}"
    body_of = dict(secs)

    async def do(e: _Edit) -> tuple[_Edit, str]:
        agent = f"writer:{_slug(e.heading)}"
        await say(agent, "run", f"{'Adding ' + e.new_heading if e.action == 'add_after' else 'Revising ' + e.heading}…")
        head = e.new_heading if e.action == "add_after" and e.new_heading else e.heading
        cur = body_of.get(e.heading, "") if e.action != "add_after" else ""
        text = await llm.complete(
            "You are an expert academic writer revising one section of a research paper.\n" + RULES + "\n" + type_rules,
            f"{core}\n\nREFERENCES:\n{ref_list}\n\nSECTION: # {head}\n"
            + (f"CURRENT TEXT:\n{cur}\n\n" if cur else "") + f"CHANGE REQUESTED: {e.instruction}\n"
            "Return the complete revised section in Markdown, starting with its level-1 heading.", effort="medium", max_tokens=6500)
        text = re.sub(r"^```(?:markdown)?\n|\n```$", "", text.strip())
        if not text.lstrip().startswith("# "):
            text = f"# {head}\n\n{text}"
        text = normalize_section(text, head)
        await say(agent, "done", f"{head}: {len(text.split())} words")
        return e, text.rstrip() + "\n\n"

    results = await asyncio.gather(*(do(e) for e in edits))
    new_parts: list[str] = []
    for h, part in secs:
        replaced = next((t for e, t in results if e.heading == h and e.action != "add_after"), None)
        new_parts.append(replaced or part)
        new_parts += [t for e, t in results if e.heading == h and e.action == "add_after"]
    md = "".join(new_parts)
    md = ensure_keywords(md, paper.get("keywords") or [])

    await say("verifier", "run", "Re-checking citations, numbers and equations…", 0.8)
    md, bad = _fix_citations(md, len(refs))
    md = _sanitize_mermaid(md)
    md, _, _ = await fix_diagrams(md)
    allowed = _allowed_numbers(facts, *(p.abstract or "" for p in refs))
    md, _ = strip_unmeasured_tables(md, allowed)
    issues = 0
    for st, en, t in reversed(_paragraphs(md)):
        if _section_of(md, st) in (design_secs | {"References"}):
            continue
        probs = _unmeasured(t, allowed, method)
        if probs:
            issues += 1
            try:
                out = await llm.complete_json("You revise one paragraph of a research paper to fix the listed problems. " + RULES,
                                              f"FACTS:\n{facts}\n\nPARAGRAPH:\n{t.strip()}\n\nPROBLEMS:\n- " + "\n- ".join(probs),
                                              _Rewrite, effort="low", tier="fast")
                if out.paragraph.strip():
                    md = md[:st] + t[: len(t) - len(t.lstrip())] + out.paragraph.strip() + t[len(t.rstrip()):] + md[en:]
            except llm.LLMError:
                pass
    for st, en, tex, disp in reversed(_math_spans(md)):
        if math_problem(tex):
            md = md[:st] + (f"`{tex}`" if not disp else f"```\n{tex}\n```") + md[en:]   # never ship broken math
    await say("verifier", "done", f"{bad} invalid citation(s) removed · {issues} paragraph(s) re-checked", 0.95)

    versions = (paper.get("versions") or [])[-9:] + [{"at": now().isoformat(), "instruction": instruction, "markdown": paper["markdown"]}]
    paper.update(markdown=md, words=len(re.findall(r"\w+", md)), versions=versions, last_change=plan.reply,
                 updated_at=now().isoformat())
    store.put("paper_studio", pid, paper)
    await say("done", "done", plan.reply, 1.0)
    return pid


def _slug(h: str) -> str:
    return re.sub(r"[^a-z]+", "-", h.lower()).strip("-")[:20] or "section"


def figure_png(pid: str, name: str) -> bytes | None:
    row = get_store().get("paper_fig", f"{pid}-{name}")
    return base64.b64decode(row["png"]) if row else None
