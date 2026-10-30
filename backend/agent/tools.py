"""Azora AI's tools. Every tool does real work against real data and returns a compact, JSON-serialisable result.

A tool result may include:
  summary: one-line human summary (shown on the tool card)
  data:    structured payload the model reads (kept small)
  chart:   {"type": "bar"|"multi", ...} rendered as an animated chart in the chat
  link:    {"tab": ..., "doc"/"audit"/"review"/"gap"/"notesView"/"noteId": id} to open the result in the app
"""
from __future__ import annotations

import re
import statistics
import time
import uuid
from collections import Counter
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Awaitable, Callable

from backend.cache.store import get_store
from backend.citeguard import claims as claims_mod
from backend.citeguard.audit import run_audit
from backend.citeguard.phrases import find_phrases
from backend.citeguard.resolver import resolve_reference, retraction_status
from backend.common.schemas import AuditReport, AuditRequest, GapRadarRequest, JuryRequest, Paper, Verdict
from backend.documents import service as docs
from backend.documents.parser import AY_CITE, NARR_CITE, NUM_CITE, RefEntry, parse_entry
from backend.embeddings.model import embed_async
from backend.gap_radar import pipeline as gap
from backend.gap_radar import questions as gapq
from backend.jury.verdict import run_jury
from backend.sources import crossref, openalex
from backend.sources.http import SourceError

# The signed-in user this agent turn acts for (set by the API before the job starts; tasks inherit it).
CURRENT_USER: ContextVar[dict | None] = ContextVar("azora_user", default=None)


def _user() -> dict:
    from backend.accounts.auth import LOCAL_USER
    return CURRENT_USER.get() or LOCAL_USER


def _ws(kind: str) -> str:
    from backend.accounts.auth import workspace_key
    return workspace_key(kind, _user())


def _metered(feature: str) -> None:
    """Tool runs that cost real money count against the same plan limits as the buttons in the app."""
    from fastapi import HTTPException

    from backend.accounts.auth import consume
    try:
        consume(_user(), feature)
    except HTTPException as e:
        detail = e.detail if isinstance(e.detail, dict) else {"message": str(e.detail)}
        raise ToolError(detail.get("message", "plan limit reached") + " Upgrade your plan to continue.") from e


def _own(kind: str, id: str) -> None:
    from backend.accounts.auth import own
    own(kind, id, _user())


PREPRINT_REPOS = ("arxiv", "biorxiv", "medrxiv", "chemrxiv", "ssrn", "zenodo", "research square", "osf preprints", "hal")
STICKY_COLORS = ["#ffd23f", "#ff9ecf", "#c6f24e", "#9fd8ff", "#ffb38a", "#c9b6ff"]
OVERCLAIM_RE = re.compile(
    r"\b(100%\s+accura\w+|proves?\s+beyond\s+doubt|completely\s+solves?|zero\s+error|flawless\w*|"
    r"always\s+outperforms?|universally\s+superior|eliminates?\s+all\s+\w+)\b",
    re.I,
)
HEDGE_RE = re.compile(
    r"\b(suggests?|indicates?|hypothesi[sz]e|empirically|ablation|confidence\s+interval|"
    r"limitations?|statistically\s+significant|p\s*[<≤]\s*0\.\d+|error\s+bars?|across\s+\d+\s+seeds?)\b",
    re.I,
)


class ToolError(Exception):
    pass


class _QuietCtx:
    """Job-context stand-in: long tools report progress through the agent's own event callback."""

    def __init__(self, emit):
        self.emit = emit

    async def update(self, stage: str, message: str, progress: float | None = None) -> None:
        if self.emit:
            await self.emit(message)


@dataclass
class Tool:
    name: str
    description: str
    args: dict[str, str]          # arg name -> description (types in text; validated in the function)
    fn: Callable[..., Awaitable[dict]]
    slow: bool = False


def _paper(p: Paper) -> dict:
    return {"title": p.title, "year": p.year, "venue": p.venue, "cited_by": p.cited_by, "doi": p.doi,
            "url": f"https://doi.org/{p.doi}" if p.doi else p.url}


