"""Journal & conference finder: where do papers most like yours get published? (OpenAlex, last 6 years.)

Ranking is data-driven: how many of the most similar recent works each venue published, weighted by semantic/lexical
similarity to your title and abstract. Venue facts (type, publisher, open access, DOAJ listing, APC, h-index, 2-year
mean citedness) come directly from OpenAlex source records.
"""
from __future__ import annotations

import asyncio
import re
from collections import defaultdict
from datetime import date

from rapidfuzz import fuzz

from backend.embeddings.model import embed_async
from backend.sources import doaj, openalex, wikicfp
from backend.sources.http import SourceError

LIVE = 24 * 3600            # venue data is refreshed daily; calls for papers every few hours (see wikicfp.search)

SRC_SELECT = "id,display_name,type,host_organization_name,homepage_url,is_oa,is_in_doaj,apc_usd,summary_stats,works_count,issn_l,issn"
SKIP = {"repository", "ebook platform"}
PREPRINT_NAMES = ("arxiv", "biorxiv", "medrxiv", "chemrxiv", "ssrn", "zenodo", "research square", "osf preprints", "hal", "techrxiv")

# Common academic filler words that add noise or over-constrain OpenAlex AND queries
_STOP = {
    "the", "and", "for", "with", "that", "this", "from", "into", "over", "under", "using", "based", "via", "through",
    "paper", "study", "propose", "proposed", "proposes", "present", "presents", "method", "methods", "approach",
    "framework", "system", "systems", "model", "models", "show", "shows", "results", "experimental", "analysis",
    "novel", "new", "across", "between", "within", "such", "their", "which", "while", "where", "when", "towards",
    "toward", "bridging", "beyond", "autonomous", "adaptive", "aware", "bounded", "multi", "end", "low", "high",
    "time", "critical", "contemporary", "increasingly", "deploy", "retain", "every", "eliminating", "comprises",
    "replacing", "explicit", "general", "effective", "efficient", "robust", "scalable", "unified", "improved",
}

# Preserve standard technical acronyms while dropping coined ALL-CAPS paper names (e.g. ADITI, ALIZA)
_KNOWN_ACRONYMS = {
    "AI", "ML", "DL", "RL", "NLP", "LLM", "LLMS", "VLM", "GNN", "CNN", "RNN", "GAN", "VAE", "RAG", "MOE",
    "GPU", "GPUS", "CPU", "CPUS", "TPU", "FPGA", "ASIC", "DMA", "PCIE", "CUDA", "RTOS", "IOT", "SLAM", "UAV", "ROS",
    "EHR", "ICU", "ECG", "EEG", "MRI", "CT", "DNA", "RNA", "CRISPR", "API", "SQL", "TLS", "AES", "ZKP", "TEE", "SGX",
    "MDP", "POMDP", "PDE", "ODE", "SDE", "SAT", "SMT", "QAOA", "VQE", "5G", "6G", "OFDM", "MIMO",
}


def _extract_tokens(text: str, *, drop_coined: bool = True, max_tokens: int = 24) -> list[str]:
    """Extract clean searchable domain tokens (splitting hyphens, stripping LaTeX & coined CamelCase names)."""
    s = re.sub(r"\$\$[\s\S]*?\$\$|\$[^$]*\$", " ", text or "")
    s = re.sub(r"\\[A-Za-z]+", " ", s)
    s = re.sub(r"https?://\S+", " ", s)
    # Split hyphens/slashes into spaces so compounds like GPU-Resident -> GPU Resident
    raw_words = re.findall(r"[A-Za-z][A-Za-z0-9]{1,28}", s)
    out: list[str] = []
    seen: set[str] = set()
    for w in raw_words:
        wl = w.lower()
        if wl in _STOP or wl in seen:
            continue
        if len(w) < 3 and w.upper() not in _KNOWN_ACRONYMS:
            continue
        if drop_coined:
            # Drop CamelCase coined names like ResidentLoop, AutoClaw, VeriLab (keep PCIe -> pcie in _KNOWN_ACRONYMS)
            if re.search(r"[a-z][A-Z]", w) and w.upper() not in _KNOWN_ACRONYMS:
                continue
        seen.add(wl)
        out.append(w)
        if len(out) >= max_tokens:
            break
    return out


