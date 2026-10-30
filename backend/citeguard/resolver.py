"""Check 1 + 2: does each reference exist, does its metadata match, and has it been retracted?

Resolution chain: Crossref (DOI, then bibliographic search) -> arXiv id -> Semantic Scholar -> OpenAlex.

Status rules (never fabricate):
- verified          a real record matched and title / year / first author agree
- metadata_mismatch a real record matched (by DOI or title) but a field disagrees; diffs shown
- not_found         every resolver answered successfully and none matched
- could_not_verify  no match AND at least one resolver failed (network, rate limit, 5xx)
"""
from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass, field

from rapidfuzz import fuzz

from backend.common.schemas import Evidence, FieldDiff, Paper, PaperRef, ParsedRef, ReferenceCheck, SelfStatus
from backend.documents.parser import RefEntry, fold, norm
from backend.sources import arxiv, crossref, openalex, semantic_scholar
from backend.sources.http import Fetched, SourceError

SEVERITY = {"retracted": 5, "expression_of_concern": 4, "corrected": 3, "could_not_verify": 2, "none_found": 1, "not_checked": 0}
TITLE_MATCH = 90       # partial_ratio of candidate title inside the raw reference string
DOI_TITLE_SANITY = 70  # below this, a DOI resolves to a *different* work
YEAR_TOLERANCE = 1     # preprint vs. published year


@dataclass
class Assessment:
    matched: bool
    title_score: float
    diffs: list[FieldDiff] = field(default_factory=list)


VENUE_CUT = re.compile(r"\s(?:Advances in|Proceedings|In Proc|Journal of|IEEE|ACM|Conference|Transactions|arXiv|Procedia|Springer)\b.*$", re.I)


def title_variants(ref: ParsedRef) -> list[str]:
    out: list[str] = []
    if ref.title:
        out.append(ref.title)
        cut = VENUE_CUT.sub("", ref.title).strip()
        if "?" in cut:
            cut = cut.split("?")[0] + "?" if len(cut.split("?")[0]) > 15 else cut
        if cut and cut not in out and len(cut) > 15:
            out.append(cut)
    else:
        out.append(ref.raw[:200])
    return out


def _surname(name: str) -> str:
    parts = norm(name).split()
    return parts[-1] if parts else ""


def title_similarity(ref: ParsedRef, cand_title: str) -> tuple[float, bool]:
    """Full-title similarity, plus near-literal containment of the candidate title in the raw string
    (handles reference styles where the parsed title includes venue words).
    Returns (score, needs_corroboration) - short titles only count if year and author also agree."""
    ct, raw = norm(cand_title or ""), norm(ref.raw)
    if len(ct) < 12:
        return 0.0, True
    full = fuzz.ratio(ct, norm(ref.title)) if ref.title else 0.0
    contained = 0.0
    if len(ct) < 0.85 * len(raw):
        contained = fuzz.partial_ratio(ct, raw)
        if contained < 97:
            contained = 0.0
    short = len(ct) < 25 and contained > full
    return max(full, contained), short


def is_web_resource(ref: ParsedRef) -> bool:
    return bool(re.search(r"https?://|www\.", ref.raw)) and not ref.doi and not ref.arxiv_id and \
        not re.search(r"doi\.org|arxiv\.org", ref.raw, re.I)


def author_matches(first_author: str, authors: list[str]) -> bool:
    fa = norm(fold(first_author)).replace(" ", "")
    if not fa:
        return True
    for a in authors:
        na = norm(a)
        if fa in na.replace(" ", "") or any(fuzz.ratio(fa, part) >= 80 for part in na.split() if len(part) > 2):
            return True   # fuzzy: PDF text often drops diacritics ("Burduel" for "Burdușel")
    return False


def biblio_match(ref: ParsedRef, item: dict) -> bool:
    """Crossref record matches on first author + exact year + volume + first page, all present in the raw string.
    Used when the PDF text mangled the title (e.g. missing glyphs)."""
    vol, page = str(item.get("volume") or ""), str(item.get("page") or "").split("-")[0]
    if not (vol and page and ref.year and ref.first_author):
        return False
    cand = crossref.to_paper(item)
    nums = set(re.findall(r"\d+", ref.raw))
    return cand.year == ref.year and vol in nums and page in nums and author_matches(ref.first_author, cand.authors)