async def search_papers(query: str, limit: int = 6, **_) -> dict:
    f = await openalex.related_works(query, per_page=min(max(1, int(limit)), 10))
    papers = [openalex.to_paper(w) for w in (f.data or {}).get("results", [])][: int(limit)]
    return {"summary": f"{len(papers)} papers from OpenAlex for “{query}”",
            "data": [{**_paper(p), "abstract": (p.abstract or "")[:300]} for p in papers],
            "papers": [_paper(p) for p in papers]}


async def trend_experiment(phrases: list[str] | str, from_year: int = 2016, **_) -> dict:
    if isinstance(phrases, str):
        phrases = [p.strip() for p in phrases.split(",") if p.strip()] or [phrases]
    phrases = [p.strip() for p in phrases if str(p).strip()][:4]
    if not phrases:
        raise ToolError("give 1-4 phrases")
    series, notes = {}, []
    for ph in phrases:
        counts, _ = await openalex.trend(ph, int(from_year))
        series[ph] = counts
        ys = sorted(counts)
        full = [y for y in ys if y < max(ys)] if ys else []
        if len(full) >= 3:
            a, b = counts.get(full[-3], 0), counts.get(full[-1], 0)
            notes.append(f"{ph}: {a} → {b} papers ({full[-3]}→{full[-1]})")
    return {"summary": "Publication trend (exact phrase in title/abstract, OpenAlex): " + "; ".join(notes or phrases),
            "data": {"counts": series,
                     "caveats": ["the latest year is partial",
                                 "phrase search is case-insensitive: short acronyms can match unrelated terms "
                                 "(e.g. 'LoRA' also matches LoRa wireless radio); mention this when it applies"]},
            "chart": {"type": "multi", "series": series}}


async def venue_fit_experiment(query: str, **_) -> dict:
    """Live experiment: where do the closest real peer-reviewed papers on OpenAlex actually get published?"""
    if not str(query).strip():
        raise ToolError("provide a research topic, title or abstract")
    f = await openalex.related_works(str(query).strip()[:400], per_page=40)
    raw = (f.data or {}).get("results", [])
    papers = [openalex.to_paper(w) for w in raw]
    venue_counts: Counter[str] = Counter()
    oa_count = 0
    cites: list[int] = []
    for w, p in zip(raw, papers):
        if (w.get("open_access") or {}).get("is_oa"):
            oa_count += 1
        if p.cited_by is not None:
            cites.append(p.cited_by)
        v = (p.venue or "").strip()
        if v and not any(rep in v.lower() for rep in PREPRINT_REPOS):
            venue_counts[v] += 1
    top = venue_counts.most_common(6)
    med_cites = round(statistics.median(cites), 1) if cites else 0
    oa_pct = round(100 * oa_count / len(papers)) if papers else 0
    summary = (
        f"Analyzed {len(papers)} related OpenAlex works · top venue: {top[0][0]} ({top[0][1]}) · {oa_pct}% OA · median {med_cites} cites"
        if top else f"Analyzed {len(papers)} related OpenAlex works ({oa_pct}% OA, mostly preprints)"
    )
    return {
        "summary": summary,
        "data": {
            "sample_size": len(papers),
            "open_access_pct": oa_pct,
            "median_citations": med_cites,
            "top_venues": [{"venue": v, "count": n} for v, n in top],
            "note": "Preprint servers (arXiv, Zenodo, SSRN, bioRxiv) excluded from venue ranking.",
        },
        "chart": {"type": "bar", "items": [{"label": v[:28], "value": n} for v, n in top]} if top else None,
        "papers": [_paper(p) for p in papers[:4]],
    }