def build_search_queries(title: str, abstract: str = "") -> list[str]:
    """Build 1-3 resilient OpenAlex search queries that handle coined names, colons, hyphens, and cross-domain titles."""
    raw_title = (title or "").strip()
    raw_abs = (abstract or "").strip()

    # If title starts with a short coined name before ':' (e.g. "ResidentLoop: Hardware-Software..."), prioritize subtitle
    ordered_title = raw_title
    if ":" in raw_title:
        prefix, rest = raw_title.split(":", 1)
        pw = prefix.strip().split()
        if 1 <= len(pw) <= 2 and rest.strip():
            # Put subtitle first; only keep prefix words if they are known acronyms or normal lowercase/title words
            ordered_title = rest.strip()
            if len(pw) == 1 and pw[0].upper() in _KNOWN_ACRONYMS:
                ordered_title = f"{pw[0]} {rest.strip()}"
        elif rest.strip():
            ordered_title = f"{rest.strip()} {prefix.strip()}"

    t_toks = _extract_tokens(ordered_title, drop_coined=True, max_tokens=14)
    if not t_toks:
        t_toks = _extract_tokens(raw_title, drop_coined=False, max_tokens=10)
    a_toks = [w for w in _extract_tokens(raw_abs, drop_coined=True, max_tokens=18)
              if w.lower() not in {x.lower() for x in t_toks}]

    queries: list[str] = []

    # 1) Focused technical query (up to 4 core tokens if short/standard, else bigram OR for long titles)
    if 1 <= len(t_toks) <= 4:
        queries.append(" ".join(t_toks))
    elif len(t_toks) >= 5:
        queries.append(" ".join(t_toks[:4]))

    # 2) Pairwise phrase OR query across the title tokens: high recall even for multi-aspect systems papers
    if len(t_toks) >= 3:
        pairs = [" ".join(t_toks[i:i + 2]) for i in range(0, min(len(t_toks), 10), 2)]
        or_q = " OR ".join(f'"{p}"' if " " in p else p for p in pairs if p)
        if or_q and or_q not in queries:
            queries.append(or_q)
    elif len(t_toks) == 2:
        or_q = f"{t_toks[0]} OR {t_toks[1]}"
        if or_q not in queries:
            queries.append(or_q)

    # 3) Abstract technical-term OR query: captures concrete domain mechanisms (e.g., neural networks, DMA, scheduler)
    if len(a_toks) >= 2:
        apairs = [" ".join(a_toks[i:i + 2]) for i in range(0, min(len(a_toks), 8), 2)]
        abs_q = " OR ".join(f'"{p}"' if " " in p else p for p in apairs if p)
        if abs_q and abs_q not in queries:
            queries.append(abs_q)

    if not queries and raw_title:
        queries.append(re.sub(r"[^A-Za-z0-9\s]", " ", raw_title).strip()[:120])

    return queries[:3]


async def _similarity_scores(query_text: str, doc_texts: list[str]) -> list[float]:
    if not doc_texts:
        return []
    try:
        vecs = await embed_async([query_text[:1800]] + [d[:650] for d in doc_texts])
        qv, wv = vecs[0:1], vecs[1:]
        sims = (wv @ qv.T).ravel()
        return [max(0.02, float(x)) for x in sims]
    except Exception:
        return [max(0.02, fuzz.token_set_ratio(query_text[:600], d[:600]) / 100.0) for d in doc_texts]


