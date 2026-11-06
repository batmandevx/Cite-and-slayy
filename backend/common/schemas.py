"""API contracts shared by every module. The frontend mirrors these in frontend/lib/types.ts."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

SourceName = Literal[
    "crossref", "semantic_scholar", "openalex", "arxiv",
    "local_phraselist", "embedding", "llm", "document",
]


class Evidence(BaseModel):
    """Why we believe something. Every flag must carry at least one of these."""
    source: SourceName
    request_url: str | None = None   # exact API call that was made
    record_url: str | None = None    # human-viewable link (doi.org, S2 page, OpenAlex page)
    matched_fields: dict[str, Any] = Field(default_factory=dict)
    excerpt: str | None = None       # raw snippet from the response
    fetched_at: datetime | None = None
    note: str | None = None


# ---------- jobs ----------

JobStatus = Literal["queued", "running", "done", "error"]


class Job(BaseModel):
    job_id: str
    kind: str
    status: JobStatus = "queued"
    stage: str | None = None
    progress: float = 0.0
    result_id: str | None = None
    error: str | None = None
    created_at: datetime


class JobEvent(BaseModel):
    job_id: str
    stage: str
    message: str
    progress: float
    ts: datetime
    status: JobStatus = "running"


class JobRef(BaseModel):
    job_id: str


# ---------- papers ----------

class PaperRef(BaseModel):
    id: str                          # OpenAlex W-id, DOI, or arXiv id
    title: str
    year: int | None = None
    doi: str | None = None
    url: str | None = None
    venue: str | None = None
    cited_by: int | None = None


class Paper(PaperRef):
    abstract: str | None = None
    date: str | None = None          # ISO publication date when known
    authors: list[str] = Field(default_factory=list)
    source: SourceName = "openalex"
    # Semantic Scholar enrichment (Paper Studio): one-sentence summary, influential citations, full-text lookup id
    tldr: str | None = None
    influential: int | None = None
    corpus_id: str | None = None
    pub_types: list[str] = Field(default_factory=list)
    oa_url: str | None = None


# ---------- documents ----------

class DocumentInfo(BaseModel):
    document_id: str
    filename: str
    kind: Literal["pdf", "text"]
    title: str | None = None
    doi: str | None = None
    pages: int
    n_references: int
    parser: str


class PageText(BaseModel):
    page: int
    text: str


# ---------- gap radar ----------

GapClass = Literal["rising", "saturated", "underexplored", "unclassified"]


class GapRadarRequest(BaseModel):
    query: str
    max_papers: int = Field(1000, ge=50, le=2000)
    from_year: int = 2019
    sources: list[Literal["openalex", "arxiv"]] = ["openalex", "arxiv"]
    clustering: Literal["kmeans", "hdbscan"] = "kmeans"


class Cluster(BaseModel):
    cluster_id: int
    label: str
    description: str
    label_source: Literal["llm", "keywords"]
    size: int
    counts_by_year: dict[int, int]
    growth: float                 # CAGR over the last 3 complete years
    recency_share: float          # share of papers from the last 12 months
    cites_per_year: float         # mean age-normalised citations
    classification: GapClass
    reasons: list[str]            # which thresholds fired
    top_papers: list[PaperRef]
    keywords: list[str]


class GapRadarResult(BaseModel):
    run_id: str
    query: str
    n_papers: int
    years: list[int]
    clusters: list[Cluster]
    field_baseline: dict[str, float]
    thresholds: dict[str, str]
    sources_used: dict[str, int]
    created_at: datetime


class ResearchQuestion(BaseModel):
    text: str
    rationale: str
    evidence: list[PaperRef]


class QuestionsResult(BaseModel):
    run_id: str
    cluster_id: int
    questions: list[ResearchQuestion]
    dropped: int = 0              # LLM questions discarded for citing unknown papers


# ---------- citeguard ----------

RefStatus = Literal["verified", "metadata_mismatch", "not_found", "could_not_verify"]
RetractionStatus = Literal["retracted", "corrected", "expression_of_concern", "none_found", "could_not_verify", "not_checked"]


class ParsedRef(BaseModel):
    raw: str
    doi: str | None = None
    arxiv_id: str | None = None
    title: str | None = None
    year: int | None = None
    first_author: str | None = None


class FieldDiff(BaseModel):
    field: str
    in_paper: str | None
    in_record: str | None


class ReferenceCheck(BaseModel):
    ref_index: int
    label: str                         # "[3]" or "Smith 2020"
    parsed: ParsedRef
    status: RefStatus
    matched: PaperRef | None = None
    mismatches: list[FieldDiff] = Field(default_factory=list)
    retraction: RetractionStatus = "not_checked"
    retraction_notices: list[str] = Field(default_factory=list)  # DOIs of notices
    evidence: list[Evidence] = Field(default_factory=list)


ClaimLabel = Literal["supported", "unclear", "unsupported", "not_assessed"]


class ClaimCheck(BaseModel):
    sentence: str
    page: int
    start: int
    end: int
    ref_index: int
    cited_title: str | None
    cited_abstract: str | None
    similarity: float | None
    label: ClaimLabel
    rationale: str
    evidence: list[Evidence] = Field(default_factory=list)


class PhraseHit(BaseModel):
    phrase: str
    expected: str
    page: int
    start: int
    end: int
    context: str
    source: str
    source_url: str | None
    verified_by: str | None


class OverlapHit(BaseModel):
    paragraph: str
    page: int
    start: int
    end: int
    similarity: float
    matched: PaperRef
    matched_text: str
    relation: Literal["cited", "related"]


class Highlight(BaseModel):
    page: int
    start: int
    end: int
    kind: Literal["claim_supported", "claim_unclear", "claim_unsupported", "phrase", "overlap", "retraction"]
    ref: str          # id of the finding in the report (e.g. "claim:4")


class ScoreTerm(BaseModel):
    name: str
    value: float
    max: float
    formula: str
    inputs: dict[str, float]


class SelfStatus(BaseModel):
    doi: str | None
    title: str | None
    resolved: PaperRef | None
    retraction: RetractionStatus
    notices: list[str] = Field(default_factory=list)
    evidence: list[Evidence] = Field(default_factory=list)


class AuditReport(BaseModel):
    audit_id: str
    document_id: str
    checks_run: list[str]
    self_status: SelfStatus | None
    references: list[ReferenceCheck]
    claims: list[ClaimCheck]
    phrases: list[PhraseHit]
    overlaps: list[OverlapHit]
    highlights: list[Highlight]
    score: float
    score_terms: list[ScoreTerm]
    low_confidence: bool
    warnings: list[str]
    summary: dict[str, int]
    created_at: datetime


class AuditRequest(BaseModel):
    document_id: str
    checks: list[Literal["refs", "retraction", "claims", "phrases", "overlap"]] = [
        "refs", "retraction", "claims", "phrases", "overlap"]
    max_claims: int = Field(40, ge=0, le=200)


# ---------- jury ----------

class PersonaReview(BaseModel):
    persona: str
    score: int | None = Field(None, ge=1, le=10)
    weaknesses: list[str] = Field(default_factory=list)
    fixes: list[str] = Field(default_factory=list)
    confidence: float | None = Field(None, ge=0, le=1)
    summary: str = ""
    error: str | None = None       # set when the persona could not be assessed


class RankedFix(BaseModel):
    rank: int
    fix: str
    source: str                    # "citeguard" | persona name
    priority: float
    blocking: bool = False


class VenueCount(BaseModel):
    venue: str
    count: int
    example_titles: list[str]
    openalex_source_id: str | None = None


class JuryRequest(BaseModel):
    document_id: str
    audit_id: str | None = None
    venue: str | None = None


class ChecklistItem(BaseModel):
    name: str
    passed: bool
    detail: str


class Verdict(BaseModel):
    review_id: str
    document_id: str
    audit_id: str | None
    decision: Literal["submit", "revise", "dont_submit"]
    personas: list[PersonaReview]
    weighted_mean: float | None
    integrity: float | None
    triggered_rules: list[str]
    rules: list[str]
    ranked_fixes: list[RankedFix]
    venue_suggestions: list[VenueCount]
    venue: str | None
    checklist: list[ChecklistItem] = Field(default_factory=list)
    llm: dict[str, Any] = Field(default_factory=dict)      # provider/model used, and whether text was condensed
    created_at: datetime


# ---------- autoclaw ----------

class AutoClawRequest(BaseModel):
    topic: str
    mode: Literal["auto", "co-pilot", "gate-only", "express"] = "auto"
    demo: bool | None = None       # None -> follow DEMO_MODE


class AutoClawStage(BaseModel):
    number: int
    name: str
    status: Literal["pending", "running", "done"]


class AutoClawRun(BaseModel):
    run_id: str
    topic: str
    demo: bool
    status: JobStatus
    stages: list[AutoClawStage]
    log_tail: list[str]
    pdf_path: str | None = None
    latex_path: str | None = None
    document_id: str | None = None
    provenance: str | None = None
    worker_run_id: str | None = None   # id inside the isolated AutoResearchClaw worker (lets runs survive backend restarts)
    spend_inr: float | None = None
    created_at: datetime