async def text_integrity_test(text: str, **_) -> dict:
    """Instant CiteGuard prose experiment on pasted text: tortured phrases, citation density, and claim calibration."""
    snippet = str(text or "").strip()
    if len(snippet) < 20:
        raise ToolError("provide at least one sentence or paragraph to test")
    phrase_hits = find_phrases([snippet], None)
    num_cites = len(NUM_CITE.findall(snippet))
    ay_cites = len(AY_CITE.findall(snippet)) + len(NARR_CITE.findall(snippet))
    total_cites = num_cites + ay_cites
    overclaims = [m.group(0) for m in OVERCLAIM_RE.finditer(snippet)]
    hedges = [m.group(0) for m in HEDGE_RE.finditer(snippet)]
    words = len(snippet.split())
    flagged = [
        {"phrase": h.phrase, "expected": h.expected, "source": h.source, "source_url": h.source_url, "context": h.context}
        for h in phrase_hits[:8]
    ]
    summary = (
        f"{words} words · {len(phrase_hits)} tortured phrase(s) · {total_cites} inline citation(s) · "
        f"{len(overclaims)} overclaim trigger(s) · {len(hedges)} empirical/calibration signal(s)"
    )
    return {
        "summary": summary,
        "data": {
            "words": words,
            "tortured_phrases": flagged,
            "inline_citations": total_cites,
            "overclaim_triggers": overclaims[:6],
            "calibration_signals": list(dict.fromkeys(h.lower() for h in hedges))[:8],
        },
        "chart": {
            "type": "bar",
            "items": [
                {"label": "Inline citations", "value": total_cites},
                {"label": "Empirical signals", "value": len(hedges)},
                {"label": "Overclaim flags", "value": len(overclaims)},
                {"label": "Tortured phrases", "value": len(phrase_hits)},
            ],
        },
    }


async def check_citation(citation: str, **_) -> dict:
    ref = parse_entry(citation)
    check, _ = await resolve_reference(RefEntry(index=1, label="[1]", number=1, parsed=ref), check_retraction=True)
    m = check.matched
    return {"summary": f"{check.status.replace('_', ' ')} · retraction: {check.retraction.replace('_', ' ')}"
                       + (f" · {m.title[:70]}" if m else ""),
            "data": {"status": check.status, "retraction": check.retraction, "notices": check.retraction_notices,
                     "matched": m.model_dump() if m else None,
                     "mismatches": [d.model_dump() for d in check.mismatches],
                     "evidence": [{"source": e.source, "note": e.note, "url": e.request_url} for e in check.evidence[:4]]}}


async def check_retraction(doi: str, **_) -> dict:
    doi = doi.replace("https://doi.org/", "").strip()
    status, notices, ev = await retraction_status(doi)
    title = None
    try:
        f = await crossref.get_work(doi)
        if f.data:
            title = crossref.to_paper(f.data["message"]).title
    except SourceError:
        pass
    return {"summary": f"{doi}: {status.replace('_', ' ')}" + (f" (notice {', '.join(notices)})" if notices else ""),
            "data": {"doi": doi, "title": title, "status": status, "notices": notices,
                     "note": ev[0].note if ev else ""}}


async def test_claim(claim: str, doi: str, **_) -> dict:
    doi = doi.replace("https://doi.org/", "").strip()
    p = None
    f = await openalex.work_by_doi(doi)
    if f.data:
        p = openalex.to_paper(f.data)
    if (p is None or not p.abstract):
        try:
            fc = await crossref.get_work(doi)
            if fc.data:
                cp = crossref.to_paper(fc.data["message"])
                if p is None:
                    p = cp
                elif cp.abstract and not p.abstract:
                    p.abstract = cp.abstract
        except SourceError:
            pass
    if p is None:
        raise ToolError(f"no OpenAlex or Crossref record found for {doi}")
    if not p.abstract:
        return {"summary": "No abstract available in OpenAlex/Crossref, so the claim can't be tested (result: unclear)",
                "data": {"label": "unclear", "title": p.title, "similarity": None}}
    vecs = await embed_async([claim, p.abstract])
    sim = round(float(vecs[0] @ vecs[1]), 3)
    res = await claims_mod.judge([(1, claim, p.title, p.abstract)])
    j = res.get(1)
    lbl = j.label if j else ("supported" if sim >= 0.62 else "unclear" if sim >= 0.35 else "unsupported")
    rat = (j.rationale if j else f"Embedding cosine similarity between claim and abstract is {sim:.2f} (LLM unavailable).")
    return {"summary": f"{lbl} (cosine {sim:.2f}): “{p.title[:65]}”",
            "data": {"label": lbl, "similarity": sim, "rationale": rat, "title": p.title,
                     "abstract": p.abstract[:600]}}


