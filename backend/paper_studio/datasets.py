"""Data Scout: find, download and profile real open datasets for a paper, so its results come from real data.

Catalogues (indexed locally once a week and searched semantically):
  OpenML         ~7,000 tabular datasets (machine learning / classic benchmarks), downloadable as CSV
  Our World in Data  ~4,300 charts of country-year data (health, education, environment, economy, technology)
  World Bank     ~1,500 World Development Indicators (country-year)

OpenML is used on its own (one dataset); OWID and World Bank series are merged into one country-year panel on ISO code
and year, so a paper can relate e.g. internet use, schooling and GDP across countries and time.
Every dataset carries its source URL, citation and licence for the paper's Data availability statement.
"""
from __future__ import annotations

import asyncio
import base64
import io
import re
import time
from dataclasses import dataclass, field

import httpx
import numpy as np
from pydantic import BaseModel, Field

from backend.cache.store import get_store
from backend.embeddings.model import embed_async
from backend.llm import client as llm

UA = {"User-Agent": "CiteAndSlayy/1.0 (research paper assistant; contact via citeslayy.com)"}
MAX_BYTES = 25_000_000
MAX_ROWS = 60_000
CATALOG_TTL = 7 * 86400


@dataclass
class Dataset:
    name: str                                   # what the experiment code passes to load_data()
    csv: bytes
    rows: int
    columns: list[str]
    profile: str
    sources: list[dict] = field(default_factory=list)   # {title, url, citation, licence}


# ---------- catalogues ----------

async def _get(client: httpx.AsyncClient, url: str, **kw) -> httpx.Response:
    for attempt in range(3):
        r = await client.get(url, headers=UA, timeout=60, follow_redirects=True, **kw)
        if r.status_code in (429, 502, 503):
            await asyncio.sleep(2 + 3 * attempt)
            continue
        return r
    return r


async def _build_openml(client) -> list[dict]:
    r = await _get(client, "https://www.openml.org/api/v1/json/data/list/limit/10000/status/active")
    out = []
    for d in (r.json().get("data") or {}).get("dataset", []):
        q = {x["name"]: float(x["value"]) for x in d.get("quality", []) if x.get("value") not in (None, "")}
        n, f = q.get("NumberOfInstances", 0), q.get("NumberOfFeatures", 0)
        if 80 <= n <= 500_000 and 2 <= f <= 400:
            out.append({"src": "openml", "id": str(d["did"]), "file_id": str(d.get("file_id")), "title": d["name"],
                        "text": re.sub(r"[_\-.]+", " ", d["name"]), "n": int(n), "features": int(f),
                        "classes": int(q.get("NumberOfClasses", 0) or 0)})
    # keep one version per name (the largest did is usually the curated one)
    best: dict[str, dict] = {}
    for d in out:
        k = d["title"].lower()
        if k not in best or int(d["id"]) < int(best[k]["id"]):
            best[k] = d
    return list(best.values())


async def _build_owid(client) -> list[dict]:
    r = await _get(client, "https://ourworldindata.org/sitemap.xml")
    slugs = sorted(set(re.findall(r"/grapher/([a-z0-9-]+)", r.text)))
    return [{"src": "owid", "id": s, "title": s.replace("-", " "), "text": s.replace("-", " ")} for s in slugs]


async def _build_worldbank(client) -> list[dict]:
    out = []
    for page in (1, 2):
        r = await _get(client, f"https://api.worldbank.org/v2/indicator?format=json&per_page=1000&source=2&page={page}")
        data = r.json()
        if not isinstance(data, list) or len(data) < 2 or not data[1]:
            break
        for d in data[1]:
            out.append({"src": "worldbank", "id": d["id"], "title": d["name"],
                        "text": f"{d['name']}. {(d.get('sourceNote') or '')[:200]}", "note": (d.get("sourceNote") or "")[:400]})
    return out


async def catalogue() -> tuple[list[dict], np.ndarray]:
    """All catalogue entries with their embeddings, rebuilt weekly."""
    store = get_store()
    rec = store.get("data_catalog", "v1")
    if rec and time.time() - rec["at"] < (CATALOG_TTL if rec.get("complete", True) else 3600):
        return rec["items"], np.frombuffer(base64.b64decode(rec["emb"]), dtype=np.float32).reshape(len(rec["items"]), -1)
    async with httpx.AsyncClient() as client:
        parts = await asyncio.gather(_build_openml(client), _build_owid(client), _build_worldbank(client), return_exceptions=True)
    items = [x for p in parts if isinstance(p, list) for x in p]
    if not items:
        if rec:
            return rec["items"], np.frombuffer(base64.b64decode(rec["emb"]), dtype=np.float32).reshape(len(rec["items"]), -1)
        return [], np.zeros((0, 384), dtype=np.float32)
    emb = (await embed_async([x["text"] for x in items])).astype(np.float32)
    complete = all(isinstance(p, list) and p for p in parts)     # an outage at one source retries within the hour
    store.put("data_catalog", "v1", {"at": time.time(), "items": items, "complete": complete,
                                     "emb": base64.b64encode(emb.tobytes()).decode()})
    return items, emb


