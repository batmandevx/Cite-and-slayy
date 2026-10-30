"""Paper Studio: a multi-agent research team writes a complete, publication-grade research monograph from a topic.

Agents (each step streams live progress to the UI):
  Scout      plans 4 targeted search queries, retrieves real papers (OpenAlex), incorporates seed papers, reranks by
             embedding similarity, and excludes retracted / expression-of-concern works via Crossref update notices.
  Analyst    runs real bibliometric measurements (10-year longitudinal trends, age profile, citation skew, top venues)
             and renders 4 publication-grade 300 DPI figures.
  Architect  designs a monograph-grade blueprint: title, named method + acronym, formal problem & assumptions,
             theoretical claim + boundary condition, and section-specific briefs across 8 specialist writers.
  Writers    eight specialist writers work in parallel (Introduction, Related Work + Positioning Table, Formal Problem &
             Notation Table, Proposed Method + Algorithm 1 + Complexity, Theoretical Analysis + Proofs + Failure Bound,
             Quantitative Bibliometric Synthesis, Experimental & Ablation Protocol, Discussion/Failure Modes/Conclusion).
  Editor     drafts a structured 170–240 word abstract, keywords, highlights, and plain-language summary.
  Verifier   audits every citation index, 8-word verbatim shingles, embedding paraphrase overlap, sampled claim-abstract
             entailment, Mermaid syntax, KaTeX/LaTeX math validity, and unmeasured-claim guards.
  Reviser    rewrites any flagged paragraphs and repairs equations; citations are renumbered by first use (IEEE style).

Strict scientific honesty rules:
  - Every reference is a real scholarly record with a DOI or URL, checked against Crossref retraction notices.
  - Every empirical/bibliometric number in the paper comes strictly from fetched OpenAlex/Crossref data in FACTS.
  - Theoretical propositions derive purely from explicitly stated mathematical assumptions; empirical benchmarks that
    have not been executed are presented as a rigorous evaluation & ablation protocol with "to be measured" cells.
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
from pydantic import BaseModel

from backend.cache.store import get_store, now
from backend.citeguard import claims as claim_check
from backend.citeguard.overlap import find_overlaps
from backend.citeguard.phrases import find_phrases
from backend.citeguard.resolver import retraction_status
from backend.common.schemas import Paper
from backend.documents.parser import Paragraph
from backend.embeddings.model import embed_async
from backend.llm import client as llm
from backend.paper_studio import figures
from backend.sources import openalex
from backend.sources.http import SourceError

N_REFS = 26
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


# ---------- agent output schemas ----------

class _Plan(BaseModel):
    queries: list[str]
    trend_phrases: list[str]


class _Brief(BaseModel):
    key: str
    brief: str
    refs: list[int]


class _Outline(BaseModel):
    title: str
    research_question: str
    contributions: list[str]
    method_acronym: str
    method_name: str
    method_summary: str
    formal_assumptions: list[str]
    formal_claim: str
    failure_boundary: str
    briefs: list[_Brief]


class _Front(BaseModel):
    abstract: str
    keywords: list[str]
    highlights: list[str]
    summary: str


class _Rewrite(BaseModel):
    paragraph: str


SECTIONS: list[tuple[str, str, str]] = [
    ("intro", "Introduction",
     "Open with the concrete technical bottleneck and failure modes of existing approaches, grounded in multiple citations. "
     "State the sharp research question and thesis of the paper, previewing the proposed method (by name and acronym) and "
     "referencing the longitudinal literature trajectory (Fig. 1). Provide a numbered 4-point list of contributions covering: "
     "(1) formal problem/system formulation, (2) the proposed multi-component architecture and Algorithm 1, "
     "(3) formal theoretical properties and explicit boundary/failure-mode analysis, and (4) quantitative bibliometric synthesis "
     "paired with a leak-free ablation and evaluation protocol. Close with a concise paragraph outlining the section-by-section "
     "organization of the paper."),
    ("related", "Background and Related Work",
     "Organise prior literature into 3 focused ## subsections by technical paradigm. Cite references accurately and densely "
     "strictly for what their abstracts establish, comparing assumptions, mechanisms, and limitations across works. "
     "Place the token [[TABLE:refs]] on its own line where the quantitative key-works summary table belongs. "
     "Also include a Markdown comparison table preceded by 'Table: Qualitative positioning of the proposed framework against "
     "representative prior paradigms' whose columns compare 4 prior method families (with citations) and the proposed method "
     "across 5 concrete technical properties using 'Yes', 'Partial', or 'No'. End by pinpointing the exact structural gap "
     "addressed by this paper."),
    ("formulation", "Problem Formulation and System Model",
     "Formally define the mathematical setting, input/output spaces, operational or threat/drift model, and optimization or "
     "decision objective using 2–3 clear display equations in $$...$$ with every variable defined in prose. "
     "Explicitly state 3 numbered structural assumptions (**Assumption A1**, **Assumption A2**, **Assumption A3**) specifying "
     "what holds in the environment and what is NOT assumed. Include a comprehensive Markdown table preceded by "
     "'Table: Summary of mathematical notation' with columns '| Symbol | Domain / Space | Meaning |' covering every core symbol "
     "used in the formulation and proposed method."),
    ("method", "Proposed Method",
     "Present the proposed framework in full technical depth across 2–3 ## subsections corresponding to its core modules. "
     "Provide 3–4 display equations in $$...$$ defining the scoring, update, or control laws, explaining the intuition and "
     "edge-case behaviour of every term. Include one system architecture diagram as a Mermaid block preceded by "
     "'Figure: Architecture of the proposed framework' ('flowchart LR', 6–8 nodes, single-letter node IDs A..H, plain words "
     "inside [ ] or { } with no parentheses, quotes, or brackets inside labels). Include a structured **Algorithm 1** block "
     "(using a Markdown blockquote or bold header '**Algorithm 1:** <Name>' followed by **Input:**, **Parameters:**, numbered "
     "execution steps 1..k with inline $math$, and **Output:**). Conclude with a Markdown table preceded by "
     "'Table: Per-step time and memory complexity by module' reporting asymptotic Big-O complexity in terms of the notation symbols."),
    ("theory", "Theoretical and Formal Analysis",
     "Develop the formal mathematical properties of the proposed method under Assumptions A1–A3. Present **Proposition 1**, "
     "**Lemma 1**, and **Theorem 1**, each formatted with a bold header (e.g. '**Theorem 1 (Title).** *Formal statement...*') "
     "followed immediately by '*Proof Sketch.*' deriving the bound or invariant step-by-step using valid LaTeX equations in $$...$$ "
     "and closing with $\\square$. Then state **Proposition 2 (Boundary Condition and Failure Regime)** characterizing the exact "
     "mathematical regime where an assumption is violated and deriving how performance or guarantees degrade. "
     "Important: keep all results strictly mathematical/analytical consequences of the definitions and assumptions; never claim "
     "empirical benchmark numbers."),
    ("analysis", "Quantitative Literature and Bibliometric Synthesis",
     "Report and interpret ONLY the real empirical bibliometric measurements provided in FACTS (do not invent any numbers). "
     "Analyze the 10-year publication growth trajectory (explicitly noting that the current calendar year is partial), "
     "the temporal age profile and recency of the cited corpus, citation concentration across foundational vs. recent works, "
     "and the distribution across peer-reviewed venues. Place the tokens [[FIG:trend]], [[TABLE:trend]], [[FIG:years]], "
     "[[FIG:impact]], and [[FIG:venues]] each on its own standalone line at the natural point where it is discussed."),
    ("protocol", "Experimental Setup and Ablation Protocol",
     "Design a rigorous, reproducible, leak-free empirical evaluation protocol to test the proposed method: state 3 falsifiable "
     "hypotheses (**H1–H3**), specify strict development/calibration vs. held-out test split rules (preventing hyperparameter "
     "leakage), describe datasets (naming specific datasets only if mentioned in cited abstracts, else specifying domain/scale "
     "requirements), list concrete baselines from the cited references, define primary and diagnostic metrics with equations, "
     "and specify paired non-parametric statistical testing (e.g. Wilcoxon signed-rank test with Holm–Bonferroni correction). "
     "Include one Mermaid 'flowchart TD' workflow diagram preceded by 'Figure: Leak-free evaluation and ablation workflow' "
     "(single-letter IDs, plain words in [ ] or { }, max 8 nodes). Include TWO Markdown tables: "
     "(1) 'Table: Component ablation matrix' isolating each module/hyperparameter variant and what hypothesis it tests, and "
     "(2) 'Table: Planned benchmark comparison' comparing cited baselines and the proposed method across primary metrics where "
     "every unrun empirical cell reads 'to be measured'."),
    ("discussion", "Discussion, Failure Modes and Limitations",
     "Structure into ## Failure Modes and Operational Mitigations (concrete scenarios where the method can underperform or "
     "degrade and practical safeguards), ## Threats to Validity (internal, external, construct, bibliographic coverage, and "
     "the fact that empirical benchmarks remain planned rather than executed), and ## Broader Impact and Deployment Considerations. "
     "Finish with a top-level '# Conclusion' section (1–2 crisp paragraphs) synthesizing the formal formulation, method, "
     "theoretical guarantees, bibliometric evidence, and immediate experimental roadmap."),
]

RULES = """Writing rules (strict):
- Authoritative IEEE journal monograph style (clear, dense, technically precise academic English; original wording).
- Never copy or closely paraphrase sentences from reference abstracts. Synthesize ideas in fresh scholarly prose.
- Cite only with bracketed numbers from REFERENCES, e.g. [3] or [2], [7]. Cite a paper ONLY for what its abstract supports.
- Never invent empirical numbers, benchmark scores, dataset sizes, p-values, or experimental outcomes. The ONLY empirical/bibliometric numbers you may report are in FACTS (or explicitly attributed to a cited abstract that states them).
- The proposed method has NOT been empirically executed yet. Never write that it achieves, outperforms, reduces error by X%, demonstrates empirically, or attains state-of-the-art results; phrase empirical expectations as hypotheses, design goals, or formal analytical properties under stated mathematical assumptions.
- Output Markdown only. Start with the exact level-1 heading you are given. Use ## for subsections.
- Every Markdown table MUST be preceded on the immediately previous line by 'Table: <informative caption>'. Every Mermaid block MUST be preceded on the immediately previous line by 'Figure: <informative caption>'.
- Math: valid KaTeX/LaTeX only, inline $...$ and display $$...$$; never place two ^ or two _ on one base (write {x^{a}}^{b}); balance all braces and \\left / \\right pairs.
- No meta-commentary, no notes to the reader, and no mention of prompts or how the manuscript was drafted."""


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


def _ref_listing(refs: list[Paper], ids: list[int] | None = None, abstract_chars: int = 440) -> str:
    rows = []
    for i, p in enumerate(refs, 1):
        if ids and i not in ids:
            rows.append(f"[{i}] {p.title} ({p.year})")
        else:
            rows.append(f"[{i}] {p.title} ({p.year}, {p.venue or 'n/a'})\n    Abstract: {(p.abstract or '')[:abstract_chars]}")
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


def _fix_citations(md: str, n_refs: int) -> tuple[str, int]:
    """Drop citation numbers outside 1..n_refs. Returns (markdown, removed)."""
    removed = 0

    def sub(m: re.Match) -> str:
        nonlocal removed
        ns = _nums(m.group(1))
        ok = [n for n in dict.fromkeys(ns) if 1 <= n <= n_refs]
        removed += len(ns) - len(ok)
        return "[" + ", ".join(map(str, ok)) + "]" if ok else ""
    return _CITE.sub(sub, md), removed


def _renumber(md: str) -> tuple[str, list[int]]:
    """Renumber citations by first appearance. Returns (markdown, old ids in new order)."""
    order: list[int] = []
    for m in _CITE.finditer(md):
        for n in _nums(m.group(1)):
            if n not in order:
                order.append(n)
    new = {old: i for i, old in enumerate(order, 1)}

    def sub(m: re.Match) -> str:
        ns = sorted({new[n] for n in _nums(m.group(1)) if n in new})
        return "[" + ", ".join(map(str, ns)) + "]" if ns else ""
    return _CITE.sub(sub, md), order


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

async def run(req: StudioRequest, ctx) -> str:
    pid = uuid.uuid4().hex[:10]
    store = get_store()
    topic = req.topic.strip()[:300]
    angle = req.angle.strip()[:1500]
    this_year = date.today().year

    async def say(agent: str, state: str, text: str, progress: float | None = None, **extra: Any) -> None:
        await ctx.update(agent, json.dumps({"agent": agent, "state": state, "text": text, **extra}), progress)

    # ---- Scout ----
    await say("scout", "run", "Planning multi-facet literature searches…", 0.02)
    seeds, seed_notes = await _seed_papers(req.seed_document_ids[:8], say)
    seed_hint = ("\nStudy notes from user-uploaded papers:\n" + "\n".join(seed_notes[:3])) if seed_notes else ""
    plan = await llm.complete_json(
        "You plan comprehensive scholarly literature searches for an IEEE-grade research monograph.",
        f"Topic: {topic}\nAuthor's angle: {angle or '(none)'}{seed_hint}\n\n"
        "Give 4 distinct, complementary search queries (3–6 words each) covering foundational theory, core algorithms, "
        "recent architectures, and evaluation benchmarks for this topic, plus 2–3 concise noun phrases (1–3 words, as they "
        "appear in paper titles/abstracts) whose 10-year publication trend should be measured.",
        _Plan, effort="low", tier="fast")
    queries = [q for q in plan.queries if q.strip()][:4] or [topic]
    cands: dict[str, Paper] = {}
    for q in queries:
        await say("scout", "run", f"Searching OpenAlex: “{q}”", 0.05)
        try:
            f = await openalex.related_works(q, per_page=30)
        except SourceError:
            continue
        for w in (f.data or {}).get("results", []):
            p = openalex.to_paper(w)
            if p.title and p.abstract and len(p.abstract) > 180 and p.id not in cands:
                cands[p.id] = p
    for p in seeds:
        cands.pop(p.id, None)
    if len(cands) + len(seeds) < 6:
        raise RuntimeError("Not enough literature with abstracts was found for this topic. Try a broader topic.")
    pool = list(cands.values())
    tv, av = await embed_async([f"{topic}. {angle}"]), await embed_async([f"{p.title}. {p.abstract}" for p in pool])
    sims = (av @ tv.T).ravel()
    ranked = seeds + [pool[i] for i in np.argsort(-sims)][: req.max_refs + 10 - len(seeds)]
    await say("scout", "run", f"Found {len(cands)} candidate papers; screening top {len(ranked)} against Crossref retractions…", 0.1)
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
    await say("scout", "done", f"{len(refs)} verified references selected from {len(cands)} candidates · {checked} retraction-clear"
              + (f" · {len(dropped)} retracted work(s) excluded" if dropped else ""), 0.14)

    # ---- Analyst ----
    await say("analyst", "run", "Measuring 10-year publication trends, impact & venue distribution…", 0.16)
    phrases = [p.strip() for p in plan.trend_phrases if p.strip()][:3] or [topic]
    trends: dict[str, dict[int, int]] = {}
    for ph in phrases:
        try:
            counts, _ = await openalex.trend(ph, from_year=this_year - 10)
            if counts:
                trends[ph] = counts
        except SourceError:
            pass
    venue_counts = Counter(
        p.venue.strip() for p in list(cands.values()) + refs
        if p.venue and p.venue.strip() and p.venue.strip().lower() not in ("n/a", "unknown")
    )
    top_venues = venue_counts.most_common(8)

    figs: dict[str, tuple[bytes, str]] = {}
    if trends:
        figs["trend"] = (figures.trend_chart(trends), "Annual publication trajectory for core topic phrases "
                         f"(OpenAlex, {this_year - 10}–{this_year}; {this_year} reflects partial-year indexing).")
    figs["years"] = (figures.reference_years_chart([p.year for p in refs if p.year]),
                     "Temporal distribution and median publication year of works in the reference corpus.")
    figs["impact"] = (figures.citation_impact_chart([(f"[{i}]", p.cited_by or 0) for i, p in enumerate(refs, 1)]),
                      "OpenAlex citation counts of the highest-impact anchoring works in the reference list.")
    if len(top_venues) >= 2:
        figs["venues"] = (figures.venues_chart(top_venues),
                          f"Primary peer-reviewed journals and proceedings across the {len(cands)}-paper candidate pool (OpenAlex).")
    for name, (png, _) in figs.items():
        store.put("paper_fig", f"{pid}-{name}", {"png": base64.b64encode(png).decode()})

    years = [p.year for p in refs if p.year]
    cites = [p.cited_by or 0 for p in refs]
    facts = [f"- Candidate literature pool retrieved from OpenAlex: {len(cands)} works with full abstracts across {len(queries)} search queries; {len(refs)} selected into the final bibliography."]
    for ph, c in trends.items():
        full = {y: n for y, n in c.items() if y < this_year}
        if not full:
            continue
        first, last = min(full), max(full)
        facts.append(f"- Phrase “{ph}”: {full[first]} indexed works in {first}, {full[last]} in {last}"
                     + (f" ({full[last] / full[first]:.1f}x)" if full[first] else "")
                     + f"; {c.get(this_year, 0)} indexed so far in {this_year} (partial year). Yearly counts: "
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

    # ---- Architect ----
    await say("architect", "run", "Architecting formal model, algorithm, theoretical bounds & section briefs…", 0.24)
    outline = await llm.complete_json(
        "You are a principal research scientist architecting a rigorous, IEEE-Transactions / IEEE-Access style research monograph "
        "grounded strictly in the given references and measured bibliometric facts.",
        f"Topic: {topic}\nAuthor's angle: {angle or '(none)'}{seed_hint}\n\nFACTS (measured):\n{facts_txt}\n\nREFERENCES:\n{_ref_listing(refs)}\n\n"
        "Design an authoritative, technically deep paper:\n"
        "1. title: A specific, scholarly title starting with '<ACRONYM>: ...' or featuring a precise technical subtitle.\n"
        "2. method_acronym: A memorable 3–6 letter uppercase acronym (e.g. ADITI, ALIZA, CAST).\n"
        "3. method_name: '<ACRONYM>: <Full Descriptive Method Name>'.\n"
        "4. research_question: One sharp, falsifiable technical research question.\n"
        "5. contributions: 4 concrete contributions (formulation, proposed algorithm/architecture, formal analytical guarantees + boundary analysis, bibliometric synthesis + leak-free ablation protocol). Phrase strictly as what this paper formulates, proposes, proves analytically, or measures bibliometrically—never as unrun empirical results.\n"
        "6. method_summary: A concrete 5–6 sentence technical specification naming the mathematical state variables, modular pipeline, decision/update equations, and asymptotic complexity.\n"
        "7. formal_assumptions: 3 explicit mathematical/system assumptions (A1–A3).\n"
        "8. formal_claim: A specific mathematical property (e.g. invariance, monotonicity, calibration/error bound, stability, or complexity bound) derivable analytically from A1–A3.\n"
        "9. failure_boundary: The exact regime where A1–A3 break down and how the method behaves.\n"
        f"10. briefs: For EVERY key in {[k for k, *_ in SECTIONS]}, a detailed 3-sentence brief plus 6–14 relevant reference numbers from REFERENCES.",
        _Outline, effort="high")
    briefs = {b.key: b for b in outline.briefs}
    method_label = outline.method_name if outline.method_acronym in outline.method_name else f"{outline.method_name} ({outline.method_acronym})"
    await say("architect", "done", f"“{outline.title}”", 0.3, title=outline.title)

    # ---- Writers (8 specialists in parallel) ----
    core = (
        f"PAPER TITLE: {outline.title}\n"
        f"RESEARCH QUESTION: {outline.research_question}\n"
        f"PROPOSED METHOD: {method_label} — {outline.method_summary}\n"
        f"FORMAL ASSUMPTIONS (A1–A3):\n" + "\n".join(f"- {a}" for a in outline.formal_assumptions[:4]) + "\n"
        f"TARGET ANALYTICAL PROPERTY: {outline.formal_claim}\n"
        f"BOUNDARY / FAILURE REGIME: {outline.failure_boundary}\n"
        f"CONTRIBUTIONS:\n" + "\n".join(f"- {c}" for c in outline.contributions[:5]) + "\n\n"
        f"FACTS (measured — the ONLY empirical/bibliometric numbers you may report):\n{facts_txt}"
    )
    done_n = 0

    async def write(key: str, heading: str, task: str) -> str:
        nonlocal done_n
        await say(f"writer:{key}", "run", f"Drafting {heading}…")
        b = briefs.get(key)
        ids = [i for i in (b.refs if b else []) if 1 <= i <= len(refs)]
        text = await llm.complete(
            "You are a senior IEEE Transactions / IEEE Access author drafting one section of a flagship research monograph.\n" + RULES,
            f"{core}\n\nREFERENCES:\n{_ref_listing(refs, ids or None)}\n\nSECTION: # {heading}\n"
            f"ARCHITECT BRIEF: {b.brief if b else ''}\nSECTION REQUIREMENTS: {task}\n"
            "Target length: 650–950 words of substantive, non-repetitive technical prose, equations, and structured tables/diagrams.",
            effort="medium", max_tokens=6500)
        text = text.strip()
        text = re.sub(r"^```(?:markdown)?\n|\n```$", "", text)
        if not text.lstrip().startswith("# "):
            text = f"# {heading}\n\n{text}"
        text = normalize_section(text, heading)
        done_n += 1
        await say(f"writer:{key}", "done", f"{heading}: {len(text.split())} words", 0.3 + 0.36 * done_n / len(SECTIONS))
        return text

    parts = await asyncio.gather(*(write(k, h, t) for k, h, t in SECTIONS))
    body = "\n\n".join(parts)

    # ---- Editor ----
    await say("editor", "run", "Drafting structured abstract, index terms & highlights…", 0.68)
    front = await llm.complete_json(
        "You are the Editor-in-Chief finalizing the front matter of an IEEE research monograph. Formal academic English, "
        "original wording. Never invent empirical numbers; the only numbers allowed are in FACTS. Never mention how the text was produced.",
        f"{core}\n\nPAPER BODY:\n{body[:llm.context_chars() - 8000]}\n\n"
        "Write:\n"
        "1. abstract: 175–235 words covering context/gap, formal problem & proposed method (naming the acronym), analytical "
        "properties & failure-boundary characterization, quantitative bibliometric synthesis (using only FACTS numbers), and "
        "the leak-free evaluation protocol. Include NO citations and claim NO unrun empirical results.\n"
        "2. keywords: 6 technical IEEE Index Terms.\n"
        "3. highlights: 4 crisp one-sentence takeaways.\n"
        "4. summary: A 3–4 sentence plain-language summary for interdisciplinary readers.",
        _Front, effort="medium")
    await say("editor", "done", "Abstract, index terms, highlights & summary ready", 0.72)

    # ---- Verifier ----
    await say("verifier", "run", "Auditing citations, originality, equations, diagrams & claims…", 0.74)
    body, bad_cites = _fix_citations(body, len(refs))
    body = _sanitize_mermaid(body)
    body, diagrams_repaired, diagrams_removed = await fix_diagrams(body)
    body = await ensure_workflow_diagram(body)
    abs_shingles = set().union(*(_shingles(p.abstract or "") for p in refs))
    paras = _paragraphs(body)
    flags: dict[int, list[str]] = {}
    for k, (_, _, t) in enumerate(paras):
        v = _verbatim(t, abs_shingles)
        if v:
            flags.setdefault(k, []).append(f"{v} eight-word sequence(s) copied verbatim from a cited abstract")
    ov = await find_overlaps([Paragraph(page=0, start=0, end=0, text=t) for _, _, t in paras], refs, [])
    para_idx = {t: k for k, (_, _, t) in enumerate(paras)}
    for h in ov:
        k = para_idx.get(h.paragraph)
        if k is not None:
            flags.setdefault(k, []).append(f"too close to the abstract of “{h.matched.title}” (similarity {h.similarity:.2f}); "
                                           f"closest sentence: “{h.matched_text}”")
    # claim support on single-citation sentences (sampled)
    items: list[tuple[int, str, str, str]] = []
    where: dict[int, int] = {}
    for k, (_, _, t) in enumerate(paras):
        for s in re.split(r"(?<=[.!?])\s+", t):
            ms = _CITE.findall(s)
            if len(ms) == 1 and len(_nums(ms[0])) == 1 and len(items) < 18:
                n = _nums(ms[0])[0]
                items.append((len(items), s.strip(), refs[n - 1].title, refs[n - 1].abstract or ""))
                where[len(items) - 1] = k
    judged = {}
    if items:
        try:
            judged = await claim_check.judge(items)
        except llm.LLMError:
            judged = {}
    allowed = _allowed_numbers(facts_txt, *(p.abstract or "" for p in refs))
    design = {k for k, (st, _, _) in enumerate(paras) if _section_of(body, st) in DESIGN_SECTIONS}
    unmeasured = 0
    for k, (_, _, t) in enumerate(paras):
        if k in design:
            continue
        issues = _unmeasured(t, allowed, method_label)
        if issues:
            unmeasured += len(issues)
            flags.setdefault(k, []).extend(issues)
    unsupported = [(i, j) for i, j in judged.items() if j.label == "unsupported"]
    for i, j in unsupported:
        flags.setdefault(where[i], []).append(f"the sentence “{items[i][1]}” cites a paper whose abstract does not support it ({j.rationale})")
    await say("verifier", "done", f"{len(items)} citation claims audited · {len(unsupported)} unsupported · "
              f"{unmeasured} unmeasured claim(s) · {len(flags)} paragraph(s) queued for revision", 0.84)

    # ---- Reviser ----
    revised = 0
    if flags:
        await say("reviser", "run", f"Revising {len(flags)} flagged paragraph(s)…", 0.86)

        async def fix(k: int) -> tuple[int, str]:
            _, _, t = paras[k]
            try:
                out = await llm.complete_json(
                    "You revise one paragraph of a research paper to fix the listed problems. " + RULES,
                    f"REFERENCES:\n{_ref_listing(refs, abstract_chars=300)}\n\nPARAGRAPH:\n{t.strip()}\n\nPROBLEMS:\n- "
                    + "\n- ".join(flags[k]) + "\n\nRewrite the paragraph in original wording; remove or replace any citation that its abstract does "
                    "not support; remove every number that is not in FACTS or a cited abstract; describe the proposed method only "
                    "as a formal design or hypothesis, never with empirical results. Keep similar length.\n\nFACTS:\n" + facts_txt,
                    _Rewrite, effort="low", tier="fast")
                return k, out.paragraph.strip()
            except llm.LLMError:
                return k, t
        for k, new in await asyncio.gather(*(fix(k) for k in flags)):
            s, e, old = paras[k]
            if new and new != old.strip():
                lead = old[: len(old) - len(old.lstrip())]
                trail = old[len(old.rstrip()):]
                body = body.replace(old, lead + new + trail, 1)
                revised += 1
        body, more_bad = _fix_citations(body, len(refs))
        bad_cites += more_bad
        await say("reviser", "done", f"{revised} paragraph(s) rewritten", 0.92)
    bad_math = [(st, en, tex, disp, err) for st, en, tex, disp in _math_spans(body) if (err := math_problem(tex))]
    math_fixed = 0
    if bad_math:
        await say("reviser", "run", f"Fixing {len(bad_math)} malformed equation(s)…")

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
        await say("reviser", "done", f"{revised} paragraph(s) rewritten · {math_fixed} equation(s) repaired")
    # Never ship broken math spans even if LLM repair skipped one
    for st, en, tex, disp in reversed(_math_spans(body)):
        if math_problem(tex):
            body = body[:st] + (f"`{tex}`" if not disp else f"```\n{tex}\n```") + body[en:]

    abs_issues = _unmeasured(front.abstract, allowed, method_label)
    if abs_issues:
        try:
            front.abstract = (await llm.complete_json(
                "You revise a research-paper abstract to fix the listed problems. Keep it 175-235 words, original wording, no citations.",
                f"FACTS (the only numbers allowed):\n{facts_txt}\n\nABSTRACT:\n{front.abstract}\n\nPROBLEMS:\n- " + "\n- ".join(abs_issues),
                _Rewrite, effort="low", tier="fast")).paragraph.strip() or front.abstract
        except llm.LLMError:
            pass
    front.highlights = [h for h in front.highlights if not _unmeasured(h, allowed, method_label)]
    remaining = sum(len(_unmeasured(t, allowed, method_label)) for k, (st, _, t) in enumerate(_paragraphs(body))
                    if _section_of(body, st) not in DESIGN_SECTIONS) + len(_unmeasured(front.abstract, allowed, method_label))
    copied_after = sum(1 for _, _, t in _paragraphs(body) if _verbatim(t, abs_shingles))
    phrase_hits = find_phrases([body], None)

    # ---- Assemble ----
    body, order = _renumber(body)
    old_to_new = {old: new for new, old in enumerate(order, 1)}
    cited_refs = [refs[o - 1] for o in order]

    def fig_block(name: str) -> str:
        if name not in figs:
            return ""
        return f"Figure: {figs[name][1]}\n![{figs[name][1]}]({FIG_URL.format(pid=pid, name=name)})"

    trend_rows = ""
    if trends:
        yrs = sorted({y for c in trends.values() for y in c})
        trend_rows = ("Table: Annual OpenAlex publication counts matching each phrase ("
                      f"{this_year} partial year)\n| Year | " + " | ".join(trends) + " |\n|---|" + "---|" * len(trends) + "\n"
                      + "\n".join(f"| {y} | " + " | ".join(str(c.get(y, 0)) for c in trends.values()) + " |" for y in yrs))
    top = sorted(((old_to_new[i], p) for i, p in enumerate(refs, 1) if i in old_to_new), key=lambda t: -(t[1].cited_by or 0))[:10]
    ref_table = ("Table: Representative foundational and recent works in the cited corpus (metadata via OpenAlex)\n"
                 "| Ref. | Title | Year | Venue | Citations |\n|---|---|---|---|---|\n"
                 + "\n".join(f"| [{n}] | {p.title[:72].replace('|', '/')} | {p.year or ''} | {(p.venue or '–')[:40].replace('|', '/')} | {p.cited_by or 0:,} |"
                             for n, p in sorted(top, key=lambda t: t[0])))
    tokens = {
        "[[FIG:trend]]": fig_block("trend"),
        "[[FIG:years]]": fig_block("years"),
        "[[FIG:impact]]": fig_block("impact"),
        "[[FIG:venues]]": fig_block("venues"),
        "[[TABLE:trend]]": trend_rows,
        "[[TABLE:refs]]": ref_table,
    }
    for tok, rep in tokens.items():
        if tok in body:
            body = body.replace(tok, rep, 1).replace(tok, "")
        elif rep:
            anchor = "\n# Problem Formulation and System Model" if tok == "[[TABLE:refs]]" else "\n# Experimental Setup and Ablation Protocol"
            body = body.replace(anchor, f"\n{rep}\n{anchor}", 1) if anchor in body else body + f"\n\n{rep}"
    # Redraw citation impact chart with post-renumbering indices [1..N]
    figs_png = figures.citation_impact_chart([(f"[{old_to_new[i]}]", p.cited_by or 0) for i, p in enumerate(refs, 1) if i in old_to_new])
    store.put("paper_fig", f"{pid}-impact", {"png": base64.b64encode(figs_png).decode()})

    md = (f"# Abstract\n\n{front.abstract.strip()}\n\n**Keywords:** {', '.join(front.keywords[:6])}\n\n{body.strip()}\n\n"
          + ("# Acknowledgment\n\nThe authors used AI-assisted research and drafting tools to prepare portions of this manuscript "
             "and verified all formal derivations, citations, and bibliometric figures. Bibliometric statistics were computed "
             "directly from OpenAlex and Crossref metadata.\n\n" if req.ai_disclosure else "")
          + "# References\n\n" + "\n".join(f"{i}. {_ieee_ref(p)}" for i, p in enumerate(cited_refs, 1)) + "\n")

    report = {
        "references": len(cited_refs), "candidates": len(cands), "retraction_checked": checked,
        "retracted_excluded": [{"title": p.title, "doi": p.doi} for p in dropped],
        "invalid_citations_removed": bad_cites, "claims_checked": len(items), "claims_unsupported": len(unsupported),
        "claims_supported": sum(j.label == "supported" for j in judged.values()),
        "paragraphs_flagged": len(flags), "diagrams_repaired": diagrams_repaired, "diagrams_removed": diagrams_removed,
        "equations_repaired": math_fixed, "equations_still_invalid": max(0, len(bad_math) - math_fixed),
        "unmeasured_claims_found": unmeasured + len(abs_issues),
        "unmeasured_claims_remaining": remaining, "paragraphs_revised": revised, "verbatim_paragraphs_after": copied_after,
        "tortured_phrases": [h.phrase for h in phrase_hits], "uncited_refs_dropped": len(refs) - len(cited_refs),
    }
    result = {
        "paper_id": pid, "topic": topic, "angle": angle, "title": outline.title, "markdown": md,
        "highlights": front.highlights[:5], "summary": front.summary, "keywords": front.keywords[:6],
        "research_question": outline.research_question, "contributions": outline.contributions,
        "report": report, "words": len(re.findall(r"\w+", md)),
        "references": [{"n": i, "title": p.title, "year": p.year, "doi": p.doi, "url": f"https://doi.org/{p.doi}" if p.doi else p.url,
                        "venue": p.venue, "cited_by": p.cited_by} for i, p in enumerate(cited_refs, 1)],
        "template": req.template, "author": req.author, "affiliation": req.affiliation, "created_at": now().isoformat(),
        "seeded": [p.title for p in seeds],
        # kept for revisions: the numbered reference records, measured facts and the method name
        "_refs": [p.model_dump() for p in cited_refs], "_facts": facts_txt, "_method": method_label, "versions": [],
    }
    store.put("paper_studio", pid, result)
    await say("done", "done", "Paper ready", 1.0)
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


def repair_fences(md: str) -> str:
    """Close code fences the model left open: before the next level-1 heading, and at the end of the text."""
    out, open_ = [], False
    for line in md.splitlines():
        if line.strip().startswith("```"):
            open_ = not open_
        elif open_ and re.match(r"^#{1,2} \S", line):
            out.append("```")
            open_ = False
        out.append(line)
    if open_:
        out.append("```")
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
            "You are an expert academic writer revising one section of a research paper.\n" + RULES,
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
    issues = 0
    for st, en, t in reversed(_paragraphs(md)):
        if _section_of(md, st) in (DESIGN_SECTIONS | {"References"}):
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