async def list_papers(**_) -> dict:
    from backend.accounts.auth import check_access
    from fastapi import HTTPException
    out = []
    for p in sorted((docs._dir()).glob("*")):
        try:
            check_access("document", p.stem, _user())
        except HTTPException:
            continue
        try:
            i = docs.info(p.stem)
            out.append({"document_id": i.document_id, "title": i.title or i.filename, "references": i.n_references})
        except docs.DocumentError:
            continue
    return {"summary": f"{len(out)} papers available", "data": out}


def _doc(document_id: str):
    from backend.accounts.auth import check_access
    from fastapi import HTTPException
    try:
        check_access("document", document_id, _user())
    except HTTPException as e:
        raise ToolError(f"unknown document_id {document_id}; call list_papers first") from e
    try:
        return docs.info(document_id)
    except docs.DocumentError as e:
        raise ToolError(f"unknown document_id {document_id}; call list_papers first") from e


async def audit_paper(document_id: str, emit=None, **_) -> dict:
    info = _doc(document_id)
    _metered("audits")
    audit_id = await run_audit(AuditRequest(document_id=document_id), _QuietCtx(emit))
    _own("audit", audit_id)
    r = AuditReport.model_validate(get_store().get("audit", audit_id))
    s = r.summary
    flagged = [{"ref": x.label, "status": x.status, "retraction": x.retraction, "title": (x.matched.title if x.matched else x.parsed.raw)[:90]}
               for x in r.references if x.status != "verified" or x.retraction == "retracted"][:8]
    return {"summary": f"Integrity {r.score:.0f}/100 · {s['verified']}/{s['references']} refs verified · {s['retracted_cited']} retracted citation(s)"
                       + (" · PAPER ITSELF RETRACTED" if s.get("self_retracted") else ""),
            "data": {"audit_id": audit_id, "score": r.score, "summary": s, "flagged": flagged, "warnings": r.warnings[:3],
                     "title": info.title},
            "link": {"tab": "audit", "doc": document_id, "audit": audit_id}}


async def review_paper(document_id: str, venue: str | None = None, emit=None, **_) -> dict:
    _doc(document_id)
    ref = get_store().get("audit_by_doc", document_id)
    _metered("reviews")
    from backend.accounts.auth import is_premium
    from backend.llm.client import set_premium
    set_premium(is_premium(_user()))
    review_id = await run_jury(JuryRequest(document_id=document_id, audit_id=ref["audit_id"] if ref else None, venue=venue),
                               _QuietCtx(emit))
    _own("verdict", review_id)
    v = Verdict.model_validate(get_store().get("verdict", review_id))
    return {"summary": f"Verdict: {v.decision.replace('_', ' ').upper()} · jury {v.weighted_mean or '—'}/10 · integrity {v.integrity if v.integrity is not None else '—'}",
            "data": {"decision": v.decision, "why": v.triggered_rules[:3], "top_fixes": [f.fix for f in v.ranked_fixes[:5]],
                     "personas": [{"persona": p.persona, "score": p.score} for p in v.personas]},
            "link": {"tab": "verdict", "doc": document_id, "audit": v.audit_id, "review": review_id}}


async def scan_field(query: str, max_papers: int = 300, emit=None, **_) -> dict:
    _metered("scans")
    run_id = await gap.run(GapRadarRequest(query=query, max_papers=max(100, min(int(max_papers), 800))), _QuietCtx(emit))
    _own("gap_run", run_id)
    r = get_store().get("gap_run", run_id)
    clusters = [{"cluster_id": c["cluster_id"], "label": c["label"], "class": c["classification"], "size": c["size"],
                 "growth": round(c["growth"], 2), "cites_per_year": c["cites_per_year"]} for c in r["clusters"]]
    return {"summary": f"{r['n_papers']} papers → {len(clusters)} clusters for “{query}”",
            "data": {"run_id": run_id, "clusters": clusters},
            "link": {"tab": "explore", "gap": run_id}}