# ---------- Kaggle (searched per topic; needs KAGGLE_API_TOKEN) ----------

KAGGLE = "https://www.kaggle.com/api/v1"
# Only licences that allow analysis and republishing results with attribution
_OPEN = re.compile(r"cc0|public domain|cc[- ]by|attribution|odbl|open database|open data commons|"
                   r"pddl|world bank|u\.?s\.? government|community data license", re.I)
# No-derivatives licences forbid building on the data; non-commercial ones don't fit a paid product
_RESTRICTED = re.compile(r"\bnd\b|noderiv|\bnc\b|noncommercial|non-commercial", re.I)


def open_licence(name: str | None) -> bool:
    return bool(_OPEN.search(name or "")) and not _RESTRICTED.search(name or "")


def _kaggle_headers() -> dict:
    from backend.common.config import get_settings
    tok = get_settings().kaggle_api_token
    return {**UA, "Authorization": f"Bearer {tok}"} if tok else {}


async def _kaggle_search(client, query: str, k: int = 8) -> list[dict]:
    """Openly licensed, documented CSV datasets on Kaggle for a topic (most-voted first)."""
    h = _kaggle_headers()
    if not h:
        return []
    r = await client.get(f"{KAGGLE}/datasets/list", params={"search": query[:80], "filetype": "csv", "sortBy": "votes", "page": 1},
                         headers=h, timeout=30)
    if r.status_code != 200:
        return []
    out = []
    for d in r.json() or []:
        size = int(d.get("totalBytes") or 0)
        if not (open_licence(d.get("licenseName")) and 0 < size <= 60_000_000 and (d.get("usabilityRating") or 0) >= 0.6):
            continue
        out.append({"src": "kaggle", "id": d["ref"], "title": d.get("title") or d["ref"], "licence": d.get("licenseName"),
                    "url": f"https://www.kaggle.com/datasets/{d['ref']}", "bytes": size, "votes": d.get("voteCount"),
                    "text": f"{d.get('title', '')}. {d.get('subtitle', '')}"})
        if len(out) >= k:
            break
    return out


class _Queries(BaseModel):
    queries: list[str] = Field(description="2-3 word dataset search phrases")


_STOP = set("a an the of for and or in on to with by from versus vs using use effect effects impact role study analysis "
            "machine learning based towards toward new novel approach model models method methods data".split())


async def _kaggle_topic_search(client, topic: str, angle: str) -> list[dict]:
    """Kaggle's search needs every word to match, so a topic sentence finds nothing: search 3 short keyword phrases."""
    try:
        from backend.llm import client as llm
        qs = (await llm.complete_json("You write dataset search queries.", f"TOPIC: {topic}\nANGLE: {angle or '(none)'}\n\nGive 3 "
                                      "short phrases (2-3 words each) naming the DATA a study of this topic needs (the population "
                                      "or system and the outcome), e.g. 'credit default', 'adolescent sleep', 'traffic sensors'.",
                                      _Queries, effort="low", tier="fast")).queries[:3]
    except Exception:  # noqa: BLE001 - no model: fall back to the topic's keywords
        words = [w for w in re.findall(r"[a-z]+", topic.lower()) if w not in _STOP and len(w) > 2]
        qs = [" ".join(words[:2]), " ".join(words[2:4])]
    found: dict[str, dict] = {}
    for q in [q.strip() for q in qs if q.strip()]:
        for c in await _kaggle_search(client, q):
            found.setdefault(c["id"], c)
    return sorted(found.values(), key=lambda c: -(c.get("votes") or 0))[:8]