def assess(ref: ParsedRef, cand: Paper, by_doi: bool) -> Assessment:
    score, short = title_similarity(ref, cand.title)
    diffs: list[FieldDiff] = []
    if by_doi and score < DOI_TITLE_SANITY:
        diffs.append(FieldDiff(field="title", in_paper=ref.title or ref.raw[:160], in_record=cand.title))
    if by_doi or score >= TITLE_MATCH:
        if ref.year and cand.year and abs(ref.year - cand.year) > YEAR_TOLERANCE:
            diffs.append(FieldDiff(field="year", in_paper=str(ref.year), in_record=str(cand.year)))
        if ref.first_author and cand.authors and not author_matches(ref.first_author, cand.authors):
            diffs.append(FieldDiff(field="first_author", in_paper=ref.first_author,
                                   in_record=", ".join(cand.authors[:3])))
    if by_doi:
        return Assessment(True, score, diffs)
    fields = {d.field for d in diffs}
    matched = score >= TITLE_MATCH and not {"year", "first_author"} <= fields
    if matched and short and (diffs or not ref.year or not ref.first_author):
        matched = False   # short titles are ambiguous: require year + author agreement
    return Assessment(matched, score, diffs if matched else [])


def _ev(source, f: Fetched | None, cand: Paper | None, a: Assessment | None, note: str | None = None,
        url: str | None = None) -> Evidence:
    return Evidence(
        source=source, request_url=f.url if f else url, fetched_at=f.fetched_at if f else None,
        record_url=(cand.url if cand else None),
        matched_fields=({"title_similarity": round(a.title_score, 1), "record_title": cand.title,
                         "record_year": cand.year, "record_doi": cand.doi,
                         "record_first_authors": cand.authors[:3]} if cand and a else {}),
        excerpt=(cand.title if cand else None), note=note,
    )


def _ref_paper(p: Paper) -> PaperRef:
    return PaperRef(id=p.id, title=p.title, year=p.year, doi=p.doi, url=p.url, venue=p.venue, cited_by=p.cited_by)