async def research_questions(run_id: str, cluster_id: int, **_) -> dict:
    res = await gapq.generate(run_id, int(cluster_id))
    return {"summary": f"{len(res.questions)} grounded questions",
            "data": [{"question": q.text, "rationale": q.rationale, "evidence": [p.title for p in q.evidence]} for q in res.questions],
            "link": {"tab": "explore", "gap": run_id}}


async def save_note(title: str, markdown: str, template: str = "ieee", **_) -> dict:
    """Create a rich Markdown/LaTeX/Mermaid research note or paper outline in the user's Workspace Pages."""
    t = str(title or "Research Note").strip()[:120] or "Research Note"
    md = str(markdown or "").strip()
    if not md:
        raise ToolError("markdown content cannot be empty")
    tpl = template if template in ("ieee", "springer", "plain") else "ieee"
    store = get_store()
    cur = (store.get("workspace", _ws("pages")) or {}).get("items", [])
    pid = uuid.uuid4().hex[:8]
    page = {"id": pid, "title": t, "md": md, "template": tpl, "updated": int(time.time() * 1000), "emoji": "🧪"}
    store.put("workspace", _ws("pages"), {"items": [page, *cur[:99]]})
    return {
        "summary": f"Saved note “{t}” ({len(md.split())} words, {tpl.upper()} template) to Workspace → Pages",
        "data": {"note_id": pid, "title": t, "template": tpl},
        "link": {"tab": "notes", "notesView": "pages", "noteId": pid},
    }