async def _kaggle_frame(client, ref: str):
    """The main CSV of a Kaggle dataset (the largest one in its archive)."""
    import zipfile
    import pandas as pd
    raw = await _download_h(client, f"{KAGGLE}/datasets/download/{ref}", _kaggle_headers(), cap=60_000_000)
    z = zipfile.ZipFile(io.BytesIO(raw))
    csvs = sorted((i for i in z.infolist() if i.filename.lower().endswith(".csv") and i.file_size < 400_000_000),
                  key=lambda i: -i.file_size)
    if not csvs:
        raise ValueError("no CSV file in the Kaggle dataset")
    data = z.read(csvs[0])
    for enc in ("utf-8", "latin-1"):
        try:
            return pd.read_csv(io.BytesIO(data), low_memory=False, encoding=enc), csvs[0].filename
        except UnicodeDecodeError:
            continue
    raise ValueError("could not decode the Kaggle CSV")


async def _download_h(client, url: str, headers: dict, cap: int) -> bytes:
    async with client.stream("GET", url, headers=headers, timeout=180, follow_redirects=True) as r:
        if r.status_code != 200:
            raise ValueError(f"HTTP {r.status_code} for {url}")
        buf = bytearray()
        async for chunk in r.aiter_bytes():
            buf += chunk
            if len(buf) > cap:
                raise ValueError(f"dataset larger than {cap // 1_000_000} MB")
        return bytes(buf)


# ---------- search and selection ----------

async def _details(client, c: dict) -> dict:
    """Description for the shortlist (OpenML description / OWID chart metadata)."""
    try:
        if c["src"] == "openml":
            r = await _get(client, f"https://www.openml.org/api/v1/json/data/{c['id']}")
            d = r.json().get("data_set_description", {})
            c = {**c, "desc": re.sub(r"\s+", " ", d.get("description") or "")[:700], "licence": d.get("licence"),
                 "target": d.get("default_target_attribute"), "url": f"https://www.openml.org/d/{c['id']}",
                 "citation": (d.get("citation") or "")[:300]}
        elif c["src"] == "owid":
            r = await _get(client, f"https://ourworldindata.org/grapher/{c['id']}.metadata.json")
            m = r.json().get("chart", {})
            c = {**c, "title": m.get("title") or c["title"], "desc": (m.get("subtitle") or "")[:400],
                 "citation": (m.get("citation") or "")[:300], "url": f"https://ourworldindata.org/grapher/{c['id']}", "licence": "CC BY 4.0"}
        elif c["src"] == "kaggle":
            r = await client.get(f"{KAGGLE}/datasets/view/{c['id']}", headers=_kaggle_headers(), timeout=30)
            d = r.json() if r.status_code == 200 else {}
            c = {**c, "desc": re.sub(r"\s+", " ", (d.get("subtitleNullable") or "") + ". " + (d.get("descriptionNullable") or ""))[:700],
                 "citation": f"{d.get('creatorNameNullable') or c['id'].split('/')[0]}, Kaggle dataset '{c['title']}'"}
        else:
            c = {**c, "desc": c.get("note", ""), "url": f"https://data.worldbank.org/indicator/{c['id']}",
                 "citation": "World Bank, World Development Indicators", "licence": "CC BY 4.0"}
    except Exception:   # noqa: BLE001 - a missing description just means less context
        pass
    return c


class _Choice(BaseModel):
    use: bool = Field(description="False if none of the candidates can genuinely test a question on this topic")
    kind: str = Field(description="'openml' (exactly one OpenML dataset), 'kaggle' (exactly one Kaggle dataset) or 'panel' "
                                   "(1-4 OWID / World Bank series merged by country-year)")
    picks: list[int] = Field(description="Candidate numbers to use")
    rationale: str
    questions: list[str] = Field(description="2-3 concrete, testable questions this data can answer for the paper")


