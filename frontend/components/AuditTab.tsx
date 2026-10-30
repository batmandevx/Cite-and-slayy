"use client";

import clsx from "clsx";
import { ArrowRight, ChevronDown, Download, FileSearch, FileUp, Gavel, Quote, ShieldAlert, ShieldCheck, Upload } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { Fragment, lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { API, api, useJob } from "@/lib/api";
import type {
  AuditReport, ClaimCheck, DocumentInfo, Evidence, Highlight, HighlightKind, PageText, RefStatus, ReferenceCheck, RetractionStatus,
} from "@/lib/types";
import { AnimatedNumber, ScoreRing, stagger, TiltCard } from "./motion";
import { Badge, Button, Callout, Card, Empty, ExtLink, JobProgress, Meter, SectionTitle, StatTile, type Tone } from "./ui";

const CitationConstellation = lazy(() => import("./three/CitationConstellation"));

/** Critical banner with a pulsing beacon: retractions should be impossible to miss. */
function AlarmBanner({ title, children }: { title: string; children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1, x: [0, -6, 6, -4, 4, 0] }}
      transition={{ duration: 0.6, x: { delay: 0.35, duration: 0.5 } }}
      className="sheen flex gap-4 rounded-2xl border-[3px] border-edge bg-crit p-5 text-sm text-white shadow-[6px_6px_0_var(--shadow-c)]"
    >
      <div className="relative mt-0.5 grid size-9 shrink-0 place-items-center">
        <span className="pulse-ring absolute inset-0 rounded-full bg-yellow/60" />
        <span className="relative grid size-10 place-items-center rounded-full border-[2.5px] border-[#121212] bg-yellow text-[#121212]"><ShieldAlert className="size-5" /></span>
      </div>
      <div className="min-w-0">
        <div className="font-display text-lg font-extrabold">{title}</div>
        <div className="opacity-90">{children}</div>
      </div>
    </motion.div>
  );
}

const CHECKS = [
  { id: "refs", label: "Reference existence" },
  { id: "retraction", label: "Retraction status" },
  { id: "claims", label: "Claim support" },
  { id: "phrases", label: "Tortured phrases" },
  { id: "overlap", label: "Overlap hotspots" },
] as const;

const REF_TONE: Record<RefStatus, Tone> = { verified: "good", metadata_mismatch: "warn", not_found: "crit", could_not_verify: "neutral" };
const REF_LABEL: Record<RefStatus, string> = { verified: "Verified", metadata_mismatch: "Metadata mismatch", not_found: "Not found", could_not_verify: "Could not verify" };
const RET_TONE: Record<RetractionStatus, Tone> = {
  retracted: "crit", corrected: "warn", expression_of_concern: "serious", none_found: "good", could_not_verify: "neutral", not_checked: "neutral",
};
const RET_LABEL: Record<RetractionStatus, string> = {
  retracted: "Retracted", corrected: "Corrected", expression_of_concern: "Expression of concern", none_found: "No notices",
  could_not_verify: "Could not verify", not_checked: "Not covered",
};
const CLAIM_TONE = { supported: "good", unclear: "warn", unsupported: "crit", not_assessed: "neutral" } as const;
const CLAIM_LABEL = { supported: "Supported", unclear: "Unclear", unsupported: "Unsupported", not_assessed: "Not assessed" } as const;

export function scoreTone(score: number): Tone {
  return score >= 80 ? "good" : score >= 50 ? "warn" : "crit";
}

function EvidenceList({ items }: { items: Evidence[] }) {
  return (
    <ul className="space-y-2">
      {items.map((e, i) => (
        <li key={i} className="rounded-lg border border-line bg-surface px-3 py-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] uppercase text-ink-2">{e.source.replace("_", " ")}</span>
            <span className="text-ink">{e.note}</span>
            {e.fetched_at && <span className="text-muted">· fetched {new Date(e.fetched_at).toLocaleString()}</span>}
          </div>
          {Object.keys(e.matched_fields ?? {}).length > 0 && (
            <div className="mt-1.5 grid gap-x-4 gap-y-0.5 text-ink-2 sm:grid-cols-2">
              {Object.entries(e.matched_fields).filter(([k]) => k !== "updates").map(([k, v]) => (
                <div key={k} className="truncate"><span className="text-muted">{k.replaceAll("_", " ")}:</span> {Array.isArray(v) ? v.join(", ") : String(v ?? "—")}</div>
              ))}
            </div>
          )}
          <div className="mt-1.5 flex flex-wrap gap-3">
            {e.record_url && <ExtLink href={e.record_url}>record</ExtLink>}
            {e.request_url && <ExtLink href={e.request_url}>API response</ExtLink>}
          </div>
        </li>
      ))}
    </ul>
  );
}

