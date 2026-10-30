"""Paper Studio: a team of agents writes a complete, referenced research paper from a topic.

Agents (each step streams progress to the UI):
  Scout      plans search queries, retrieves real papers (OpenAlex), reranks them by embedding similarity
             and drops retracted / expression-of-concern works (Crossref update notices).
  Analyst    runs real bibliometric measurements (yearly publication counts) and draws the figures.
  Architect  designs the paper: title, research question, contributions, the proposed method, section briefs.
  Writers    six section writers work in parallel, each citing only the numbered, verified reference list.
  Editor     writes the abstract, keywords, highlights and a plain-language summary.
  Verifier   checks every citation index, verbatim copying (8-word shingles) and close paraphrase (embeddings)
             against the cited abstracts, claim support (sampled), and tortured phrases.
  Reviser    rewrites flagged paragraphs; then citations are renumbered in order of first use (IEEE style).

Honesty rules baked in: every reference is a real record with a link; every number in the paper comes from data we
fetched; experiments we did not run appear as a protocol with "to be measured" cells, never as results.
"""
from __future__ import annotations

import asyncio
import base64
import json
import re
import statistics
import uuid
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

N_REFS = 20
FIG_URL = "/api/paper-studio/{pid}/fig/{name}.png"


class StudioRequest(BaseModel):
    topic: str
    angle: str = ""                  # optional: the user's own idea / constraints
    template: str = "ieee"
    author: str = ""
    affiliation: str = ""
    ai_disclosure: bool = True
    max_refs: int = 20               # set by the server from the user's plan, not trusted from the client
    seed_document_ids: list[str] = []   # the user's own study papers (uploaded PDFs), always cited if found


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
    method_name: str
    method_summary: str
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
     "Motivate the problem with cited evidence, state the research question, and end with a bulleted list of the "
     "contributions. Mention that Section-level figures follow (Fig. 1 shows the publication trend)."),
    ("related", "Related Work",
     "Organise prior work into 2-4 themed ## subsections. Cite as many of the references as are genuinely relevant, "
     "each for what its abstract says. Put the line [[TABLE:refs]] where a summary table of key works belongs. "
     "End by stating clearly how the proposed method differs."),
    ("method", "Proposed Method",
     "Describe the proposed method concretely: problem formulation, 2-3 numbered display equations in $$...$$ with "
     "every symbol defined, and the algorithm as a numbered list of steps. Include exactly one architecture diagram as "
     "a Mermaid block preceded by a caption line 'Figure: <caption>'. Mermaid rules: 'flowchart LR', at most 8 nodes, "
     "node ids are single letters, labels inside [ ] use only letters, digits and spaces."),
    ("analysis", "Bibliometric Analysis",
     "This is the results section and it reports ONLY the measured numbers in FACTS. Interpret the publication trend "
     "(the current year is partial, say so), the age profile and citation impact of the literature. Place the lines "
     "[[FIG:trend]], [[TABLE:trend]], [[FIG:years]] and [[FIG:impact]] where those figures/tables belong, each on its own line."),
    ("protocol", "Experimental Protocol",
     "Specify how the proposed method should be evaluated: research hypotheses, datasets (name a dataset only if a "
     "reference abstract mentions it, otherwise describe the required data), baselines drawn from the references, "
     "metrics, and statistical testing. Include a Markdown table preceded by 'Table: Planned evaluation' whose result "
     "cells all read 'to be measured'. Include one Mermaid 'flowchart TD' of the experimental workflow preceded by "
     "'Figure: <caption>' (same Mermaid rules: single-letter ids, plain labels, at most 8 nodes)."),
    ("discussion", "Discussion and Limitations",
     "Discuss implications, threats to validity (including that the analysis relies on bibliographic metadata and "
     "that the experiments are planned, not yet run), and future work. Then add a '# Conclusion' section of one paragraph."),
]

RULES = """Writing rules (strict):
- Formal academic English, original wording. Never copy or closely paraphrase sentences from the abstracts.
- Cite only with bracketed numbers from REFERENCES, e.g. [3] or [2], [7]. Cite a paper only for what its abstract supports.
- Never invent numbers, results, datasets, p-values, or experiments. The only numbers you may report are in FACTS.
- The proposed method has NOT been run. Never say it achieves, improves, outperforms, reduces or demonstrates anything;
  say what it is designed to do and what the protocol will test (e.g. "we hypothesise", "is expected to", "will be evaluated").
- Output Markdown only. Start with the exact level-1 heading you are given. Use ## for subsections.
- Math: valid LaTeX only, inline $...$ and display $$...$$; never two ^ or two _ on one symbol (write {x^{a}}^{b}).
- No preamble, no notes to the reader, no mention of how the text was produced."""


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


