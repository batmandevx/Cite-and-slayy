"""Presentation deck content for a paper: slide text from the model, every number and chart from the paper itself.

Returns JSON the browser turns into a .pptx (pptxgenjs, native charts and shapes):
- text: one model call over the paper's own sections; numbers may only come from the paper's measured facts
- data: parsed from the manuscript (trend table, reference years, architecture diagram, evaluation table, figures)
"""
from __future__ import annotations

import re
from collections import Counter

from pydantic import BaseModel

from backend.cache.store import get_store
from backend.llm import client as llm


class _Card(BaseModel):
    title: str
    text: str


class _Theory(BaseModel):
    kind: str
    name: str
    statement: str


class _Deck(BaseModel):
    subtitle: str
    hook_value: str
    hook_label: str
    problem: list[_Card]
    research_question: str
    thesis: str
    contributions: list[_Card]
    gap: list[_Card]
    equation: str
    equation_explained: str
    method_modules: list[_Card]
    algorithm: list[str]
    theory: list[_Theory]
    hypotheses: list[_Card]
    metrics: list[str]
    limitations: list[_Card]
    conclusion: list[str]
    next_steps: list[str]
    notes: list[str]


def _section(md: str, name: str) -> str:
    m = re.search(rf"(?ms)^# {re.escape(name)}[^\n]*\n(.*?)(?=^# |\Z)", md)
    return m.group(1).strip() if m else ""


def _section_like(md: str, *words: str) -> str:
    for h in re.findall(r"(?m)^# (.+)$", md):
        if any(w.lower() in h.lower() for w in words):
            return _section(md, h.strip())
    return ""


def _tables(md: str) -> list[tuple[str, list[list[str]]]]:
    out = []
    for m in re.finditer(r"(?m)^Table:\s*(.+)\n(?:[ \t]*\n)?((?:[ \t]*\|.*\|[ \t]*\n?)+)", md):
        rows = []
        for ln in m.group(2).strip().splitlines():
            cells = [c.strip() for c in ln.strip().strip("|").split("|")]
            if not all(re.fullmatch(r":?-{2,}:?", c) for c in cells):
                rows.append(cells)
        out.append((m.group(1).strip(), rows))
    return out


def _mermaid_graph(code: str) -> dict:
    nodes: dict[str, dict] = {}
    edges = []
    tok = r"([A-Za-z]\w*)(?:\[\(?([^\]\)]*)\)?\]|\{([^}]*)\}|\(\(?([^)]*)\)?\))?"
    for ln in code.splitlines()[1:]:
        if re.match(r"\s*(subgraph|end\b|classDef|class\s|style\s|linkStyle|%%|direction)", ln):
            continue
        parts = re.split(r"\s*(?:-->|---|-\.->|==>)(?:\|[^|]*\|)?\s*", ln.strip())
        ids = []
        for p in parts:
            m = re.match(tok, p.strip())
            if not m:
                continue
            nid = m.group(1)
            label = (m.group(2) or m.group(3) or m.group(4) or "").strip()
            label = re.sub(r"\s*<\s*br\s*/?>\s*|\s+br\s+", " ", label)   # line-break tags (or their sanitised remains)
            label = re.sub(r"\s+", " ", label).strip()
            if nid not in nodes or (label and not nodes[nid]["label"]):
                nodes[nid] = {"id": nid, "label": label or nodes.get(nid, {}).get("label") or nid, "decision": bool(m.group(3))}
            ids.append(nid)
        edges += [[a, b] for a, b in zip(ids, ids[1:])]
    return {"nodes": list(nodes.values())[:10], "edges": edges[:16]}