async def find(title: str, abstract: str = "", kind: str = "any", oa_only: bool = False, limit: int = 12) -> dict:
    raw_title = (title or "").strip()
    raw_abs = (abstract or "").strip()
    text = f"{raw_title}. {raw_abs}".strip(". ")
    if len(text) < 3:
        return {"venues": [], "note": "Enter a paper title, topic, or a few keywords to match venues."}

    since = f"{date.today().year - 6}-01-01"
    queries = build_search_queries(raw_title, raw_abs)

    flt_parts = [f"from_publication_date:{since}"]
    if kind == "journal":
        flt_parts.append("primary_location.source.type:journal")
    elif kind == "conference":
        flt_parts.append("primary_location.source.type:conference|book series")
    else:
        flt_parts.append("primary_location.source.type:journal|conference|book series")
    if oa_only:
        flt_parts.append("primary_location.source.is_oa:true")
    flt = ",".join(flt_parts)

    async def _fetch_query(q: str):
        try:
            f = await openalex.client().get(f"{openalex.BASE}/works", {
                "search": q, "filter": flt, "per-page": 50, "select": openalex.SELECT,
            }, max_age=LIVE)
            return (f.data or {}).get("results", []), None
        except SourceError as e:
            return [], e.reason

    calls_task = asyncio.create_task(calls_for_papers(raw_title, raw_abs)) if kind != "journal" else None
    batches = await asyncio.gather(*[_fetch_query(q) for q in queries])
    works: dict[str, dict] = {}
    last_err: str | None = None
    for rows, err in batches:
        if err:
            last_err = err
        for w in rows:
            if w.get("id"):
                works.setdefault(w["id"], w)

    # Broad single-token OR fallback if every phrase query returned 0 works (e.g. brand-new compound jargon)
    if not works:
        broad_toks = _extract_tokens(f"{raw_title} {raw_abs}", drop_coined=True, max_tokens=7)
        if broad_toks:
            rows, err = await _fetch_query(" OR ".join(broad_toks))
            if err:
                last_err = err
            for w in rows:
                if w.get("id"):
                    works.setdefault(w["id"], w)

    if not works and last_err:
        return {"venues": [], "calls": await _await_calls(calls_task), "checked_at": _now(),
                "note": f"Couldn't reach OpenAlex right now ({last_err}). Try again in a moment."}

    ws = list(works.values())
    doc_texts = [
        f"{w.get('title') or ''}. {(openalex.reconstruct_abstract(w.get('abstract_inverted_index')) or '')[:550]}"
        for w in ws
    ]
    sims = await _similarity_scores(text, doc_texts)

    # Keep candidates with meaningful semantic alignment (or top 40 closest works if topic is broad)
    ranked_pairs = sorted(zip(ws, sims), key=lambda pair: -pair[1])
    top_sim = ranked_pairs[0][1] if ranked_pairs else 0.0
    cutoff = max(0.22, top_sim * 0.52)
    filtered_pairs = [(w, s) for w, s in ranked_pairs if s >= cutoff]
    if len(filtered_pairs) < min(18, len(ranked_pairs)):
        filtered_pairs = ranked_pairs[:min(40, len(ranked_pairs))]

    groups: dict[str, dict] = defaultdict(lambda: {"score": 0.0, "n": 0, "examples": [], "name": "", "src_fallback": {}})
    for w, sim in filtered_pairs:
        src = ((w.get("primary_location") or {}).get("source")) or {}
        sid = (src.get("id") or "").replace("https://openalex.org/", "")
        stype = (src.get("type") or "").lower()
        dname = (src.get("display_name") or "").strip()
        if not sid or stype in SKIP:
            continue
        if any(rep in dname.lower() for rep in PREPRINT_NAMES):
            continue
        if kind == "conference" and stype == "book series":
            if not any(k in dname.lower() for k in ("lecture notes", "proceedings", "conference", "symposium", "workshop", "advances")):
                continue
        g = groups[sid]
        g["name"] = dname or g["name"] or sid
        g["src_fallback"] = src
        g["n"] += 1
        # Weight strongly by semantic similarity so truly on-topic papers dominate over loose OR matches
        g["score"] += max(0.02, float(sim) ** 2)
        if len(g["examples"]) < 3 and w.get("title"):
            g["examples"].append({
                "title": w.get("title"),
                "year": w.get("publication_year"),
                "url": w.get("doi") or w.get("id"),
                "similarity": round(float(sim), 2),
            })

    top = sorted(groups.items(), key=lambda kv: -kv[1]["score"])[:30]
    meta: dict[str, dict] = {}
    if top:
        try:
            f = await openalex.client().get(f"{openalex.BASE}/sources", {
                "filter": "ids.openalex:" + "|".join(sid for sid, _ in top),
                "per-page": 50,
                "select": SRC_SELECT,
            }, max_age=LIVE)
            meta = {r["id"].replace("https://openalex.org/", ""): r for r in (f.data or {}).get("results", []) if r.get("id")}
        except SourceError:
            meta = {}

    best = max((g["score"] for _, g in top), default=1.0) or 1.0
    out: list[dict] = []
    seen_ids: set[str] = set()
    for sid, g in top:
        m = meta.get(sid) or g.get("src_fallback") or {}
        raw_vtype = (m.get("type") or (g.get("src_fallback") or {}).get("type") or "journal").lower()
        vtype = "conference" if (kind == "conference" and raw_vtype == "book series") else raw_vtype
        if kind == "journal" and vtype != "journal":
            continue
        if kind == "conference" and vtype != "conference":
            continue
        is_oa = m.get("is_oa") if m.get("is_oa") is not None else (g.get("src_fallback") or {}).get("is_oa")
        if oa_only and not is_oa:
            continue
        stats = m.get("summary_stats") or {}
        seen_ids.add(sid)
        out.append({
            "id": sid,
            "name": m.get("display_name") or g["name"],
            "type": vtype,
            "publisher": m.get("host_organization_name") or (g.get("src_fallback") or {}).get("host_organization_name"),
            "homepage": m.get("homepage_url") or (g.get("src_fallback") or {}).get("homepage_url"),
            "openalex_url": f"https://openalex.org/{sid}",
            "is_oa": is_oa,
            "in_doaj": m.get("is_in_doaj"),
            "apc_usd": m.get("apc_usd"),
            "h_index": stats.get("h_index"),
            "mean_citedness_2yr": round(stats["2yr_mean_citedness"], 2) if stats.get("2yr_mean_citedness") else None,
            "works_count": m.get("works_count"),
            "issn": m.get("issn_l") or (m.get("issn") or [None])[0],
            "similar_papers": g["n"],
            "fit": max(20, min(100, round(100 * (g["score"] / best) ** 0.65))),
            "examples": g["examples"],
        })
        if len(out) >= limit:
            break

    # Supplementary direct venue search if fewer than 4 venues matched (e.g. user typed "IEEE Transactions" or "NeurIPS")
    if len(out) < 4:
        src_flt = []
        if kind in ("journal", "conference"):
            src_flt.append(f"type:{kind}")
        else:
            src_flt.append("type:journal|conference")
        if oa_only:
            src_flt.append("is_oa:true")
        src_q = " ".join(_extract_tokens(raw_title, drop_coined=False, max_tokens=5)) or raw_title[:80]
        try:
            sf = await openalex.client().get(f"{openalex.BASE}/sources", {
                "search": src_q,
                "filter": ",".join(src_flt),
                "per-page": 12,
                "select": SRC_SELECT,
            }, max_age=LIVE)
            for r in (sf.data or {}).get("results", []):
                sid = (r.get("id") or "").replace("https://openalex.org/", "")
                dname = (r.get("display_name") or "").strip()
                if not sid or sid in seen_ids or any(rep in dname.lower() for rep in PREPRINT_NAMES):
                    continue
                seen_ids.add(sid)
                stats = r.get("summary_stats") or {}
                out.append({
                    "id": sid,
                    "name": dname or sid,
                    "type": r.get("type") or (kind if kind != "any" else "journal"),
                    "publisher": r.get("host_organization_name"),
                    "homepage": r.get("homepage_url"),
                    "openalex_url": f"https://openalex.org/{sid}",
                    "is_oa": r.get("is_oa"),
                    "in_doaj": r.get("is_in_doaj"),
                    "apc_usd": r.get("apc_usd"),
                    "h_index": stats.get("h_index"),
                    "mean_citedness_2yr": round(stats["2yr_mean_citedness"], 2) if stats.get("2yr_mean_citedness") else None,
                    "works_count": r.get("works_count"),
                    "issn": r.get("issn_l") or (r.get("issn") or [None])[0],
                    "similar_papers": 0,
                    "fit": 55,
                    "examples": [],
                })
                if len(out) >= limit:
                    break
        except SourceError:
            pass

    calls = await _await_calls(calls_task)
    if not out:
        return {"venues": [], "calls": calls, "searched": len(ws), "since": since[:4], "checked_at": _now(),
                "note": "No matching peer-reviewed venues found for those filters. Try switching to 'All venues' or broadening the title."}

    try:
        await asyncio.wait_for(_enrich(out), timeout=15)   # live extras must never stall the results
    except asyncio.TimeoutError:
        pass
    return {
        "venues": out,
        "calls": calls,
        "checked_at": _now(),
        "searched": len(ws),
        "since": since[:4],
        "note": "Always verify the venue's scope, deadlines, and author guidelines. Vet unfamiliar journals with Think. Check. Submit.",
    }