function RefRow({ r, initiallyOpen = false }: { r: ReferenceCheck; initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <>
      <tr id={`ref-${r.ref_index}`} onClick={() => setOpen(!open)}
        className={clsx("cursor-pointer border-t border-line align-top transition hover:bg-surface-2", initiallyOpen && "bg-accent-soft/60")}>
        <td className="tabular px-4 py-2.5 text-xs font-medium text-ink-2">{r.label}</td>
        <td className="px-2 py-2.5">
          <div className="line-clamp-2 text-sm text-ink">{r.matched?.title ?? r.parsed.title ?? r.parsed.raw}</div>
          {r.mismatches.length > 0 && (
            <div className="mt-1 text-xs text-warn-ink">{r.mismatches.map((m) => `${m.field.replace("_", " ")}: “${(m.in_paper ?? "").slice(0, 40)}” vs “${(m.in_record ?? "").slice(0, 40)}”`).join(" · ")}</div>
          )}
        </td>
        <td className="px-2 py-2.5"><Badge tone={REF_TONE[r.status]}>{REF_LABEL[r.status]}</Badge></td>
        <td className="px-2 py-2.5"><Badge tone={RET_TONE[r.retraction]}>{RET_LABEL[r.retraction]}</Badge></td>
        <td className="px-3 py-2.5"><ChevronDown className={clsx("size-4 text-muted transition", open && "rotate-180")} /></td>
      </tr>
      {open && (
        <tr className="bg-surface-2/60">
          <td />
          <td colSpan={4} className="px-2 pb-4 pt-1">
            <div className="mb-2 rounded-lg bg-surface px-3 py-2 font-mono text-[11px] leading-relaxed text-ink-2">{r.parsed.raw}</div>
            {r.retraction_notices.length > 0 && (
              <div className="mb-2 text-xs">Notices: {r.retraction_notices.map((d) => <ExtLink key={d} href={`https://doi.org/${d}`} className="mr-3">{d}</ExtLink>)}</div>
            )}
            <EvidenceList items={r.evidence} />
          </td>
        </tr>
      )}
    </>
  );
}

function ClaimCard({ c, n, refLabel }: { c: ClaimCheck; n: number; refLabel: string }) {
  return (
    <div id={`claim-${n}`} className="rounded-xl border border-line bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge tone={CLAIM_TONE[c.label]}>{CLAIM_LABEL[c.label]}</Badge>
        {c.similarity != null && <span className="tabular text-xs text-ink-2">similarity {c.similarity.toFixed(2)}</span>}
        <span className="text-xs text-muted">p.{c.page + 1} · cites {refLabel}</span>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-lg bg-surface-2 p-3">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted">Citing sentence</div>
          <p className="text-sm leading-relaxed">{c.sentence}</p>
        </div>
        <div className="rounded-lg bg-surface-2 p-3">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted">Cited abstract · {c.cited_title ?? "unresolved"}</div>
          <p className="max-h-40 overflow-auto text-sm leading-relaxed text-ink-2">{c.cited_abstract ?? <i>No abstract available.</i>}</p>
        </div>
      </div>
      {c.rationale && <p className="mt-2 text-xs text-ink-2"><Quote className="mr-1 inline size-3 text-muted" />{c.rationale}</p>}
    </div>
  );
}

// ---------- highlighted document ----------

const PRIORITY: HighlightKind[] = ["phrase", "claim_unsupported", "overlap", "claim_unclear", "claim_supported", "retraction"];