def _ref_listing(refs: list[Paper], ids: list[int] | None = None, abstract_chars: int = 420) -> str:
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


def _paragraphs(md: str) -> list[tuple[int, int, str]]:
    """Prose paragraphs (start, end, text) outside code fences, tables, headings, lists, math, figures."""
    out, pos, fence = [], 0, False
    for chunk in re.split(r"(\n\s*\n)", md):
        start, end = pos, pos + len(chunk)
        pos = end
        s = chunk.strip()
        if s.count("```") % 2 == 1:
            fence = not fence
            continue
        if fence or not s or re.match(r"^(#|\||```|\$\$|!\[|figure:|table:|[-*+]\s|\d+[.)]\s|\[\[)", s, re.I):
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
        nums = [m.group(1).replace(",", "") for m in _NUM.finditer(clean)]
        bad = [n for n in nums if n not in allowed and not (len(n) == 4 and n.startswith(("19", "20")))
               and not (n.isdigit() and int(n) <= 10)]
        if bad:
            out.append(f"“{sent.strip()}” states unmeasured number(s) {', '.join(bad)}; remove them or attribute them to the cited source")
        elif (_RESULT_CLAIM.search(clean) or any(r.search(clean) for r in by_name)) and not re.search(r"\b(hypothes|expect|will|would|could|may|might|designed|aim|intend|propose)", clean, re.I):
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
    await say("scout", "run", "Planning literature searches…", 0.02)
    plan = await llm.complete_json(
        "You plan literature searches for a research paper.",
        f"Topic: {topic}\nAuthor's angle: {angle or '(none)'}\n\nGive 3 short search queries (3-6 words each) that together "
        "cover the topic's core literature, and 2 short noun phrases (1-3 words, as they would appear in paper titles) "
        "whose publication trend over time is worth measuring.", _Plan, effort="low", tier="fast")
    queries = [q for q in plan.queries if q.strip()][:3] or [topic]
    cands: dict[str, Paper] = {}
    for q in queries:
        await say("scout", "run", f"Searching the literature: “{q}”", 0.05)
        try:
            f = await openalex.related_works(q, per_page=25)
        except SourceError:
            continue
        for w in (f.data or {}).get("results", []):
            p = openalex.to_paper(w)
            if p.title and p.abstract and len(p.abstract) > 200 and p.id not in cands:
                cands[p.id] = p
    seeds = await _seed_papers(req.seed_document_ids[:8], say)
    for p in seeds:
        cands.pop(p.id, None)
    if len(cands) + len(seeds) < 6:
        raise RuntimeError("Not enough literature with abstracts was found for this topic. Try a broader topic.")
    pool = list(cands.values())
    tv, av = await embed_async([f"{topic}. {angle}"]), await embed_async([f"{p.title}. {p.abstract}" for p in pool])
    sims = (av @ tv.T).ravel()
    ranked = seeds + [pool[i] for i in np.argsort(-sims)][: req.max_refs + 8 - len(seeds)]
    await say("scout", "run", f"Found {len(cands)} candidate papers; checking the best {len(ranked)} for retractions…", 0.1)
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
    await say("scout", "done", f"{len(refs)} references selected · {checked} confirmed clear of retraction notices"
              + (f" · {len(dropped)} retracted work(s) excluded" if dropped else ""), 0.14)

    # ---- Analyst ----
    await say("analyst", "run", "Measuring publication trends…", 0.16)
    phrases = [p.strip() for p in plan.trend_phrases if p.strip()][:2] or [topic]
    trends: dict[str, dict[int, int]] = {}
    for ph in phrases:
        try:
            counts, _ = await openalex.trend(ph, from_year=this_year - 10)
            if counts:
                trends[ph] = counts
        except SourceError:
            pass
    figs: dict[str, tuple[bytes, str]] = {}
    if trends:
        figs["trend"] = (figures.trend_chart(trends), "Publications per year whose title or abstract contains each phrase "
                         f"(OpenAlex, {this_year - 10}–{this_year}; {this_year} is a partial year).")
    figs["years"] = (figures.reference_years_chart([p.year for p in refs if p.year]),
                     "Publication years of the works cited in this paper.")
    figs["impact"] = (figures.citation_impact_chart([(f"[{i}]", p.cited_by or 0) for i, p in enumerate(refs, 1)]),
                      "Citation counts (OpenAlex) of the most-cited works in the reference list.")
    for name, (png, _) in figs.items():
        store.put("paper_fig", f"{pid}-{name}", {"png": base64.b64encode(png).decode()})
    years = [p.year for p in refs if p.year]
    cites = [p.cited_by or 0 for p in refs]
    facts = []
    for ph, c in trends.items():
        full = {y: n for y, n in c.items() if y < this_year}
        if not full:
            continue
        first, last = min(full), max(full)
        facts.append(f"- Phrase “{ph}”: {full[first]} works in {first}, {full[last]} in {last}"
                     + (f" ({full[last] / full[first]:.1f}x)" if full[first] else "")
                     + f"; {c.get(this_year, 0)} so far in {this_year} (partial year). Yearly: "
                     + ", ".join(f"{y}: {n}" for y, n in sorted(c.items())))
    if years:
        facts.append(f"- Reference list: {len(refs)} works published {min(years)}–{max(years)}, median year "
                     f"{int(statistics.median(years))}.")
    facts.append(f"- Reference list citation counts: median {int(statistics.median(cites))}, maximum {max(cites)} "
                 f"([{cites.index(max(cites)) + 1}]).")
    if dropped:
        facts.append(f"- {len(dropped)} candidate work(s) were excluded because Crossref lists a retraction or expression of concern.")
    facts_txt = "\n".join(facts)
    await say("analyst", "done", f"{len(trends)} trend series measured · {len(figs)} figures drawn", 0.22)

    # ---- Architect ----
    await say("architect", "run", "Designing the paper…", 0.24)
    outline = await llm.complete_json(
        "You are a senior researcher designing a publishable paper grounded in the given references and measured facts.",
        f"Topic: {topic}\nAuthor's angle: {angle or '(none)'}\n\nFACTS (measured):\n{facts_txt}\n\nREFERENCES:\n{_ref_listing(refs)}\n\n"
        "Design the paper: a specific, informative title; one research question; 3 contributions; a concrete proposed "
        "method (a name and a 3-5 sentence summary) that addresses a gap visible in these references; and for each "
        "section key in the list below a brief. The method has not been implemented or run: contributions must be phrased as "
        "what the paper proposes, designs, measures (the bibliometric FACTS only) or specifies, never as experimental results. "
        "For each "
        f"key in {[k for k, *_ in SECTIONS]}: a 2-3 sentence brief plus the reference numbers it should draw on.",
        _Outline, effort="high")
    briefs = {b.key: b for b in outline.briefs}
    await say("architect", "done", f"“{outline.title}”", 0.3, title=outline.title)

    # ---- Writers (parallel) ----
    core = (f"PAPER TITLE: {outline.title}\nRESEARCH QUESTION: {outline.research_question}\nCONTRIBUTIONS:\n"
            + "\n".join(f"- {c}" for c in outline.contributions)
            + f"\nPROPOSED METHOD: {outline.method_name}: {outline.method_summary}\n\nFACTS (measured, the only numbers you may use):\n{facts_txt}")
    done_n = 0

    async def write(key: str, heading: str, task: str) -> str:
        nonlocal done_n
        await say(f"writer:{key}", "run", f"Writing {heading}…")
        b = briefs.get(key)
        ids = [i for i in (b.refs if b else []) if 1 <= i <= len(refs)]
        text = await llm.complete(
            "You are an expert academic writer drafting one section of a research paper.\n" + RULES,
            f"{core}\n\nREFERENCES:\n{_ref_listing(refs, ids or None)}\n\nSECTION: # {heading}\nBRIEF: {b.brief if b else ''}\n"
            f"TASK: {task}\nLength: 350-650 words.", effort="medium", max_tokens=5000)
        text = text.strip()
        text = re.sub(r"^```(?:markdown)?\n|\n```$", "", text)
        if not text.lstrip().startswith("# "):
            text = f"# {heading}\n\n{text}"
        text = normalize_section(text, heading)
        done_n += 1
        await say(f"writer:{key}", "done", f"{heading}: {len(text.split())} words", 0.3 + 0.35 * done_n / len(SECTIONS))
        return text
    parts = await asyncio.gather(*(write(k, h, t) for k, h, t in SECTIONS))
    body = "\n\n".join(parts)

    # ---- Editor ----
    await say("editor", "run", "Writing the abstract, keywords and highlights…", 0.68)
    front = await llm.complete_json(
        "You are the editor of a research paper. Formal academic English, original wording. Never invent numbers or "
        "results; the only numbers you may use are in FACTS. No mention of how the text was produced.",
        f"{core}\n\nPAPER BODY:\n{body[:llm.context_chars() - 8000]}\n\nWrite: an abstract (150-220 words, no citations, "
        "no numbers other than those in FACTS; the method is proposed and not yet evaluated, so claim no results for it); 5 keywords; 4 one-sentence highlights; and a 3-4 sentence plain-language "
        "summary for non-experts.", _Front, effort="medium")
    await say("editor", "done", "Abstract, keywords, highlights and summary ready", 0.72)

    # ---- Verifier ----
    await say("verifier", "run", "Checking citations, copying and claim support…", 0.74)
    body, bad_cites = _fix_citations(body, len(refs))
    body = _sanitize_mermaid(body)
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
            if len(ms) == 1 and len(_nums(ms[0])) == 1 and len(items) < 14:
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
    design = {k for k, (st, _, _) in enumerate(paras) if _section_of(body, st) in ("Proposed Method", "Experimental Protocol")}
    unmeasured = 0
    for k, (_, _, t) in enumerate(paras):
        if k in design:
            continue
        issues = _unmeasured(t, allowed, outline.method_name)
        if issues:
            unmeasured += len(issues)
            flags.setdefault(k, []).extend(issues)
    unsupported = [(i, j) for i, j in judged.items() if j.label == "unsupported"]
    for i, j in unsupported:
        flags.setdefault(where[i], []).append(f"the sentence “{items[i][1]}” cites a paper whose abstract does not support it ({j.rationale})")
    await say("verifier", "done", f"{len(items)} citation claims checked · {len(unsupported)} unsupported · "
              f"{unmeasured} unmeasured claim(s) · {len(flags)} paragraph(s) need revision · {bad_cites} invalid citation number(s) removed", 0.84)

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
                    "as a design or hypothesis, never with results. Keep it about the same length.\n\nFACTS:\n" + facts_txt, _Rewrite, effort="low", tier="fast")
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
    abs_issues = _unmeasured(front.abstract, allowed, outline.method_name)
    if abs_issues:
        try:
            front.abstract = (await llm.complete_json(
                "You revise a research-paper abstract to fix the listed problems. Keep it 150-220 words, original wording, no citations.",
                f"FACTS (the only numbers allowed):\n{facts_txt}\n\nABSTRACT:\n{front.abstract}\n\nPROBLEMS:\n- " + "\n- ".join(abs_issues),
                _Rewrite, effort="low", tier="fast")).paragraph.strip() or front.abstract
        except llm.LLMError:
            pass
    front.highlights = [h for h in front.highlights if not _unmeasured(h, allowed, outline.method_name)]
    remaining = sum(len(_unmeasured(t, allowed, outline.method_name)) for k, (st, _, t) in enumerate(_paragraphs(body))
                    if _section_of(body, st) not in ("Proposed Method", "Experimental Protocol")) + len(_unmeasured(front.abstract, allowed, outline.method_name))
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
        trend_rows = ("Table: Works per year matching each phrase (OpenAlex; "
                      f"{this_year} partial)\n| Year | " + " | ".join(trends) + " |\n|---|" + "---|" * len(trends) + "\n"
                      + "\n".join(f"| {y} | " + " | ".join(str(c.get(y, 0)) for c in trends.values()) + " |" for y in yrs))
    top = sorted(((old_to_new[i], p) for i, p in enumerate(refs, 1) if i in old_to_new), key=lambda t: -(t[1].cited_by or 0))[:8]
    ref_table = ("Table: Key works discussed (metadata from OpenAlex)\n| Ref. | Title | Year | Venue | Citations |\n|---|---|---|---|---|\n"
                 + "\n".join(f"| [{n}] | {p.title[:70].replace('|', '/')} | {p.year or ''} | {(p.venue or '–')[:40].replace('|', '/')} | {p.cited_by or 0:,} |"
                             for n, p in sorted(top, key=lambda t: t[0])))
    tokens = {"[[FIG:trend]]": fig_block("trend"), "[[FIG:years]]": fig_block("years"), "[[FIG:impact]]": fig_block("impact"),
              "[[TABLE:trend]]": trend_rows, "[[TABLE:refs]]": ref_table}
    for tok, rep in tokens.items():
        if tok in body:
            body = body.replace(tok, rep, 1).replace(tok, "")
        elif rep:
            anchor = "\n# Experimental Protocol" if tok != "[[TABLE:refs]]" else "\n# Proposed Method"
            body = body.replace(anchor, f"\n{rep}\n{anchor}", 1) if anchor in body else body + f"\n\n{rep}"
    # The impact chart labels refs by their pre-renumbering index; redraw it with final numbers.
    figs_png = figures.citation_impact_chart([(f"[{old_to_new[i]}]", p.cited_by or 0) for i, p in enumerate(refs, 1) if i in old_to_new])
    store.put("paper_fig", f"{pid}-impact", {"png": base64.b64encode(figs_png).decode()})

    md = (f"# Abstract\n\n{front.abstract.strip()}\n\n**Keywords:** {', '.join(front.keywords[:6])}\n\n{body.strip()}\n\n"
          + ("# Acknowledgment\n\nThe authors used AI-assisted writing tools to draft parts of this manuscript and verified "
             "all content, references and figures. All bibliometric figures were computed from OpenAlex data.\n\n" if req.ai_disclosure else "")
          + "# References\n\n" + "\n".join(f"{i}. {_ieee_ref(p)}" for i, p in enumerate(cited_refs, 1)) + "\n")

    report = {
        "references": len(cited_refs), "candidates": len(cands), "retraction_checked": checked,
        "retracted_excluded": [{"title": p.title, "doi": p.doi} for p in dropped],
        "invalid_citations_removed": bad_cites, "claims_checked": len(items), "claims_unsupported": len(unsupported),
        "claims_supported": sum(j.label == "supported" for j in judged.values()),
        "paragraphs_flagged": len(flags), "equations_repaired": math_fixed, "equations_still_invalid": len(bad_math) - math_fixed, "unmeasured_claims_found": unmeasured + len(abs_issues),
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
        "_refs": [p.model_dump() for p in cited_refs], "_facts": facts_txt, "_method": outline.method_name, "versions": [],
    }
    store.put("paper_studio", pid, result)
    await say("done", "done", "Paper ready", 1.0)
    return pid


