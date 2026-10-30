// Mirrors backend/common/schemas.py. Keep in sync.

export type SourceName =
  | "crossref" | "semantic_scholar" | "openalex" | "arxiv"
  | "local_phraselist" | "embedding" | "llm" | "document";

export interface Evidence {
  source: SourceName;
  request_url?: string | null;
  record_url?: string | null;
  matched_fields: Record<string, unknown>;
  excerpt?: string | null;
  fetched_at?: string | null;
  note?: string | null;
}

export type JobStatus = "queued" | "running" | "done" | "error";
export interface Job {
  job_id: string; kind: string; status: JobStatus; stage?: string | null;
  progress: number; result_id?: string | null; error?: string | null; created_at: string;
}
export interface JobEvent { job_id: string; stage: string; message: string; progress: number; ts: string; status: JobStatus }

export interface PaperRef {
  id: string; title: string; year?: number | null; doi?: string | null;
  url?: string | null; venue?: string | null; cited_by?: number | null;
}

export interface DocumentInfo {
  document_id: string; filename: string; kind: "pdf" | "text"; title?: string | null;
  doi?: string | null; pages: number; n_references: number; parser: string;
}
export interface PageText { page: number; text: string }

export type GapClass = "rising" | "saturated" | "underexplored" | "unclassified";
export interface Cluster {
  cluster_id: number; label: string; description: string; label_source: "llm" | "keywords";
  size: number; counts_by_year: Record<string, number>; growth: number; recency_share: number;
  cites_per_year: number; classification: GapClass; reasons: string[]; top_papers: PaperRef[]; keywords: string[];
}
export interface GapRadarResult {
  run_id: string; query: string; n_papers: number; years: number[]; clusters: Cluster[];
  field_baseline: Record<string, number>; thresholds: Record<string, string>;
  sources_used: Record<string, number>; created_at: string;
}
export interface ResearchQuestion { text: string; rationale: string; evidence: PaperRef[] }
export interface QuestionsResult { run_id: string; cluster_id: number; questions: ResearchQuestion[]; dropped: number }

export type RefStatus = "verified" | "metadata_mismatch" | "not_found" | "could_not_verify";
export type RetractionStatus =
  | "retracted" | "corrected" | "expression_of_concern" | "none_found" | "could_not_verify" | "not_checked";
export interface ParsedRef { raw: string; doi?: string | null; arxiv_id?: string | null; title?: string | null; year?: number | null; first_author?: string | null }
export interface FieldDiff { field: string; in_paper?: string | null; in_record?: string | null }
export interface ReferenceCheck {
  ref_index: number; label: string; parsed: ParsedRef; status: RefStatus; matched?: PaperRef | null;
  mismatches: FieldDiff[]; retraction: RetractionStatus; retraction_notices: string[]; evidence: Evidence[];
}
export type ClaimLabel = "supported" | "unclear" | "unsupported" | "not_assessed";
export interface ClaimCheck {
  sentence: string; page: number; start: number; end: number; ref_index: number;
  cited_title?: string | null; cited_abstract?: string | null; similarity?: number | null;
  label: ClaimLabel; rationale: string; evidence: Evidence[];
}
export interface PhraseHit {
  phrase: string; expected: string; page: number; start: number; end: number; context: string;
  source: string; source_url?: string | null; verified_by?: string | null;
}
export interface OverlapHit {
  paragraph: string; page: number; start: number; end: number; similarity: number;
  matched: PaperRef; matched_text: string; relation: "cited" | "related";
}
export type HighlightKind = "claim_supported" | "claim_unclear" | "claim_unsupported" | "phrase" | "overlap" | "retraction";
export interface Highlight { page: number; start: number; end: number; kind: HighlightKind; ref: string }
export interface ScoreTerm { name: string; value: number; max: number; formula: string; inputs: Record<string, number> }
export interface SelfStatus {
  doi?: string | null; title?: string | null; resolved?: PaperRef | null;
  retraction: RetractionStatus; notices: string[]; evidence: Evidence[];
}
export interface AuditReport {
  audit_id: string; document_id: string; checks_run: string[]; self_status?: SelfStatus | null;
  references: ReferenceCheck[]; claims: ClaimCheck[]; phrases: PhraseHit[]; overlaps: OverlapHit[];
  highlights: Highlight[]; score: number; score_terms: ScoreTerm[]; low_confidence: boolean;
  warnings: string[]; summary: Record<string, number>; created_at: string;
}

export interface PersonaReview {
  persona: string; score?: number | null; weaknesses: string[]; fixes: string[];
  confidence?: number | null; summary: string; error?: string | null;
}
export interface RankedFix { rank: number; fix: string; source: string; priority: number; blocking: boolean }
export interface VenueCount { venue: string; count: number; example_titles: string[]; openalex_source_id?: string | null }
export interface ChecklistItem { name: string; passed: boolean; detail: string }
export interface LlmInfo {
  provider: string; model: string; available: boolean; local?: boolean; configured?: string;
  condensed?: boolean; chars_read?: number; chars_total?: number;
}
export interface PipelineResult { pipeline_id: string; autoclaw_run_id?: string | null; document_id: string; audit_id: string; review_id: string }

export interface Verdict {
  review_id: string; document_id: string; audit_id?: string | null; decision: "submit" | "revise" | "dont_submit";
  personas: PersonaReview[]; weighted_mean?: number | null; integrity?: number | null; triggered_rules: string[];
  rules: string[]; ranked_fixes: RankedFix[]; venue_suggestions: VenueCount[]; venue?: string | null;
  checklist: ChecklistItem[]; llm: LlmInfo; created_at: string;
}

export interface AutoClawStage { number: number; name: string; status: "pending" | "running" | "done" }
export interface AutoClawRun {
  run_id: string; topic: string; demo: boolean; status: JobStatus; stages: AutoClawStage[]; log_tail: string[];
  pdf_path?: string | null; latex_path?: string | null; document_id?: string | null; provenance?: string | null; created_at: string;
}

export interface Health {
  ok: boolean; llm: LlmInfo; demo_mode: boolean;
  s2_key: boolean; contact_email: boolean; tortured_phrases: number; verdict_rules: string[];
}