function segments(text: string, hs: Highlight[]) {
  const cuts = new Set([0, text.length]);
  hs.forEach((h) => { cuts.add(Math.max(0, h.start)); cuts.add(Math.min(text.length, h.end)); });
  const pts = [...cuts].sort((a, b) => a - b);
  const out: { s: number; e: number; h: Highlight | null }[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const s = pts[i], e = pts[i + 1];
    const cover = hs.filter((h) => h.start <= s && h.end >= e);
    cover.sort((a, b) => PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind));
    out.push({ s, e, h: cover[0] ?? null });
  }
  return out;
}

function DocumentView({ report, pages, onPick }: { report: AuditReport; pages: PageText[]; onPick: (ref: string) => void }) {
  const [active, setActive] = useState<string | null>(null);
  const legend: [HighlightKind, string][] = [
    ["claim_supported", "Supported claim"], ["claim_unclear", "Unclear / not assessed"], ["claim_unsupported", "Unsupported claim"],
    ["phrase", "Tortured phrase"], ["overlap", "Possible overlap"],
  ];
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-3 text-xs text-ink-2">
        {legend.map(([k, l]) => <span key={k} className="inline-flex items-center gap-1.5"><span className={clsx("hl inline-block h-3 w-5", `hl-${k}`)} />{l}</span>)}
      </div>
      <div className="max-h-[720px] space-y-4 overflow-auto pr-2">
        {pages.map((p) => {
          const hs = report.highlights.filter((h) => h.page === p.page);
          return (
            <div key={p.page} className="rounded-xl border border-line bg-surface p-5">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted">Page {p.page + 1}</div>
              <div className="doc-text">
                {segments(p.text, hs).map((seg, i) =>
                  seg.h ? (
                    <span key={i} className={clsx("hl", `hl-${seg.h.kind}`)} data-active={active === seg.h.ref}
                      onClick={() => { setActive(seg.h!.ref); onPick(seg.h!.ref); }}>
                      {p.text.slice(seg.s, seg.e)}
                    </span>
                  ) : (
                    <Fragment key={i}>{p.text.slice(seg.s, seg.e)}</Fragment>
                  ),
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- tab ----------

type View = "references" | "claims" | "phrases" | "overlap" | "document";

export function AuditTab({
  documentId, setDocumentId, auditId, setAuditId, onVerdict,
}: {
  documentId: string | null; setDocumentId: (id: string) => void;
  auditId: string | null; setAuditId: (id: string | null) => void; onVerdict: () => void;
}) {
  const [doc, setDoc] = useState<DocumentInfo | null>(null);
  const [samples, setSamples] = useState<DocumentInfo[]>([]);
  const [checks, setChecks] = useState<string[]>(CHECKS.map((c) => c.id));
  const [loaded, setReport] = useState<AuditReport | null>(null);
  const report = loaded && loaded.audit_id === auditId ? loaded : null;
  const [pages, setPages] = useState<PageText[]>([]);
  const [view, setView] = useState<View>("references");
  const [filter, setFilter] = useState<RefStatus | "all" | "flagged">("all");
  const [focusRef, setFocusRef] = useState<number | null>(null);
  const reduced = useReducedMotion();
  const pickRef = (idx: number) => {
    setView("references"); setFilter("all"); setFocusRef(idx);
    setTimeout(() => document.getElementById(`ref-${idx}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 120);
  };
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const job = useJob();

  useEffect(() => { api.get<DocumentInfo[]>("/api/documents/samples").then(setSamples).catch(() => {}); }, []);
  useEffect(() => {
    if (!documentId) return;
    api.get<DocumentInfo>(`/api/documents/${documentId}`).then(setDoc).catch(() => setDoc(null));
    api.get<PageText[]>(`/api/documents/${documentId}/text`).then(setPages).catch(() => setPages([]));
  }, [documentId]);
  useEffect(() => {
    if (!auditId) return;
    api.get<AuditReport>(`/api/citeguard/audits/${auditId}`).then((r) => {
      setReport(r);
      if (r.document_id !== documentId) setDocumentId(r.document_id);
    }).catch(() => setReport(null));
  }, [auditId]); // eslint-disable-line react-hooks/exhaustive-deps

  const upload = async (f: File) => {
    setUploading(true); setUploadErr(null);
    try {
      const info = await api.upload<DocumentInfo>("/api/documents", f);
      setDocumentId(info.document_id); setAuditId(null);
    } catch (e) { setUploadErr((e as Error).message); } finally { setUploading(false); }
  };

  const run = () => job.start(() => api.post("/api/citeguard/audits", { document_id: documentId, checks }), (id) => setAuditId(id), "CiteGuard audit");

  const refsShown = useMemo(() => {
    if (!report) return [];
    if (filter === "all") return report.references;
    if (filter === "flagged") return report.references.filter((r) => r.status !== "verified" || ["retracted", "corrected", "expression_of_concern"].includes(r.retraction));
    return report.references.filter((r) => r.status === filter);
  }, [report, filter]);

  const pick = (ref: string) => {
    const [kind, idx] = ref.split(":");
    const target = kind === "claim" ? "claims" : kind === "phrase" ? "phrases" : "overlap";
    setView(target as View);
    setTimeout(() => document.getElementById(`${kind}-${idx}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
  };

  const s = report?.summary ?? {};
  // A retracted citation caps the colour at amber, whatever the number says.
  const tone: Tone = report ? (s.retracted_cited > 0 && scoreTone(report.score) === "good" ? "warn" : scoreTone(report.score)) : "neutral";
  const ss = report?.self_status;
  const labelOf = (i: number) => report?.references.find((r) => r.ref_index === i)?.label ?? `#${i}`;

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <SectionTitle eyebrow="Step 3 · CiteGuard" title="Can I trust this paper?">
          Works on any paper. Every reference is checked against Crossref, Semantic Scholar and OpenAlex, and every flag
          shows its evidence. If an API fails, the result says “could not verify”, never “verified”.
        </SectionTitle>
        <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
          <div
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) upload(f); }}
            onClick={() => fileRef.current?.click()}
            className={clsx("flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-8 text-center transition",
              drag ? "border-accent bg-accent-soft" : "border-line-strong hover:border-accent hover:bg-surface-2")}>
            <input ref={fileRef} type="file" accept=".pdf,.txt" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
            {uploading ? <div className="text-sm text-ink-2">Parsing…</div> : (
              <>
                <Upload className="mb-2 size-6 text-accent" />
                <div className="text-sm font-medium">Drop a paper PDF here or click to upload</div>
                <div className="mt-1 text-xs text-muted">.pdf or plain-text .txt (e.g. a PMC full text) · up to 40 MB</div>
              </>
            )}
          </div>
          <div>
            <div className="mb-2 text-xs font-medium text-ink-2">Or pick a bundled sample (real papers)</div>
            <div className="space-y-1.5">
              {samples.map((d) => (
                <button key={d.document_id} onClick={() => { setDocumentId(d.document_id); setAuditId(null); }}
                  className={clsx("flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm transition",
                    d.document_id === documentId ? "border-accent bg-accent-soft" : "border-line bg-surface hover:border-line-strong")}>
                  <FileUp className="size-4 shrink-0 text-muted" />
                  <span className="min-w-0 flex-1 truncate">{d.title ?? d.filename}</span>
                  <span className="shrink-0 text-xs text-muted">{d.n_references} refs</span>
                </button>
              ))}
            </div>
          </div>
        </div>
        {uploadErr && <div className="mt-3"><Callout tone="crit" title="Upload failed">{uploadErr}</Callout></div>}

        {doc && (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-4">
            <div className="min-w-0">
              <div className="truncate font-medium">{doc.title ?? doc.filename}</div>
              <div className="text-xs text-muted">
                {doc.pages} page(s) · {doc.n_references} references parsed · {doc.parser}{doc.doi ? ` · DOI ${doc.doi}` : ""} ·{" "}
                <a href={`${API}/api/documents/${doc.document_id}/file`} target="_blank" rel="noreferrer" className="text-accent-ink hover:underline">open file</a>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {CHECKS.map((c) => (
                <label key={c.id} className={clsx("cursor-pointer select-none rounded-full border px-2.5 py-1 text-xs transition",
                  checks.includes(c.id) ? "border-accent bg-accent-soft text-accent-ink" : "border-line text-ink-2")}>
                  <input type="checkbox" className="hidden" checked={checks.includes(c.id)}
                    onChange={() => setChecks((x) => (x.includes(c.id) ? x.filter((y) => y !== c.id) : [...x, c.id]))} />
                  {c.label}
                </label>
              ))}
              <Button variant="primary" onClick={run} loading={job.running} disabled={!checks.length}>
                <FileSearch className="size-4" /> Run CiteGuard
              </Button>
            </div>
          </div>
        )}
      </Card>

      <JobProgress state={job} label="CiteGuard" />

      {!report && !job.running && (
        <Empty icon={<ShieldCheck className="size-8" />} title="No audit yet">Upload a PDF or pick a sample, then run CiteGuard.</Empty>
      )}

      {report && (
        <div className="rise space-y-6">
          {ss?.retraction === "retracted" && (
            <AlarmBanner title="This paper itself has been retracted">
              Crossref lists retraction notice(s){" "}
              {ss.notices.map((d) => <ExtLink key={d} href={`https://doi.org/${d}`} className="mr-2 font-bold !text-white decoration-white">{d}</ExtLink>)}
              for {ss.doi}. It should not be cited or submitted.
            </AlarmBanner>
          )}
          {s.retracted_cited > 0 && (
            <AlarmBanner title={`${s.retracted_cited} cited work(s) have been retracted`}>
              See the flagged rows in References. The retraction notices are linked there, with the Crossref API response for each.
            </AlarmBanner>
          )}
          {report.warnings.map((w, i) => <Callout key={i} tone="warn">{w}</Callout>)}

          {report.references.length > 0 && (
            <Card className="overflow-hidden">
              <div className="flex flex-wrap items-end justify-between gap-3 px-5 pt-5">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Citation constellation</div>
                  <h3 className="text-lg font-semibold tracking-tight">Every reference, checked: in 3D</h3>
                  <p className="text-sm text-ink-2">The paper sits at the core and each reference orbits it. Bigger nodes are cited more often. Drag to orbit, click a node for its evidence.</p>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
                  <span className="inline-flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-full bg-good" />Verified (sphere)</span>
                  <span className="inline-flex items-center gap-1.5"><span className="inline-block size-2.5 rotate-45 bg-warn" />Mismatch (diamond)</span>
                  <span className="inline-flex items-center gap-1.5"><span className="inline-block size-2.5 bg-crit" />Not found (cube)</span>
                  <span className="inline-flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-full border border-muted" />Could not verify</span>
                  <span className="inline-flex items-center gap-1.5"><span className="inline-block size-2.5 rotate-45 bg-crit ring-2 ring-crit/40" />Retracted (pulsing)</span>
                </div>
              </div>
              <div className="stage plain m-4 h-[400px] !rounded-2xl">
                <Suspense fallback={<div className="absolute inset-0 shimmer" />}>
                  <CitationConstellation report={report} onPick={pickRef} reduced={!!reduced} />
                </Suspense>
              </div>
            </Card>
          )}

          <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
            <Card className="p-5">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Integrity score</div>
              <div className="my-3 flex justify-center">
                <ScoreRing key={report.audit_id} value={Math.round(report.score)} tone={tone} />
              </div>
              <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                {report.low_confidence && <Badge tone="warn">Low confidence</Badge>}
                {ss && <Badge tone={RET_TONE[ss.retraction]}>Paper itself: {RET_LABEL[ss.retraction]}</Badge>}
              </div>
              <div className="mt-5 space-y-3 border-t border-line pt-4">
                {report.score_terms.map((t) => (
                  <div key={t.name}>
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="font-medium">{t.name}</span>
                      <span className="tabular text-ink-2">{t.max > 0 ? `${t.value.toFixed(1)} / ${t.max}` : t.value.toFixed(1)}</span>
                    </div>
                    {t.max > 0 && <Meter value={t.value} max={t.max} tone={t.value / t.max >= 0.8 ? "good" : t.value / t.max >= 0.5 ? "warn" : "crit"} className="mt-1" />}
                    <div className="mt-1 font-mono text-[10.5px] text-muted">{t.formula}</div>
                    <div className="text-[10.5px] text-muted">{Object.entries(t.inputs).map(([k, v]) => `${k.replaceAll("_", " ")} ${v}`).join(" · ")}</div>
                  </div>
                ))}
                <p className="text-[10.5px] leading-relaxed text-muted">
                  Score = 100 × Σ available terms ÷ Σ their maxima, minus 15 per retracted citation. It is 0 if the paper itself is retracted.
                  Checks that couldn&apos;t run are excluded, not counted as passes.
                </p>
              </div>
            </Card>

            <div className="space-y-6">
              <motion.div className="grid grid-cols-2 gap-3 md:grid-cols-4" variants={stagger.container} initial="hidden" animate="show">
                {([
                  ["References verified", `${s.verified ?? 0}/${s.references ?? 0}`, (s.not_found ?? 0) > 0 ? "crit" : "good",
                    `${s.metadata_mismatch ?? 0} mismatch · ${s.not_found ?? 0} not found · ${s.could_not_verify ?? 0} unverifiable`],
                  ["Retracted citations", s.retracted_cited ?? 0, (s.retracted_cited ?? 0) > 0 ? "crit" : "good", `${s.corrected_cited ?? 0} corrected / EoC`],
                  ["Claims checked", s.claims ?? 0, (s.unsupported ?? 0) > 0 ? "crit" : "neutral",
                    `${s.supported ?? 0} supported · ${s.unclear ?? 0} unclear · ${s.unsupported ?? 0} unsupported`],
                  ["Phrases · overlap", `${s.phrases ?? 0} · ${s.overlaps ?? 0}`, (s.phrases ?? 0) > 0 ? "serious" : "neutral", "tortured phrases · possible-overlap paragraphs"],
                ] as [string, string | number, Tone, string][]).map(([label, value, t, sub]) => (
                  <motion.div key={label} variants={stagger.item}>
                    <TiltCard className="h-full rounded-xl">
                      <StatTile label={label} tone={t} sub={sub}
                        value={typeof value === "number" ? <AnimatedNumber value={value} /> : value} />
                    </TiltCard>
                  </motion.div>
                ))}
              </motion.div>

              <Card className="overflow-hidden">
                <div className="flex flex-wrap items-center gap-1 border-b border-line px-3 py-2">
                  {([
                    ["references", `References (${report.references.length})`], ["claims", `Claims (${report.claims.length})`],
                    ["phrases", `Phrases (${report.phrases.length})`], ["overlap", `Overlap (${report.overlaps.length})`], ["document", "Highlighted text"],
                  ] as [View, string][]).map(([v, l]) => (
                    <button key={v} onClick={() => setView(v)}
                      className={clsx("rounded-lg px-3 py-1.5 text-sm transition", view === v ? "bg-surface-3 font-medium text-ink" : "text-ink-2 hover:text-ink")}>
                      {l}
                    </button>
                  ))}
                </div>

                {view === "references" && (
                  <div>
                    <div className="flex flex-wrap gap-1.5 px-4 py-3">
                      {(["all", "flagged", "verified", "metadata_mismatch", "not_found", "could_not_verify"] as const).map((f) => (
                        <button key={f} onClick={() => setFilter(f)}
                          className={clsx("rounded-full border px-2.5 py-0.5 text-xs", filter === f ? "border-accent bg-accent-soft text-accent-ink" : "border-line text-ink-2")}>
                          {f === "all" ? "All" : f === "flagged" ? "Flagged" : REF_LABEL[f]}
                        </button>
                      ))}
                    </div>
                    <div className="max-h-[640px] overflow-auto">
                      <table className="w-full">
                        <thead className="sticky top-0 z-10 bg-surface-2 text-left text-[11px] uppercase tracking-wider text-muted">
                          <tr><th className="px-4 py-2 font-medium">Ref</th><th className="px-2 py-2 font-medium">Work</th><th className="px-2 py-2 font-medium">Existence</th><th className="px-2 py-2 font-medium">Retraction</th><th /></tr>
                        </thead>
                        <tbody>{refsShown.map((r) => <RefRow key={`${r.ref_index}-${focusRef === r.ref_index}`} r={r} initiallyOpen={focusRef === r.ref_index} />)}</tbody>
                      </table>
                      {refsShown.length === 0 && <div className="px-4 py-8 text-center text-sm text-muted">Nothing in this filter.</div>}
                    </div>
                  </div>
                )}

                {view === "claims" && (
                  <div className="max-h-[720px] space-y-3 overflow-auto p-4">
                    {report.claims.length === 0 && <div className="py-8 text-center text-sm text-muted">No in-text citations could be linked to references.</div>}
                    {report.claims.map((c, i) => <ClaimCard key={i} c={c} n={i} refLabel={labelOf(c.ref_index)} />)}
                  </div>
                )}

                {view === "phrases" && (
                  <div className="space-y-3 p-4">
                    {report.phrases.length === 0 && <div className="py-8 text-center text-sm text-muted">No phrases from the tortured-phrase list were found.</div>}
                    {report.phrases.map((h, i) => (
                      <div key={i} id={`phrase-${i}`} className="rounded-xl border border-line p-4">
                        <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                          <Badge tone="serious">“{h.phrase}”</Badge><span className="text-muted">→ expected</span><b>{h.expected}</b>
                          <span className="text-xs text-muted">p.{h.page + 1}</span>
                          {!h.verified_by && <Badge tone="neutral" icon={false}>list entry pending team verification</Badge>}
                        </div>
                        <p className="rounded-lg bg-surface-2 p-3 text-sm text-ink-2">…{h.context}…</p>
                        <div className="mt-2 text-xs text-muted">Source: <ExtLink href={h.source_url}>{h.source}</ExtLink></div>
                      </div>
                    ))}
                  </div>
                )}

                {view === "overlap" && (
                  <div className="space-y-3 p-4">
                    <Callout tone="accent">These are <b>possible overlap</b> hotspots: paragraphs semantically very close to a cited or related abstract. They point to where a human should look. They are not a plagiarism finding.</Callout>
                    {report.overlaps.length === 0 && <div className="py-6 text-center text-sm text-muted">No paragraph crossed the similarity threshold.</div>}
                    {report.overlaps.map((o, i) => (
                      <div key={i} id={`overlap-${i}`} className="rounded-xl border border-line p-4">
                        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
                          <Badge tone="accent">Possible overlap · {o.similarity.toFixed(2)}</Badge>
                          <span className="text-muted">p.{o.page + 1} · {o.relation} work:</span>
                          <ExtLink href={o.matched.doi ? `https://doi.org/${o.matched.doi}` : o.matched.url}>{o.matched.title}</ExtLink>
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="rounded-lg bg-surface-2 p-3 text-sm leading-relaxed"><div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted">This paper</div>{o.paragraph}</div>
                          <div className="rounded-lg bg-surface-2 p-3 text-sm leading-relaxed text-ink-2"><div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted">Closest sentence in matched abstract</div>{o.matched_text}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {view === "document" && <div className="p-4"><DocumentView report={report} pages={pages} onPick={pick} /></div>}
              </Card>

              <div className="flex flex-wrap justify-end gap-2">
                <a href={`${API}/api/citeguard/audits/${report.audit_id}/report.md`}
                  className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-3.5 py-2 text-sm font-medium transition hover:border-line-strong hover:bg-surface-2">
                  <Download className="size-4" /> Download report
                </a>
                <Button variant="primary" onClick={onVerdict}><Gavel className="size-4" /> Get the Go / No-Go verdict <ArrowRight className="size-4" /></Button>
              </div>
            </div>
          </div>
          {ss && ss.retraction !== "retracted" && (
            <details className="card px-5 py-3 text-sm">
              <summary className="flex cursor-pointer items-center gap-2 font-medium"><ShieldAlert className="size-4 text-muted" />Self-status evidence (is this paper itself retracted?)</summary>
              <div className="mt-3"><EvidenceList items={ss.evidence} /></div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