async def pin_stickies(ideas: list[str] | str, **_) -> dict:
    """Pin 1–6 brainstormed sticky cards onto the user's Workspace Sticky Board."""
    if isinstance(ideas, str):
        ideas = [x.strip("-• \t") for x in ideas.splitlines() if x.strip()]
    clean = [str(x).strip()[:220] for x in ideas if str(x).strip()][:6]
    if not clean:
        raise ToolError("provide 1-6 sticky note texts")
    store = get_store()
    cur = (store.get("workspace", _ws("stickies")) or {}).get("items", [])
    base = len(cur)
    added = []
    for idx, txt in enumerate(clean):
        col, row = (base + idx) % 3, ((base + idx) // 3) % 3
        added.append({
            "id": uuid.uuid4().hex[:8],
            "text": txt,
            "color": STICKY_COLORS[(base + idx) % len(STICKY_COLORS)],
            "x": 36 + col * 235,
            "y": 36 + row * 175,
            "rot": [-3, 2, -1, 3, -2, 1][(base + idx) % 6],
        })
    store.put("workspace", _ws("stickies"), {"items": [*cur[:60], *added]})
    return {
        "summary": f"Pinned {len(added)} brainstorm sticky card(s) to Workspace → Sticky board",
        "data": {"pinned": clean},
        "link": {"tab": "notes", "notesView": "stickies"},
    }


async def add_todos(tasks: list[str] | str, priority: str = "med", **_) -> dict:
    """Add 1–10 concrete experiment or revision tasks to the user's Workspace To-do list."""
    if isinstance(tasks, str):
        tasks = [x.strip("-•[] \t") for x in tasks.splitlines() if x.strip()]
    clean = [str(x).strip()[:240] for x in tasks if str(x).strip()][:10]
    if not clean:
        raise ToolError("provide 1-10 tasks")
    prio = priority if priority in ("low", "med", "high") else "med"
    store = get_store()
    cur = (store.get("workspace", _ws("todos")) or {}).get("items", [])
    added = [{"id": uuid.uuid4().hex[:8], "text": t, "done": False, "prio": prio} for t in clean]
    store.put("workspace", _ws("todos"), {"items": [*added, *cur[:150]]})
    return {
        "summary": f"Added {len(added)} {prio}-priority task(s) to Workspace → To-dos",
        "data": {"added": clean, "priority": prio},
        "link": {"tab": "notes", "notesView": "todos"},
    }


TOOLS: dict[str, Tool] = {t.name: t for t in [
    Tool("search_papers", "Find real papers on a topic (OpenAlex): titles, years, venues, citations, abstracts.",
         {"query": "topic or keywords", "limit": "1-10, default 6"}, search_papers),
    Tool("trend_experiment", "Experiment: count publications per year for 1-4 exact phrases (title/abstract) to measure and compare momentum. Returns an animated line chart.",
         {"phrases": "list of 1-4 phrases, e.g. [\"LoRA\", \"QLoRA\", \"DoRA\"]", "from_year": "default 2016"}, trend_experiment),
    Tool("venue_fit_experiment", "Experiment: sample 40 related OpenAlex works to rank peer-reviewed target venues, open-access share and median citations. Returns a bar chart.",
         {"query": "paper title, abstract snippet, or research topic"}, venue_fit_experiment),
    Tool("text_integrity_test", "Experiment: scan a paragraph/abstract against CiteGuard's tortured-phrase list, inline citation density and overclaim vs empirical calibration signals.",
         {"text": "draft paragraph or abstract to test"}, text_integrity_test),
    Tool("check_citation", "Test whether a citation string really exists (Crossref, arXiv, Semantic Scholar, OpenAlex) and whether it is retracted.",
         {"citation": "the full reference text, e.g. 'Vaswani et al. Attention is all you need. NeurIPS 2017'"}, check_citation),
    Tool("check_retraction", "Check a DOI for retraction / correction / expression-of-concern notices (Crossref incl. Retraction Watch).",
         {"doi": "e.g. 10.1155/2022/4989248"}, check_retraction),
    Tool("test_claim", "Test whether a specific paper's abstract supports a claim (semantic similarity + AI judgment).",
         {"claim": "the sentence to test", "doi": "DOI of the paper being cited"}, test_claim),
    Tool("list_papers", "List papers already uploaded to the app (document_id, title, reference count).", {}, list_papers),
    Tool("audit_paper", "Run a full CiteGuard integrity audit on an uploaded paper (~1 min).",
         {"document_id": "from list_papers"}, audit_paper, slow=True),
    Tool("review_paper", "Run the reviewer jury + Go/No-Go verdict on an uploaded paper (uses its latest audit).",
         {"document_id": "from list_papers", "venue": "optional target venue"}, review_paper, slow=True),
    Tool("scan_field", "Run a Gap Radar scan of a research field: clusters recent papers and classifies Rising/Saturated/Underexplored (~1-2 min).",
         {"query": "field", "max_papers": "100-800, default 300"}, scan_field, slow=True),
    Tool("research_questions", "Generate 3 research questions grounded in real papers for a cluster from a scan.",
         {"run_id": "from scan_field", "cluster_id": "cluster id from scan_field"}, research_questions),
    Tool("save_note", "Workspace action: create a formatted Markdown/LaTeX/Mermaid research note, experiment plan or paper outline in Notes -> Pages.",
         {"title": "page title", "markdown": "full Markdown content (supports $$math$$ and ```mermaid```)", "template": "ieee | springer | plain"}, save_note),
    Tool("pin_stickies", "Workspace action: pin 1-6 brainstormed ideas onto the user's Sticky Board.",
         {"ideas": "list of 1-6 concise idea strings"}, pin_stickies),
    Tool("add_todos", "Workspace action: add 1-10 concrete experiment or revision checklist tasks to Workspace -> To-dos.",
         {"tasks": "list of 1-10 actionable task strings", "priority": "high | med | low"}, add_todos),
]}


def describe() -> str:
    lines = []
    for t in TOOLS.values():
        args = ", ".join(f"{k}: {v}" for k, v in t.args.items()) or "none"
        lines.append(f"- {t.name}({args}): {t.description}")
    return "\n".join(lines)
