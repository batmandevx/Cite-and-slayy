"""Journal / conference finder: where do papers most like yours get published? (OpenAlex, last 6 years.)

Ranking is data-driven: how many of the most similar recent works each venue published, weighted by how similar they
are (sentence embeddings). Venue facts (type, publisher, open access, DOAJ listing, APC, h-index, 2-year mean
citedness) come from OpenAlex source records. 2-year mean citedness is OpenAlex's measure, not the official Impact Factor.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date

import numpy as np

from backend.embeddings.model import embed_async
from backend.sources import openalex
from backend.sources.http import SourceError

SRC_SELECT = "id,display_name,type,host_organization_name,homepage_url,is_oa,is_in_doaj,apc_usd,summary_stats,works_count"
SKIP = {"repository", "ebook platform", "book series"}


async def find(title: str, abstract: str = "", kind: str = "any", oa_only: bool = False, limit: int = 12) -> dict:
    text = f"{title}. {abstract}".strip()
    if len(text) < 15:
        return {"venues": [], "note": "Give a title or a few sentences about the paper."}
    since = f"{date.today().year - 6}-01-01"
    works: dict[str, dict] = {}
    queries = [title[:250]] + ([abstract[:300]] if abstract else [])
    for q in queries:
        try:
            f = await openalex.client().get(f"{openalex.BASE}/works", {
                "search": q, "filter": f"from_publication_date:{since},type:article|proceedings-article|review",
                "per-page": 50, "select": openalex.SELECT})
        except SourceError as e:
            if not works:
                return {"venues": [], "note": f"Couldn't reach OpenAlex: {e.reason}"}
            continue
        for w in (f.data or {}).get("results", []):
            works.setdefault(w["id"], w)
    if not works:
        return {"venues": [], "note": "No similar recent papers found. Try a more general title."}
    ws = list(works.values())
    qv = await embed_async([text[:2000]])
    wv = await embed_async([f"{w.get('title') or ''}. {(openalex.reconstruct_abstract(w.get('abstract_inverted_index')) or '')[:600]}" for w in ws])
    sims = (wv @ qv.T).ravel()
    groups: dict[str, dict] = defaultdict(lambda: {"score": 0.0, "n": 0, "examples": [], "name": ""})
    for w, sim in zip(ws, sims):
        src = ((w.get("primary_location") or {}).get("source")) or {}
        sid = (src.get("id") or "").replace("https://openalex.org/", "")
        if not sid or src.get("type") in SKIP:
            continue
        g = groups[sid]
        g["name"] = src.get("display_name") or sid
        g["n"] += 1
        g["score"] += max(0.0, float(sim))
        if len(g["examples"]) < 3:
            g["examples"].append({"title": w.get("title"), "year": w.get("publication_year"),
                                  "url": w.get("doi") or w.get("id"), "similarity": round(float(sim), 2)})
    top = sorted(groups.items(), key=lambda kv: -kv[1]["score"])[:30]
    if not top:
        return {"venues": [], "note": "Similar papers were mostly preprints; no journal or conference venues found."}
    meta: dict[str, dict] = {}
    try:
        f = await openalex.client().get(f"{openalex.BASE}/sources", {
            "filter": "openalex:" + "|".join(sid for sid, _ in top), "per-page": 50, "select": SRC_SELECT})
        meta = {r["id"].replace("https://openalex.org/", ""): r for r in (f.data or {}).get("results", [])}
    except SourceError:
        pass
    best = max(g["score"] for _, g in top) or 1.0
    out = []
    for sid, g in top:
        m = meta.get(sid, {})
        vtype = m.get("type") or "unknown"
        if kind == "journal" and vtype != "journal":
            continue
        if kind == "conference" and vtype != "conference":
            continue
        if oa_only and not m.get("is_oa"):
            continue
        stats = m.get("summary_stats") or {}
        out.append({
            "id": sid, "name": g["name"], "type": vtype, "publisher": m.get("host_organization_name"),
            "homepage": m.get("homepage_url"), "openalex_url": f"https://openalex.org/{sid}",
            "is_oa": m.get("is_oa"), "in_doaj": m.get("is_in_doaj"), "apc_usd": m.get("apc_usd"),
            "h_index": stats.get("h_index"), "mean_citedness_2yr": round(stats["2yr_mean_citedness"], 2) if stats.get("2yr_mean_citedness") else None,
            "works_count": m.get("works_count"), "similar_papers": g["n"], "fit": round(100 * g["score"] / best),
            "examples": g["examples"],
        })
        if len(out) >= limit:
            break
    return {"venues": out, "searched": len(ws), "since": since[:4],
            "note": "Always read the venue's scope and author guidelines. Check unfamiliar journals with Think. Check. Submit."}
