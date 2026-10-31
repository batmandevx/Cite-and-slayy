"""Gap Radar: what should I research?

ingest (OpenAlex + arXiv) -> embed (MiniLM) -> cluster (KMeans/HDBSCAN) -> label (LLM, else keywords)
-> per-cluster metrics -> Rising / Saturated / Underexplored / Unclassified with transparent thresholds.
"""
from __future__ import annotations

import asyncio
import statistics
import uuid
from datetime import date, timedelta

import numpy as np
from pydantic import BaseModel
from sklearn.cluster import HDBSCAN, KMeans
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics import silhouette_score

from backend.cache.store import get_store, now
from backend.common.schemas import Cluster, GapRadarRequest, GapRadarResult, Paper, PaperRef
from backend.documents.parser import norm
from backend.embeddings.model import embed_async
from backend.llm import client as llm
from backend.sources import arxiv, openalex
from backend.sources.http import SourceError

RISING_GROWTH_MULT = 1.5


def ref_of(p: Paper) -> PaperRef:
    return PaperRef(id=p.id, title=p.title, year=p.year, doi=p.doi, url=p.url, venue=p.venue, cited_by=p.cited_by)


# ---------- ingest ----------

async def ingest(req: GapRadarRequest, ctx) -> tuple[list[Paper], dict[str, int]]:
    papers: list[Paper] = []
    used = {"openalex": 0, "arxiv": 0}
    if "openalex" in req.sources:
        target = req.max_papers if "arxiv" not in req.sources else int(req.max_papers * 0.8)
        async for batch, _ in openalex.iter_search(req.query, req.from_year, target):
            ps = [openalex.to_paper(w) for w in batch]
            papers += [p for p in ps if p.abstract and p.title]
            await ctx.update("ingest", f"OpenAlex: {len(papers)} papers", 0.05 + 0.25 * min(1, len(papers) / target))
            if len(papers) >= target:
                break
        used["openalex"] = len(papers)
    if "arxiv" in req.sources:
        want = max(50, req.max_papers - len(papers))
        start = 0
        while start < min(want, 400):
            try:
                f = await arxiv.search(req.query, start=start, max_results=100)
            except SourceError as e:
                await ctx.update("ingest", f"arXiv unavailable ({e.reason}); continuing with OpenAlex only", None)
                break
            batch = [p for p in arxiv.parse_feed(f.data) if p.year and p.year >= req.from_year]
            if not batch:
                break
            papers += batch
            used["arxiv"] += len(batch)
            start += 100
            await ctx.update("ingest", f"arXiv: {used['arxiv']} papers", 0.3)
    # dedupe: DOI, then arXiv id embedded in DOI, then normalised title
    seen_doi, seen_title, out = set(), set(), []
    for p in papers:
        key_doi = (p.doi or "").lower()
        key_t = norm(p.title)[:120]
        if (key_doi and key_doi in seen_doi) or key_t in seen_title:
            continue
        if key_doi:
            seen_doi.add(key_doi)
        seen_title.add(key_t)
        out.append(p)
    return out[: req.max_papers], used


# ---------- cluster ----------