def extract_data(paper: dict) -> dict:
    md = paper.get("markdown", "")
    tables = _tables(md)
    trend = next((rows for cap, rows in tables if re.search(r"per year|publication counts|annual", cap, re.I) and len(rows) > 2
                  and rows[1:] and rows[1][0].strip().isdigit()), None)
    trend_series = None
    if trend:
        head, body = trend[0], trend[1:]
        years = [r[0] for r in body if r and r[0].isdigit()]
        series = []
        for j, name in enumerate(head[1:], 1):
            vals = []
            for r in body:
                if r and r[0].isdigit():
                    try:
                        vals.append(int(r[j].replace(",", "")))
                    except (ValueError, IndexError):
                        vals.append(0)
            series.append({"name": name, "values": vals})
        trend_series = {"labels": years, "series": series}
    refs = paper.get("references") or []
    yc = Counter(r.get("year") for r in refs if r.get("year"))
    blocks = re.findall(r"```mermaid\n(.*?)\n```", md, re.S)
    captioned = re.findall(r"(?m)^Figure:\s*([^\n]*)\n```mermaid\n(.*?)\n```", md, re.S)
    arch = next((c for cap, c in captioned if re.search(r"architect|framework|pipeline|system", cap, re.I)), None)
    method = _section_like(md, "Proposed Method", "Method")
    arch = arch or next(iter(re.findall(r"```mermaid\n(.*?)\n```", method, re.S)), None) or (blocks[0] if blocks else None)
    evaluation = next((rows for cap, rows in tables if "to be measured" in str(rows).lower()), None)
    positioning = next((rows for cap, rows in tables if "position" in cap.lower()), None)
    figs = [{"caption": c, "url": u} for c, u in re.findall(r"!\[([^\]]*)\]\((/api/paper-studio/[^)]+)\)", md)]
    return {
        "trend": trend_series,
        "ref_years": {"labels": [str(y) for y in sorted(yc)], "values": [yc[y] for y in sorted(yc)]},
        "architecture": _mermaid_graph(arch) if arch else None,
        "evaluation": evaluation[:8] if evaluation else None,
        "positioning": positioning[:7] if positioning else None,
        "figures": figs,
        "stats": {"references": len(refs), "words": paper.get("words"),
                  "median_ref_year": sorted(r["year"] for r in refs if r.get("year"))[len([r for r in refs if r.get("year")]) // 2] if any(r.get("year") for r in refs) else None,
                  "top_cited": max((r.get("cited_by") or 0 for r in refs), default=0)},
        "references": [{"n": r.get("n"), "title": r.get("title"), "year": r.get("year"), "venue": r.get("venue")} for r in refs[:8]],
    }


async def build(pid: str, author: str = "", affiliation: str = "") -> dict:
    paper = get_store().get("paper_studio", pid)
    if not paper:
        raise ValueError("paper not found")
    md = paper["markdown"]
    parts = {
        "abstract": _section(md, "Abstract"), "introduction": _section(md, "Introduction")[:3500],
        "related": _section_like(md, "Related")[:2500], "formulation": _section_like(md, "Formulation")[:2500],
        "method": _section_like(md, "Proposed Method", "Method")[:3500], "theory": _section_like(md, "Theoretical", "Analysis")[:2500],
        "protocol": _section_like(md, "Experimental", "Protocol")[:2500], "discussion": _section_like(md, "Discussion")[:2500],
        "conclusion": _section(md, "Conclusion")[:1200],
    }
    body = "\n\n".join(f"## {k.upper()}\n{v}" for k, v in parts.items() if v)
    facts = paper.get("_facts", "")
    out = await llm.complete_json(
        "You turn a research paper into a conference talk. Write slide text that is short, concrete and faithful to the "
        "paper: titles under 7 words, card text under 22 words, bullets under 14 words. Use ONLY numbers that appear in "
        "MEASURED FACTS (never invent results; the method's experiments are planned, not run). Plain text, no Markdown. "
        "Equations as readable Unicode (e.g. ŷ = argmin Σ ℓ(f(x), y) + λ‖θ‖²).",
        f"TITLE: {paper['title']}\nMEASURED FACTS:\n{facts}\n\nPAPER:\n{body}\n\n"
        "Fill: subtitle (one line); hook_value + hook_label (one striking measured number from FACTS and what it means); "
        "problem (3 cards); research_question; thesis (one sentence); contributions (4 cards); gap (3 cards: what prior "
        "work misses); equation (the single most important equation) + equation_explained (one sentence); method_modules "
        "(3 cards); algorithm (5 short steps); theory (up to 3: kind = Theorem/Lemma/Proposition, name, one-sentence "
        "statement); hypotheses (3 cards H1–H3); metrics (4 short items); limitations (4 cards); conclusion (3 bullets); "
        "next_steps (3 bullets); notes (16 speaker-note paragraphs, 2–4 sentences each, one per slide in this order: title, "
        "problem, question, contributions, gap, formulation, architecture, algorithm, theory, trend, literature, hypotheses, "
        "evaluation, limitations, conclusion, references).", _Deck, effort="medium")
    deck = out.model_dump()
    deck.update(title=paper["title"], author=author or paper.get("author") or "", affiliation=affiliation or paper.get("affiliation") or "",
                keywords=paper.get("keywords") or [], template=paper.get("template", "ieee"), data=extract_data(paper))
    return deck