async def scout(topic: str, angle: str, context: str, say=None, need: str = "") -> dict | None:
    """Shortlist and choose datasets for a topic. Returns {"choice", "candidates"} or None."""
    items, emb = await catalogue()
    if not items:
        return None
    q = await embed_async([f"{topic}. {angle}"])
    sims = (emb @ q.T).ravel()
    short: list[dict] = []
    for src, k in (("openml", 8), ("owid", 10), ("worldbank", 8)):
        idx = [i for i in np.argsort(-sims) if items[i]["src"] == src][:k]
        short += [{**items[i], "sim": float(sims[i])} for i in idx]
    async with httpx.AsyncClient() as client:
        try:
            short += await _kaggle_topic_search(client, topic, angle)
        except (httpx.HTTPError, ValueError):
            pass                                        # Kaggle is a bonus source; the catalogue still works
        sem = asyncio.Semaphore(4)

        async def det(c):
            async with sem:
                return await _details(client, c)
        short = await asyncio.gather(*(det(c) for c in short))
    listing = "\n".join(
        f"[{i}] {c['src'].upper()}: {c['title']}"
        + (f" ({c['n']:,} rows, {c['features']} features" + (f", target '{c.get('target')}'" if c.get("target") else "") + ")" if c["src"] == "openml" else "")
        + (f" ({c.get('licence')}, {c.get('votes') or 0} votes)" if c["src"] == "kaggle" else "")
        + (f"\n    {c.get('desc', '')[:260]}" if c.get("desc") else "") for i, c in enumerate(short))
    try:
        ch = await llm.complete_json(
            "You are a research data scientist choosing open datasets for a paper. Be strict: a dataset is useful only if it can "
            "test a real question on this topic (not a loosely related benchmark). For people/country/policy topics prefer a "
            "panel of OWID / World Bank country-year series (pick series that can be related to each other, e.g. an outcome and "
            "its plausible drivers). For a machine-learning method topic prefer one OpenML dataset of the right task type. Check "
            "construct validity: the outcome must be able to respond to the explanatory variables over the period studied "
            "(e.g. prefer enrolment, completion or test-score rates over slow-moving stocks such as adult attainment), and "
            "prefer series with broad country and year coverage. A KAGGLE dataset is acceptable when it is real, documented "
            "data with a clear provenance (a survey, registry, sensor log, trial or institutional release); REJECT any dataset "
            "whose description says it is synthetic, simulated, generated or fabricated, or whose source is unclear.",
            f"TOPIC: {topic}\nANGLE: {angle or '(none)'}\n" + (f"REQUIREMENT: {need}\n" if need else "")
            + f"CONTEXT:\n{context[:3000]}\n\nCANDIDATES:\n{listing}", _Choice,
            effort="medium", tier="fast")
    except llm.LLMError:
        return None
    if not ch.use:
        return {"choice": ch.model_dump(), "candidates": []}
    picks = [short[i] for i in ch.picks if 0 <= i < len(short)]
    if ch.kind in ("openml", "kaggle"):
        picks = [p for p in picks if p["src"] == ch.kind][:1]
    else:
        picks = [p for p in picks if p["src"] in ("owid", "worldbank")][:4]
    if not picks:
        return {"choice": {**ch.model_dump(), "use": False}, "candidates": []}
    return {"choice": ch.model_dump(), "candidates": picks}


# ---------- download and profile ----------

def profile(df) -> str:
    import pandas as pd
    lines = [f"Rows: {len(df):,}; columns: {df.shape[1]}"]
    for c in list(df.columns)[:60]:
        s = df[c]
        miss = f"{100 * s.isna().mean():.0f}% missing"
        if pd.api.types.is_numeric_dtype(s):
            d = s.describe()
            lines.append(f"- {c} (numeric): mean {d['mean']:.4g}, sd {d['std']:.4g}, min {d['min']:.4g}, max {d['max']:.4g}, {miss}")
        else:
            top = s.astype(str).value_counts().head(5)
            lines.append(f"- {c} (categorical, {s.nunique()} levels): " + ", ".join(f"{k} ({v})" for k, v in top.items()) + f"; {miss}")
    lines.append("First rows:\n" + df.head(4).to_string(max_cols=12, max_colwidth=18))
    return "\n".join(lines)


async def _download(client, url: str, cap: int = MAX_BYTES) -> bytes:
    async with client.stream("GET", url, headers=UA, timeout=180, follow_redirects=True) as r:
        if r.status_code != 200:
            raise ValueError(f"HTTP {r.status_code} for {url}")
        buf = bytearray()
        async for chunk in r.aiter_bytes():
            buf += chunk
            if len(buf) > cap:
                raise ValueError(f"dataset larger than {cap // 1_000_000} MB")
        return bytes(buf)


def _arff_frame(raw: bytes):
    """A dense ARFF file (OpenML's original format) as a DataFrame: attribute names from the header, rows as CSV."""
    import pandas as pd
    text = raw.decode("utf-8", errors="replace")
    parts = re.split(r"(?im)^\s*@data\s*$", text, maxsplit=1)
    if len(parts) != 2:
        raise ValueError("not an ARFF file")
    head, body = parts
    names = [m.group(1).strip("'\"") for m in re.finditer(r"(?im)^\s*@attribute\s+('[^']+'|\"[^\"]+\"|\S+)", head)]
    if not names or body.lstrip().startswith("{"):
        raise ValueError("sparse or empty ARFF is not supported")
    return pd.read_csv(io.StringIO(body), header=None, names=names, na_values=["?"], quotechar="'", skipinitialspace=True,
                       comment="%", low_memory=False)


