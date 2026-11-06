"""Submission kit: everything you send with a paper, built from the paper itself.

- Cover letter, significance statement and declarations: written by the model from the paper's own title, abstract and
  contributions. Anything only the author knows (editor's name, funding, prior posting) is left as a [bracketed] placeholder.
- Pre-submission checklist: computed from the manuscript (abstract length, keywords, references, captions, pending results,
  AI disclosure, integrity report). No model involved.
- Reviewer candidates: authors of works the paper cites (real people, real papers), never invented names.
- Response-to-reviewers template: a fixed, standard structure.
"""
from __future__ import annotations

import re
from collections import Counter

from pydantic import BaseModel

from backend.cache.store import get_store, now
from backend.llm import client as llm


class KitRequest(BaseModel):
    venue: str = ""
    venue_type: str = "journal"        # journal | conference
    author: str = ""
    affiliation: str = ""
    corresponding_email: str = ""


class _Kit(BaseModel):
    cover_letter: str
    significance: str
    data_availability: str
    conflicts: str
    funding: str


RESPONSE_TEMPLATE = """# Response to Reviewers

**Manuscript:** {title}

We thank the editor and reviewers for their time and constructive comments. Our responses are below; changes in the
manuscript are highlighted.

## Reviewer 1

**Comment 1.1:** [Paste the reviewer's comment.]

**Response:** [Explain what you changed, or why you respectfully disagree, with evidence.]

**Change in manuscript:** [Section / page / line.]

## Reviewer 2

**Comment 2.1:** [Paste the reviewer's comment.]

**Response:** [...]

**Change in manuscript:** [...]
"""


def _section(md: str, name: str) -> str:
    m = re.search(rf"(?ms)^# {re.escape(name)}\s*\n(.*?)(?=^# |\Z)", md)
    return m.group(1).strip() if m else ""


def checklist(paper: dict, template: str) -> list[dict]:
    from backend.paper_studio.studio import ensure_keywords
    md = ensure_keywords(paper.get("markdown", ""), paper.get("keywords") or [])
    out: list[dict] = []

    def add(item: str, ok: bool | None, detail: str) -> None:
        out.append({"item": item, "status": "pass" if ok else ("warn" if ok is False else "todo"), "detail": detail})

    abstract = re.sub(r"\*\*Keywords:\*\*.*", "", _section(md, "Abstract"), flags=re.S).strip()
    aw = len(abstract.split())
    add("Abstract length", 150 <= aw <= 250, f"{aw} words (IEEE and Springer LNCS ask for about 150–250).")
    kw = re.search(r"\*\*Keywords:\*\*\s*(.+)", md)
    nk = len([k for k in (kw.group(1).split(",") if kw else []) if k.strip()])
    add("Keywords", 3 <= nk <= 6, f"{nk} keywords (most venues want 3–6).")
    refs = paper.get("references") or []
    linked = sum(1 for r in refs if r.get("url") or r.get("doi"))
    add("References", len(refs) >= 15 and linked == len(refs), f"{len(refs)} references, {linked} with a DOI or link.")
    figs = len(re.findall(r"!\[", md)) + len(re.findall(r"```mermaid", md))
    caps = len(re.findall(r"(?m)^Figure:", md))
    add("Figure captions", figs > 0 and caps >= figs, f"{figs} figures/diagrams, {caps} captions.")
    tables = len(re.findall(r"(?m)^\|.*\|\s*\n\|[\s:|-]+\|", md))
    tcaps = len(re.findall(r"(?m)^Table:", md))
    add("Table captions", tables == 0 or tcaps >= tables, f"{tables} tables, {tcaps} captions.")
    pending = md.count("to be measured")
    add("Experimental results", pending == 0,
        "No pending result cells." if pending == 0 else
        f"{pending} result cells still say “to be measured”. Run the planned experiments and add your measured numbers before submitting.")
    ack = _section(md, "Acknowledgment")
    add("AI-use disclosure", "AI" in ack, "Acknowledgment discloses AI assistance." if "AI" in ack else
        "Add an AI-assistance statement if the venue requires one (most do).")
    rep = paper.get("report") or {}
    readiness = rep.get("publication_readiness") or {}
    add("Publication-readiness gate", readiness.get("ready") is True,
        "No automated publication blockers remain." if readiness.get("ready") is True else
        "; ".join(readiness.get("blockers") or ["Run the remaining manual checks before submission."]))
    add("Originality check", not rep.get("verbatim_paragraphs_after"), f"{rep.get('verbatim_paragraphs_after', 0)} paragraph(s) with copied text from cited abstracts.")
    add("Unmeasured claims", not rep.get("unmeasured_claims_remaining"), f"{rep.get('unmeasured_claims_remaining', 0)} sentence(s) flagged.")
    words = paper.get("words") or len(md.split())
    per_page = 900 if template == "ieee" else 600
    add("Length estimate", None, f"≈{max(1, round(words / per_page))} pages in the {template.upper()} template. Check the venue's page limit.")
    add("Author details & ORCID", None, "Add every author, affiliation and ORCID iD in the venue's submission system.")
    add("Institutional check", None, "Run your institution's similarity check and confirm the venue's AI and authorship policy.")
    return out