def cluster_embeddings(X: np.ndarray, method: str) -> np.ndarray:
    n = len(X)
    if method == "hdbscan":
        return HDBSCAN(min_cluster_size=max(10, n // 60), metric="euclidean").fit_predict(X)
    best, best_s = None, -1.0
    rng = np.random.default_rng(0)
    sample = rng.choice(n, size=min(n, 1500), replace=False)
    for k in range(6, min(15, max(6, n // 25)) + 1):
        labels = KMeans(n_clusters=k, n_init=5, random_state=0).fit_predict(X)
        s = silhouette_score(X[sample], labels[sample], metric="cosine")
        if s > best_s:
            best, best_s = labels, s
    return best


def keywords(docs_by_cluster: dict[int, list[str]], top: int = 6) -> dict[int, list[str]]:
    ids = sorted(docs_by_cluster)
    if not ids:
        return {}
    max_df = 0.6 if len(ids) >= 4 else 1.0
    min_df = 2 if len(ids) >= 3 else 1
    vec = TfidfVectorizer(stop_words="english", ngram_range=(1, 2), max_df=max_df, min_df=min_df, sublinear_tf=True,
                          token_pattern=r"(?u)\b[a-zA-Z][a-zA-Z\-]{2,}\b")
    try:
        M = vec.fit_transform([" ".join(docs_by_cluster[c]) for c in ids])
    except ValueError:
        return {c: [] for c in ids}
    vocab = np.array(vec.get_feature_names_out())
    out = {}
    for row, c in enumerate(ids):
        scores = M[row].toarray().ravel()
        out[c] = [str(vocab[i]) for i in scores.argsort()[::-1][:top] if scores[i] > 0]
    return out


class _Label(BaseModel):
    label: str
    description: str


async def label_cluster(query: str, papers: list[Paper], kws: list[str]) -> tuple[str, str, str]:
    if llm.available():
        listing = "\n".join(f"- {p.title} ({p.year}): {(p.abstract or '')[:300]}" for p in papers[:8])
        try:
            out = await llm.complete_json(
                "You name research sub-topics. Use only the papers given.",
                f"Field: {query}\nThese papers form one cluster:\n{listing}\n\n"
                "Return a label of at most 6 words naming the shared sub-topic, and a one-sentence description.",
                _Label, effort="low", max_tokens=2000, tier="fast")
            return out.label.strip(), out.description.strip(), "llm"
        except llm.LLMError:
            pass
    return ", ".join(kws[:3]).title() or "Cluster", "Top terms: " + ", ".join(kws), "keywords"


# ---------- metrics & classification ----------

def metrics(ps: list[Paper], today: date) -> dict:
    last_full = today.year - 1
    first = last_full - 2
    counts: dict[int, int] = {}
    for p in ps:
        if p.year:
            counts[p.year] = counts.get(p.year, 0) + 1
    growth = ((counts.get(last_full, 0) + 1) / (counts.get(first, 0) + 1)) ** 0.5 - 1
    cutoff = (today - timedelta(days=365)).isoformat()
    recent = sum(1 for p in ps if (p.date or f"{p.year or 0}-01-01") >= cutoff)
    cpy = [((p.cited_by or 0) / max(1, today.year - (p.year or today.year) + 1)) for p in ps]
    return {"counts": dict(sorted(counts.items())), "growth": growth, "recency": recent / max(1, len(ps)),
            "cpy": statistics.fmean(cpy) if cpy else 0.0}


def classify(m: dict, size: int, base: dict) -> tuple[str, list[str]]:
    reasons = []
    rising = m["growth"] >= RISING_GROWTH_MULT * max(base["median_growth"], 0.05) and m["recency"] >= base["median_recency"]
    saturated = size >= base["size_upper_tertile"] and m["growth"] <= base["median_growth"]
    under = size <= base["size_lower_tertile"] and m["cpy"] > base["median_cites_per_year"]
    if rising:
        reasons.append(f"growth {m['growth']:.0%} ≥ {RISING_GROWTH_MULT}× field median ({base['median_growth']:.0%}) "
                       f"and recency {m['recency']:.0%} ≥ median ({base['median_recency']:.0%})")
        return "rising", reasons
    if under:
        reasons.append(f"size {size} in bottom tertile (≤ {base['size_lower_tertile']:.0f}) and "
                       f"citations/yr {m['cpy']:.1f} > median ({base['median_cites_per_year']:.1f})")
        return "underexplored", reasons
    if saturated:
        reasons.append(f"size {size} in top tertile (≥ {base['size_upper_tertile']:.0f}) and "
                       f"growth {m['growth']:.0%} ≤ median ({base['median_growth']:.0%})")
        return "saturated", reasons
    reasons.append("no rule fired")
    return "unclassified", reasons


# ---------- run ----------

MIN_PAPERS = 60


class _Query(BaseModel):
    query: str


async def refine_query(query: str) -> str | None:
    """Correct spelling and normalise a field name into standard academic search terms (no new topics)."""
    if not llm.available():
        return None
    try:
        out = await llm.complete_json(
            "You fix research search queries. Correct spelling and turn the text into the standard academic phrase a "
            "database like OpenAlex would match (e.g. 'ai in medical' -> 'artificial intelligence in medicine'). "
            "Keep the same topic; do not add or narrow concepts. At most 8 words.",
            f"Query: {query}", _Query, effort="low", max_tokens=200, tier="fast")
        q = " ".join(out.query.split())[:120]
        return q or None
    except llm.LLMError:
        return None


async def run(req: GapRadarRequest, ctx) -> str:
    today = date.today()
    await ctx.update("ingest", f"Searching OpenAlex/arXiv for “{req.query}”", 0.02)
    papers, used = await ingest(req, ctx)
    if len(papers) < MIN_PAPERS:
        # Too few hits: usually a typo or an unusual phrasing. Fix the wording first, then widen the years.
        better = await refine_query(req.query)
        if better and better.lower() != req.query.lower():
            await ctx.update("ingest", f"Only {len(papers)} papers for “{req.query}”; retrying as “{better}”", 0.05)
            req = req.model_copy(update={"query": better})
            papers, used = await ingest(req, ctx)
        if len(papers) < MIN_PAPERS and req.from_year > today.year - 8:
            wider = max(today.year - 8, req.from_year - 3)
            await ctx.update("ingest", f"Still {len(papers)} papers; widening the range to {wider}–{today.year}", 0.08)
            req = req.model_copy(update={"from_year": wider})
            papers, used = await ingest(req, ctx)
    if len(papers) < MIN_PAPERS:
        raise ValueError(f"Found only {len(papers)} papers with abstracts for “{req.query}” (a scan needs {MIN_PAPERS}). "
                         "Check the spelling, use a broader field name, or pick an earlier start year. "
                         "If even common topics return 0, the scholarly API is temporarily rate-limiting us: try again in a few minutes.")

    await ctx.update("embed", f"Embedding {len(papers)} titles + abstracts (all-MiniLM-L6-v2)", 0.35)
    X = await embed_async([f"{p.title}. {p.abstract or ''}" for p in papers])

    await ctx.update("cluster", f"Clustering ({req.clustering})", 0.55)
    labels = await asyncio.to_thread(cluster_embeddings, X, req.clustering)
    cids = sorted(set(int(l) for l in labels) - {-1})
    if len(cids) < 2 and req.clustering == "hdbscan":
        labels = await asyncio.to_thread(cluster_embeddings, X, "kmeans")
        cids = sorted(set(int(l) for l in labels) - {-1})
    members = {c: [i for i, l in enumerate(labels) if l == c] for c in cids}
    centroids = {c: X[members[c]].mean(axis=0) for c in cids}
    kws = keywords({c: [f"{papers[i].title} {papers[i].abstract or ''}" for i in members[c]] for c in cids})

    per = {}
    for c in cids:
        order = sorted(members[c], key=lambda i: -float(X[i] @ centroids[c]))
        per[c] = {"order": order, "m": metrics([papers[i] for i in members[c]], today)}
    sizes = sorted(len(members[c]) for c in cids)
    base = {
        "median_growth": statistics.median(per[c]["m"]["growth"] for c in cids),
        "median_recency": statistics.median(per[c]["m"]["recency"] for c in cids),
        "median_cites_per_year": statistics.median(per[c]["m"]["cpy"] for c in cids),
        "size_lower_tertile": float(np.percentile(sizes, 33.3)),
        "size_upper_tertile": float(np.percentile(sizes, 66.7)),
    }
    thresholds = {
        "rising": f"growth ≥ {RISING_GROWTH_MULT}× field median growth AND recency share ≥ field median",
        "underexplored": "cluster size in bottom tertile AND mean citations/year > field median (attention without volume)",
        "saturated": "cluster size in top tertile AND growth ≤ field median",
        "unclassified": "none of the above (checked in the order rising → underexplored → saturated)",
        "growth": f"CAGR of paper count {today.year - 3}→{today.year - 1} (+1 smoothing)",
        "recency": "share of cluster papers published in the last 12 months",
        "citations/year": "mean of (citations ÷ years since publication) over the cluster's papers",
    }

    await ctx.update("label", f"Labelling {len(cids)} clusters", 0.65)
    sem = asyncio.Semaphore(4)

    async def lab(c):
        async with sem:
            return c, await label_cluster(req.query, [papers[i] for i in per[c]["order"][:8]], kws[c])

    labelled = dict(await asyncio.gather(*(lab(c) for c in cids)))
    seen_labels: dict[str, int] = {}
    for c in cids:  # small models sometimes give two clusters the same name: add a distinguishing keyword
        lab_, desc, src = labelled[c]
        key = lab_.lower()
        if key in seen_labels:
            extra = next((k for k in kws[c] if k.lower() not in key), None)
            if extra:
                labelled[c] = (f"{lab_} · {extra}", desc, src)
        seen_labels[key] = c

    clusters: list[Cluster] = []
    context = {}
    for c in cids:
        m = per[c]["m"]
        cls, reasons = classify(m, len(members[c]), base)
        lab_, desc, src = labelled[c]
        top = [papers[i] for i in per[c]["order"][:15]]
        clusters.append(Cluster(cluster_id=c, label=lab_, description=desc, label_source=src, size=len(members[c]),
                                counts_by_year=m["counts"], growth=round(m["growth"], 4),
                                recency_share=round(m["recency"], 4), cites_per_year=round(m["cpy"], 2),
                                classification=cls, reasons=reasons, top_papers=[ref_of(p) for p in top[:8]],
                                keywords=kws[c]))
        neighbours = sorted((d for d in cids if d != c), key=lambda d: -float(centroids[c] @ centroids[d]))[:2]
        context[c] = {"papers": [p.model_dump() for p in top],
                      "neighbours": {d: [papers[i].model_dump() for i in per[d]["order"][:5]] for d in neighbours}}
    order = {"underexplored": 0, "rising": 1, "unclassified": 2, "saturated": 3}
    clusters.sort(key=lambda k: (order[k.classification], -k.cites_per_year))
    years = sorted({y for k in clusters for y in k.counts_by_year})
    result = GapRadarResult(run_id=uuid.uuid4().hex[:12], query=req.query, n_papers=len(papers), years=years,
                            clusters=clusters, field_baseline={k: round(v, 4) for k, v in base.items()},
                            thresholds=thresholds, sources_used=used, created_at=now())
    get_store().put("gap_run", result.run_id, result)
    get_store().put("gap_context", result.run_id, context)
    await ctx.update("done", f"{len(clusters)} clusters", 1.0)
    return result.run_id