async def _openml_frame(client, file_id: str):
    """OpenML table: the CSV export, or the original ARFF when a dataset has no CSV export (newer uploads)."""
    import pandas as pd
    try:
        raw = await _download(client, f"https://www.openml.org/data/get_csv/{file_id}")
        return pd.read_csv(io.BytesIO(raw), low_memory=False, na_values=["?"])
    except ValueError as e:
        if "HTTP 404" not in str(e):
            raise
    return _arff_frame(await _download(client, f"https://api.openml.org/data/v1/download/{file_id}", cap=60_000_000))


def _short(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")[:40] or "value"


async def fetch(picks: list[dict]) -> Dataset | None:
    """Download the chosen datasets and return one table ready for load_data()."""
    import pandas as pd
    async with httpx.AsyncClient() as client:
        if picks and picks[0]["src"] == "openml":
            c = picks[0]
            df = await _openml_frame(client, c["file_id"])
            if len(df) > MAX_ROWS:
                df = df.sample(MAX_ROWS, random_state=0)
            name = f"openml_{c['id']}"
        elif picks and picks[0]["src"] == "kaggle":
            c = picks[0]
            df, fname = await _kaggle_frame(client, c["id"])
            if len(df) > MAX_ROWS:
                df = df.sample(MAX_ROWS, random_state=0)
            picks = [{**c, "title": f"{c['title']} (file {fname})"}]
            name = "kaggle_" + re.sub(r"[^a-z0-9]+", "_", c["id"].split("/")[-1].lower())[:40]
        else:
            frames, used = [], []
            for c in picks:
                try:
                    if c["src"] == "owid":
                        raw = await _download(client, f"https://ourworldindata.org/grapher/{c['id']}.csv?v=1&csvType=full&useColumnShortNames=true")
                        f = pd.read_csv(io.BytesIO(raw))
                        f = f[f["Code"].notna() & ~f["Code"].astype(str).str.startswith("OWID")]
                        vals = [x for x in f.columns if x not in ("Entity", "Code", "Year", "Day")]
                        if "Year" not in f.columns or not vals:
                            continue
                        f = f[["Entity", "Code", "Year", *vals[:3]]].rename(columns={v: _short(f"{c['id'][:24]}_{v}") if len(vals) > 1 else _short(c["id"]) for v in vals[:3]})
                    else:
                        r = await _get(client, f"https://api.worldbank.org/v2/country/all/indicator/{c['id']}?format=json&per_page=20000&date=1990:2025")
                        js = r.json()
                        rows = js[1] if isinstance(js, list) and len(js) > 1 and js[1] else []
                        f = pd.DataFrame([{"Entity": x["country"]["value"], "Code": x["countryiso3code"], "Year": int(x["date"]),
                                           _short(c["title"]): x["value"]} for x in rows if x.get("countryiso3code") and x.get("value") is not None])
                        if f.empty:
                            continue
                    frames.append(f)
                    used.append(c)
                except Exception:   # noqa: BLE001 - one unavailable series doesn't sink the panel
                    continue
            if not frames:
                return None
            df = frames[0]
            for f in frames[1:]:
                df = df.merge(f.drop(columns=["Entity"], errors="ignore"), on=["Code", "Year"], how="outer")
                if "Entity" not in df.columns:
                    df["Entity"] = None
            if "Entity" in df.columns:
                df["Entity"] = df.groupby("Code")["Entity"].transform(lambda s: s.dropna().iloc[0] if s.notna().any() else None)
            df = df.sort_values(["Code", "Year"]).reset_index(drop=True)
            picks = used
            name = "panel"
    buf = io.StringIO()
    df.to_csv(buf, index=False)
    srcs = [{"title": c["title"], "url": c.get("url"), "citation": c.get("citation") or "", "licence": c.get("licence") or ""} for c in picks]
    return Dataset(name=name, csv=buf.getvalue().encode(), rows=len(df), columns=[str(x) for x in df.columns], profile=profile(df), sources=srcs)


def to_record(ds: Dataset) -> dict:
    return {"name": ds.name, "csv": base64.b64encode(ds.csv).decode(), "rows": ds.rows, "columns": ds.columns,
            "profile": ds.profile, "sources": ds.sources}


def from_record(r: dict) -> Dataset:
    return Dataset(name=r["name"], csv=base64.b64decode(r["csv"]), rows=r["rows"], columns=r["columns"], profile=r["profile"],
                   sources=r.get("sources") or [])