def reviewer_candidates(refs: list[dict], limit: int = 6) -> list[dict]:
    seen: Counter = Counter()
    out = []
    for r in sorted(refs, key=lambda x: -(x.get("cited_by") or 0)):
        authors = [a for a in (r.get("authors") or []) if a]
        for a in authors[:1] + authors[-1:]:   # first and senior author
            if seen[a] or len(out) >= limit:
                continue
            seen[a] += 1
            out.append({"name": a, "paper": r.get("title"), "year": r.get("year"),
                        "url": f"https://doi.org/{r['doi']}" if r.get("doi") else r.get("url")})
    return out


async def build(pid: str, req: KitRequest) -> dict:
    store = get_store()
    paper = store.get("paper_studio", pid)
    if not paper:
        raise ValueError("paper not found")
    md = paper["markdown"]
    abstract = re.sub(r"\*\*Keywords:\*\*.*", "", _section(md, "Abstract"), flags=re.S).strip()
    venue = req.venue.strip() or "[Target journal or conference]"
    addressee = "Dear Program Committee Chairs" if req.venue_type == "conference" else "Dear Editor"
    out = await llm.complete_json(
        "You write submission documents for academic papers. Formal, concise, honest. Use only facts from the paper "
        "provided; never invent results, numbers, funding, affiliations or prior publication history. Put anything only the "
        "author can confirm in [square brackets]. No mention of how the text was produced.",
        f"PAPER TITLE: {paper['title']}\nVENUE: {venue} ({req.venue_type})\nAUTHOR: {req.author or '[Author]'}, "
        f"{req.affiliation or '[Affiliation]'}\nCONTRIBUTIONS: {paper.get('contributions')}\nABSTRACT: {abstract}\n\n"
        f"Write: (1) a cover letter in Markdown starting with '{addressee},' (250–350 words: what the paper does, why it fits "
        f"{venue}, the contributions, a statement that the work is original and not under review elsewhere [author to "
        "confirm], and a sign-off with the author's name); (2) a 2–3 sentence significance statement for non-specialists; "
        "(3) a data-availability statement (the bibliometric data come from OpenAlex; anything else is a placeholder); "
        "(4) a conflict-of-interest statement placeholder; (5) a funding statement placeholder.",
        _Kit, effort="medium")
    kit = {
        "venue": venue, "venue_type": req.venue_type, "created_at": now().isoformat(),
        "cover_letter": out.cover_letter.strip(), "significance": out.significance.strip(),
        "data_availability": out.data_availability.strip(), "conflicts": out.conflicts.strip(), "funding": out.funding.strip(),
        "ai_disclosure": ("The authors used AI-assisted writing tools to draft parts of this manuscript and verified all "
                          "content, references and figures. [Edit to match the venue's required wording.]"),
        "highlights": paper.get("highlights") or [],
        "keywords": paper.get("keywords") or [],
        "checklist": checklist(paper, paper.get("template", "ieee")),
        "reviewers": reviewer_candidates(paper.get("_refs") or []),
        "response_template": RESPONSE_TEMPLATE.format(title=paper["title"]),
    }
    paper["kit"] = kit
    store.put("paper_studio", pid, paper)
    return kit