# ---------------------------------------------------------------- live data

def _now() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


async def _await_calls(task: asyncio.Task | None) -> list[dict]:
    if task is None:
        return []
    try:
        return await asyncio.wait_for(task, timeout=25)
    except Exception:  # noqa: BLE001 - calls for papers are a bonus; never fail or stall the venue search for them
        return []


async def _enrich(venues: list[dict]) -> None:
    """Add live facts: papers published in the last 12 months (OpenAlex) and, for DOAJ journals, time to publication and APC."""
    from datetime import timedelta
    ids = [v["id"] for v in venues if v.get("id", "").startswith("S")]
    year_ago = (date.today() - timedelta(days=365)).isoformat()

    async def recent() -> dict[str, int]:
        if not ids:
            return {}
        try:
            f = await openalex.client().get(f"{openalex.BASE}/works", {
                "filter": f"primary_location.source.id:{'|'.join(ids)},from_publication_date:{year_ago}",
                "group_by": "primary_location.source.id"}, max_age=LIVE)
        except SourceError:
            return {}
        return {(g.get("key") or "").replace("https://openalex.org/", ""): g.get("count", 0) for g in (f.data or {}).get("group_by", [])}

    async def doaj_facts(v: dict) -> None:
        if not (v.get("in_doaj") and v.get("issn")):
            return
        try:
            v["doaj"] = await doaj.journal(v["issn"])
        except SourceError:
            pass

    counts, *_ = await asyncio.gather(recent(), *[doaj_facts(v) for v in venues[:12]])
    for v in venues:
        n = counts.get(v["id"])
        if n is not None:
            v["papers_last_12m"] = n
            v["activity"] = "very active" if n >= 300 else "active" if n >= 30 else "quiet" if n > 0 else "no recent papers"
        # Honest quality hint: huge output with almost no citations is a common sign of a mass-publishing venue.
        cites, h = v.get("mean_citedness_2yr"), v.get("h_index")
        if (n or 0) >= 1500 and (cites is None or cites < 0.6) or (h is not None and h < 8 and (v.get("works_count") or 0) > 2000):
            v["caution"] = "Very high volume with few citations: check its indexing and peer review before submitting."
    venues.sort(key=lambda v: bool(v.get("caution")))       # stable: keeps fit order, cautioned venues last