async def resolve_reference(entry: RefEntry, check_retraction: bool = True) -> tuple[ReferenceCheck, Paper | None]:
    ref = entry.parsed
    evidence: list[Evidence] = []
    errors: list[str] = []
    best: tuple[Paper, Assessment, str] | None = None
    crossref_item: dict | None = None

    versions: dict[str, Paper] = {}   # every matched record with a DOI (preprint, published version, ...)
    raw_norm = norm(ref.raw)

    def venue_hit(c: Paper) -> bool:
        v = norm(c.venue or "")
        return len(v) > 4 and v in raw_norm

    def consider(cand: Paper, a: Assessment, source: str, item: dict | None = None):
        nonlocal best, crossref_item
        if not a.matched:
            return
        if cand.doi:
            versions.setdefault(cand.doi.lower(), cand)
        key = (not a.diffs, venue_hit(cand), a.title_score)
        if best is None or key > (not best[1].diffs, venue_hit(best[0]), best[1].title_score):
            best = (cand, a, source)
            crossref_item = item

    # 1. Crossref by DOI
    if ref.doi:
        try:
            f = await crossref.get_work(ref.doi)
            if f.data is None:
                evidence.append(_ev("crossref", f, None, None, note=f"DOI {ref.doi} is not registered with Crossref (404)"))
            else:
                item = f.data["message"]
                cand = crossref.to_paper(item)
                a = assess(ref, cand, by_doi=True)
                evidence.append(_ev("crossref", f, cand, a, note="resolved by DOI"))
                consider(cand, a, "crossref", item)
        except SourceError as e:
            errors.append(str(e))
            evidence.append(Evidence(source="crossref", request_url=e.url, note=f"request failed: {e.reason}"))

    # 2. Crossref bibliographic search
    if best is None or best[1].diffs:
        try:
            f = await crossref.search_bibliographic(ref.raw)
            items = (f.data or {}).get("message", {}).get("items", [])
            scored = [(crossref.to_paper(it), it) for it in items]
            top = None
            for cand, it in scored:
                a = assess(ref, cand, by_doi=False)
                if not a.matched and biblio_match(ref, it):
                    a = Assessment(True, a.title_score, [])
                    evidence.append(_ev("crossref", f, cand, a, note="matched on first author + year + volume + "
                                        "first page (title text in the PDF appears incomplete)"))
                if top is None or a.title_score > top[1].title_score:
                    top = (cand, a, it)
                consider(cand, a, "crossref", it)
            if top:
                evidence.append(_ev("crossref", f, top[0], top[1], note="best bibliographic-search candidate"))
            else:
                evidence.append(_ev("crossref", f, None, None, note="bibliographic search returned no items"))
        except SourceError as e:
            errors.append(str(e))
            evidence.append(Evidence(source="crossref", request_url=e.url, note=f"request failed: {e.reason}"))

    # 3. arXiv id
    if (best is None or best[1].diffs) and ref.arxiv_id:
        try:
            f = await arxiv.by_id(ref.arxiv_id)
            for cand in arxiv.parse_feed(f.data):
                a = assess(ref, cand, by_doi=True)
                evidence.append(_ev("arxiv", f, cand, a, note="resolved by arXiv id"))
                consider(cand, a, "arxiv")
        except SourceError as e:
            errors.append(str(e))
            evidence.append(Evidence(source="arxiv", request_url=e.url, note=f"request failed: {e.reason}"))

    # 4. Semantic Scholar title match
    for q in (title_variants(ref) if best is None or best[1].diffs else []):
        if best is not None and not best[1].diffs:
            break
        try:
            f = await semantic_scholar.match_title(q)
            data = (f.data or {}).get("data") or []
            if data:
                cand = semantic_scholar.to_paper(data[0])
                a = assess(ref, cand, by_doi=False)
                evidence.append(_ev("semantic_scholar", f, cand, a, note="title match"))
                consider(cand, a, "semantic_scholar")
            else:
                evidence.append(_ev("semantic_scholar", f, None, None, note="no title match"))
        except SourceError as e:
            errors.append(str(e))
            evidence.append(Evidence(source="semantic_scholar", request_url=e.url, note=f"request failed: {e.reason}"))

    # 5. OpenAlex search
    for q in (title_variants(ref) if best is None or best[1].diffs else []):
        if best is not None and not best[1].diffs:
            break
        try:
            f = await openalex.search_title(q)
            results = (f.data or {}).get("results", [])
            top = None
            for w in results:
                cand = openalex.to_paper(w)
                a = assess(ref, cand, by_doi=False)
                if top is None or a.title_score > top[1].title_score:
                    top = (cand, a)
                consider(cand, a, "openalex")
            evidence.append(_ev("openalex", f, top[0] if top else None, top[1] if top else None,
                                note="best title-search candidate" if top else "no results"))
        except SourceError as e:
            errors.append(str(e))
            evidence.append(Evidence(source="openalex", request_url=e.url, note=f"request failed: {e.reason}"))

    if is_web_resource(ref) and (best is None or best[1].diffs):
        # Websites / registries (e.g. clinicaltrials.gov) are not indexed by scholarly APIs: say so, don't guess.
        evidence.append(Evidence(source="document", note="Web resource (URL, no DOI): not indexed by Crossref / "
                                 "Semantic Scholar / OpenAlex, so existence cannot be verified here. Check the link manually."))
        return ReferenceCheck(ref_index=entry.index, label=entry.label, parsed=ref, status="could_not_verify",
                              retraction="not_checked", evidence=evidence), None

    if best is not None:
        cand, a, _ = best
        status = "metadata_mismatch" if a.diffs else "verified"
        check = ReferenceCheck(ref_index=entry.index, label=entry.label, parsed=ref, status=status,
                               matched=_ref_paper(cand), mismatches=a.diffs, evidence=evidence)
    else:
        status = "could_not_verify" if errors else "not_found"
        check = ReferenceCheck(ref_index=entry.index, label=entry.label, parsed=ref, status=status, evidence=evidence)
        cand = None

    if check_retraction:
        doi = (cand.doi if cand and cand.doi else None)
        if doi:
            # Check the matched record and any other matched version (e.g. preprint + journal article with the
            # same title): a retraction of either matters. The most severe status wins.
            dois = [doi] + [d for d in versions if d != doi.lower()][:2]
            results = []
            for i, d in enumerate(dois):
                results.append(await retraction_status(d, (crossref_item or {}).get("updated-by") if i == 0 else None))
            st, notices = max(((r[0], r[1]) for r in results), key=lambda x: SEVERITY.get(x[0], 0))
            check.retraction, check.retraction_notices = st, notices
            for d, r in zip(dois, results):
                for e in r[2]:
                    if len(dois) > 1:
                        e.note = f"[{d}] {e.note}"
                    check.evidence.append(e)
        elif cand is not None:
            check.retraction = "not_checked"
            check.evidence.append(Evidence(source="crossref", record_url=cand.url,
                                           note="Matched record has no Crossref DOI (e.g. arXiv preprint or proceedings "
                                                "without DOIs), so Crossref retraction data does not cover it"))
    return check, cand