async def _seed_papers(doc_ids: list[str], say) -> list[Paper]:
    """Match the user's uploaded papers to real records (DOI first, then exact-ish title) so they can be cited."""
    from rapidfuzz import fuzz

    from backend.documents import service as docs
    out: list[Paper] = []
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
                    if fuzz.ratio((w.get("title") or "").lower(), info.title.lower()) >= 90:
                        p = openalex.to_paper(w)
                        break
        except SourceError:
            p = None
        if p and p.title:
            if not p.abstract:   # cite it for what the user's own copy says
                pages = docs.get_parsed(did).pages
                p.abstract = " ".join(pages[:1])[:1500]
            out.append(p)
            await say("scout", "run", f"Your paper matched: “{p.title[:70]}”")
        else:
            await say("scout", "run", f"Couldn't match “{(info.title or info.filename)[:60]}” to a published record, so it is not cited")
    return out


class _Edit(BaseModel):
    heading: str
    action: str          # rewrite | add_after
    new_heading: str
    instruction: str


class _EditPlan(BaseModel):
    edits: list[_Edit]
    reply: str


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
            "Return the complete revised section in Markdown, starting with its level-1 heading.", effort="medium", max_tokens=6000)
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

    await say("verifier", "run", "Re-checking citations, numbers and equations…", 0.8)
    md, bad = _fix_citations(md, len(refs))
    md = _sanitize_mermaid(md)
    allowed = _allowed_numbers(facts, *(p.abstract or "" for p in refs))
    issues = 0
    for st, en, t in reversed(_paragraphs(md)):
        if _section_of(md, st) in ("Proposed Method", "Experimental Protocol", "References"):
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