def _cfp_queries(title: str, abstract: str) -> list[str]:
    toks = _extract_tokens(title, drop_coined=True, max_tokens=8) or _extract_tokens(title, drop_coined=False, max_tokens=6)
    a = [w for w in _extract_tokens(abstract, drop_coined=True, max_tokens=8) if w.lower() not in {t.lower() for t in toks}]
    qs = []
    if len(toks) >= 2:
        qs.append(" ".join(toks[:2]))
    if len(toks) >= 4:
        qs.append(" ".join(toks[2:4]))
    elif toks:
        qs.append(toks[0])
    if len(a) >= 2:
        qs.append(" ".join(a[:2]))
    return list(dict.fromkeys(q for q in qs if q))[:3]


async def calls_for_papers(title: str, abstract: str = "", limit: int = 10) -> list[dict]:
    """Upcoming conferences with open submission deadlines, ranked by how close their theme is to the paper."""
    text = f"{title}. {abstract}".strip(". ")
    events: dict[str, dict] = {}
    for q in _cfp_queries(title, abstract):
        try:
            for e in await wikicfp.search(q):
                events.setdefault(e["url"], e)
        except SourceError:
            continue
    today = date.today().isoformat()
    open_ = []
    for e in events.values():
        upcoming = [d for d in e["deadlines"] if d >= today]
        if not upcoming:
            continue
        e = {**e, "deadline": upcoming[0], "later_deadline": upcoming[1] if len(upcoming) > 1 else None}
        open_.append(e)
    if not open_:
        return []
    sims = await _similarity_scores(text, [f"{e['acronym']}: {e['name']}" for e in open_])
    ranked = sorted(zip(open_, sims), key=lambda p: -p[1])
    top = ranked[0][1]
    keep = [(e, s) for e, s in ranked if s >= max(0.3, top * 0.6)][:limit]
    out = []
    for e, s in keep:
        days = (date.fromisoformat(e["deadline"]) - date.today()).days
        label = f"{e['acronym']} {e['name']}"
        backed = re.search(r"\b(IEEE|ACM|Springer|Elsevier|AAAI|IFIP|SIAM|USENIX)\b", label) is not None
        out.append({**e, "relevance": round(float(s), 2), "days_left": days, "publisher_backed": backed,
                    "kind": "journal call" if re.match(r"(?i)\s*international journal", e["name"]) else "conference"})
    return sorted(out, key=lambda e: (not e["publisher_backed"], e["deadline"]))