async def retraction_status(doi: str, updated_by: list[dict] | None = None) -> tuple[str, list[str], list[Evidence]]:
    evidence: list[Evidence] = []
    crossref_missing = False
    f0 = None
    try:
        if updated_by is None:
            f0 = await crossref.get_work(doi)
            if f0.data is None:
                crossref_missing = True
                updated_by = []
            else:
                updated_by = (f0.data.get("message") or {}).get("updated-by") or []
        f = await crossref.updates_for(doi)
        notices = (f.data or {}).get("message", {}).get("items", [])
    except SourceError as e:
        return "could_not_verify", [], [Evidence(source="crossref", request_url=e.url,
                                                  note=f"retraction lookup failed: {e.reason}")]
    if crossref_missing and not notices:
        return "not_checked", [], [Evidence(
            source="crossref", request_url=f0.url if f0 else f.url, fetched_at=f0.fetched_at if f0 else f.fetched_at,
            record_url=crossref.doi_url(doi), matched_fields={"status": "not_checked"},
            note="DOI is not registered with Crossref (e.g. DataCite/arXiv DOI or non-existent DOI), so Crossref retraction records do not cover it",
        )]
    status, notice_dois, raw = crossref.classify_updates(updated_by, notices, doi)
    evidence.append(Evidence(
        source="crossref", request_url=f.url, fetched_at=f.fetched_at,
        record_url=crossref.doi_url(notice_dois[0]) if notice_dois else crossref.doi_url(doi),
        matched_fields={"status": status, "updates": raw},
        note=("Crossref lists update notices for this DOI (sources include Retraction Watch where present)"
              if raw else "Crossref lists no retraction/correction notices for this DOI"),
    ))
    return status, notice_dois, evidence


async def self_status(title: str | None, doi: str | None) -> SelfStatus:
    """Is the uploaded paper itself retracted/corrected?"""
    evidence: list[Evidence] = []
    resolved: Paper | None = None
    item: dict | None = None
    try:
        if doi:
            f = await crossref.get_work(doi)
            if f.data:
                item = f.data["message"]
                resolved = crossref.to_paper(item)
                evidence.append(_ev("crossref", f, resolved, None, note="paper resolved by its own DOI"))
            else:
                evidence.append(_ev("crossref", f, None, None, note=f"DOI {doi} not registered with Crossref"))
        if resolved is None and title:
            f = await crossref.search_bibliographic(title, rows=5)
            for it in (f.data or {}).get("message", {}).get("items", []):
                cand = crossref.to_paper(it)
                ct = norm(cand.title).replace("retracted ", "")
                if fuzz.ratio(ct, norm(title)) >= 95:
                    resolved, item = cand, it
                    evidence.append(_ev("crossref", f, cand, None, note="paper resolved by exact title match"))
                    break
            if resolved is None:
                evidence.append(_ev("crossref", f, None, None,
                                    note="no Crossref record with this exact title (e.g. an unpublished preprint)"))
    except SourceError as e:
        return SelfStatus(doi=doi, title=title, resolved=None, retraction="could_not_verify",
                          evidence=[Evidence(source="crossref", request_url=e.url, note=f"lookup failed: {e.reason}")])
    if resolved is None or not resolved.doi:
        return SelfStatus(doi=doi, title=title, resolved=None, retraction="not_checked", evidence=evidence)
    st, notices, ev = await retraction_status(resolved.doi, (item or {}).get("updated-by"))
    return SelfStatus(doi=resolved.doi, title=title or resolved.title, resolved=_ref_paper(resolved),
                      retraction=st, notices=notices, evidence=evidence + ev)


async def resolve_all(entries: list[RefEntry], check_retraction: bool, on_progress=None,
                      concurrency: int = 4) -> list[tuple[ReferenceCheck, Paper | None]]:
    sem = asyncio.Semaphore(concurrency)
    done = 0

    async def one(e: RefEntry):
        nonlocal done
        async with sem:
            r = await resolve_reference(e, check_retraction)
        done += 1
        if on_progress:
            await on_progress(done, len(entries))
        return r

    return list(await asyncio.gather(*(one(e) for e in entries)))
