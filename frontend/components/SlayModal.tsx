"use client";

import clsx from "clsx";
import { Check, FilePen, FileUp, Gavel, Loader2, ShieldCheck, Sparkles, X, Zap } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { api, useJob } from "@/lib/api";
import type { AuditReport, DocumentInfo, Health, PipelineResult, Verdict } from "@/lib/types";
import { Badge, Button, Callout, Field, Input, Select } from "./ui";
import { useAuth } from "./auth/AuthProvider";

const PHASES = [
  { key: "draft", label: "Draft", sub: "AI drafting engine", icon: FilePen },
  { key: "audit", label: "Audit", sub: "CiteGuard", icon: ShieldCheck },
  { key: "verdict", label: "Verdict", sub: "Reviewer Jury", icon: Gavel },
] as const;
const VENUES = ["", "IEEE Access", "NeurIPS workshop", "ACL Findings", "Scientific Reports", "PLOS ONE"];
const DECISION = {
  submit: { label: "Submit", cls: "bg-good-soft text-good-ink border-good/40" },
  revise: { label: "Revise", cls: "bg-warn-soft text-warn-ink border-warn/50" },
  dont_submit: { label: "Don't submit", cls: "bg-crit-soft text-crit-ink border-crit/40" },
};

export function SlayModal({
  open, onClose, health, defaultTopic, defaultDocumentId, onOpenResult,
}: {
  open: boolean; onClose: () => void; health: Health | null; defaultTopic: string; defaultDocumentId: string | null;
  onOpenResult: (r: PipelineResult, tab: "audit" | "verdict") => void;
}) {
  const { me } = useAuth();
  const founder = !!me?.is_owner;
  const [pick, setSource] = useState<"draft" | "paper">("draft");
  // Users write new papers in Paper Studio; the cached drafting replay is a founder-only tool.
  const source = founder ? pick : "paper";
  const [topicEdit, setTopicEdit] = useState<string | null>(null);
  const topic = topicEdit ?? defaultTopic;
  const setTopic = (v: string) => setTopicEdit(v);
  const [demo, setDemo] = useState(true);
  const [docOverride, setDocOverride] = useState<string | null>(null);
  const [samples, setSamples] = useState<DocumentInfo[]>([]);
  const docId = docOverride ?? defaultDocumentId ?? samples[0]?.document_id ?? null;
  const setDocId = (v: string | null) => setDocOverride(v);
  const [venue, setVenue] = useState("");
  const [result, setResult] = useState<{ p: PipelineResult; v: Verdict; a: AuditReport } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const job = useJob();

  useEffect(() => {
    if (!open) return;
    api.get<DocumentInfo[]>("/api/documents/samples").then(setSamples).catch(() => {});
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !job.running && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [job.running, onClose]);

  const last = job.events[job.events.length - 1];
  const phaseNow = last?.stage.split(":")[0];
  const order = PHASES.map((p) => p.key) as string[];
  const startIdx = source === "paper" ? 1 : 0;
  const status = (key: string) => {
    if (result) return "done";
    if (!job.running) return "pending";
    const i = order.indexOf(key), cur = order.indexOf(phaseNow ?? "");
    return cur > i ? "done" : cur === i ? "running" : "pending";
  };

  const start = () => {
    setResult(null);
    job.start(
      () => api.post("/api/pipeline", source === "draft" ? { topic, demo, venue: venue || null } : { document_id: docId, venue: venue || null }),
      async (pid) => {
        const p = await api.get<PipelineResult>(`/api/pipeline/${pid}`);
        const [v, a] = await Promise.all([api.get<Verdict>(`/api/jury/reviews/${p.review_id}`), api.get<AuditReport>(`/api/citeguard/audits/${p.audit_id}`)]);
        setResult({ p, v, a });
      },
      "Slay pipeline",
    );
  };

  const upload = async (f: File) => {
    try {
      const info = await api.upload<DocumentInfo>("/api/documents", f);
      setSamples((xs) => [info, ...xs.filter((x) => x.document_id !== info.document_id)]);
      setDocId(info.document_id);
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const canStart = source === "draft" ? topic.trim().length > 3 : !!docId;

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 grid place-items-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-black/55 backdrop-blur-sm" onClick={() => !job.running && onClose()} />
          <motion.div role="dialog" aria-modal aria-label="Slay it: full pipeline"
            initial={{ opacity: 0, y: 30, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 20, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 260, damping: 26 }}
            className="card relative max-h-[92vh] w-full max-w-2xl overflow-auto p-6 !bg-surface">
            <button onClick={onClose} disabled={job.running} aria-label="Close" className="absolute right-4 top-4 rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-30">
              <X className="size-4" />
            </button>
            <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-accent-ink">
              <Zap className="size-3.5" /> One click
            </div>
            <h2 className="text-2xl font-semibold tracking-tight">{founder ? "Slay it: draft → audit → verdict" : "Slay it: audit → verdict"}</h2>
            <p className="mt-1 text-sm text-ink-2">Runs the whole decision pipeline as one job, then opens the result.</p>

            {!job.running && !result && (
              <div className="mt-5 space-y-4">
                {!founder && <p className="rounded-xl border border-line bg-surface-2 px-3 py-2 text-xs text-ink-2">Pick a paper to audit and score. To write a brand-new paper, use <b>Paper Studio</b>.</p>}
                <div className={clsx("grid grid-cols-2 gap-2", !founder && "hidden")}>
                  {([["draft", "Draft a new paper", "AI writes it, then we check it", FilePen], ["paper", "Check an existing paper", "Any PDF or a bundled sample", FileUp]] as const).map(([k, t, d, Icon]) => (
                    <button key={k} onClick={() => setSource(k)}
                      className={clsx("rounded-xl border p-3 text-left transition", source === k ? "border-accent bg-accent-soft" : "border-line hover:border-line-strong")}>
                      <Icon className="mb-1.5 size-4 text-accent" />
                      <div className="text-sm font-medium">{t}</div>
                      <div className="text-xs text-muted">{d}</div>
                    </button>
                  ))}
                </div>
                {source === "draft" ? (
                  <>
                    <Field label="Research topic"><Input value={topic} onChange={(e) => setTopic(e.target.value)} /></Field>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} className="size-4 accent-[var(--accent)]" />
                      Demo mode <span className="text-xs text-muted">replays a real cached draft (live runs take about an hour)</span>
                    </label>
                  </>
                ) : (
                  <div className="space-y-1.5">
                    <div className="max-h-48 space-y-1.5 overflow-auto">
                      {samples.map((d) => (
                        <button key={d.document_id} onClick={() => setDocId(d.document_id)}
                          className={clsx("flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm transition",
                            d.document_id === docId ? "border-accent bg-accent-soft" : "border-line hover:border-line-strong")}>
                          <span className="min-w-0 flex-1 truncate">{d.title ?? d.filename}</span>
                          <span className="shrink-0 text-xs text-muted">{d.n_references} refs</span>
                        </button>
                      ))}
                    </div>
                    <input ref={fileRef} type="file" accept=".pdf,.txt" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
                    <Button variant="ghost" onClick={() => fileRef.current?.click()}><FileUp className="size-4" /> Upload a PDF…</Button>
                  </div>
                )}
                <Field label="Target venue (optional)">
                  <Select value={venue} onChange={(e) => setVenue(e.target.value)} className="w-full">
                    {VENUES.map((x) => <option key={x} value={x}>{x || "No venue persona"}</option>)}
                  </Select>
                </Field>
                {health && (
                  <div className="text-xs text-muted">
                    Reviewers: {health.llm.available ? "AI reviewer panel + rule-based checklist" : "rule-based checklist only (AI offline)"}
                    {health.llm.local && " · local models take a few minutes; re-runs are cached"}
                  </div>
                )}
                {job.error && <Callout tone="crit" title="Pipeline failed">{job.error}</Callout>}
                <Button variant="primary" className="w-full !py-3 text-base" onClick={start} disabled={!canStart}>
                  <Sparkles className="size-4" /> Slay it
                </Button>
              </div>
            )}

            {(job.running || result) && (
              <div className="mt-6">
                <ol className="grid grid-cols-3 gap-3">
                  {PHASES.map((ph, i) => {
                    const st = i < startIdx ? "skipped" : status(ph.key);
                    return (
                      <li key={ph.key} className={clsx("relative rounded-xl border p-3 transition",
                        st === "running" && "border-accent bg-accent-soft shadow-[0_0_30px_-10px_var(--accent)]",
                        st === "done" && "border-good/40 bg-good-soft",
                        (st === "pending" || st === "skipped") && "border-line opacity-60")}>
                        <div className="mb-1 flex items-center gap-2">
                          {st === "done" ? <Check className="size-4 text-good-ink" /> : st === "running" ? <Loader2 className="size-4 animate-spin text-accent" /> : <ph.icon className="size-4 text-muted" />}
                          <span className="text-sm font-semibold">{ph.label}</span>
                        </div>
                        <div className="text-xs text-muted">{st === "skipped" ? "existing paper" : ph.sub}</div>
                      </li>
                    );
                  })}
                </ol>
                {job.running && (
                  <div className="mt-4">
                    <div className="mb-1.5 flex justify-between text-xs text-ink-2">
                      <span className="truncate pr-3">{last?.message ?? "Starting…"}</span>
                      <span className="tabular">{Math.round((last?.progress ?? 0) * 100)}%</span>
                    </div>
                    <div className="relative h-2 overflow-hidden rounded-full bg-surface-3">
                      <motion.div className="h-full rounded-full bg-gradient-to-r from-[var(--accent)] to-[var(--series-3)]"
                        animate={{ width: `${Math.max(3, (last?.progress ?? 0) * 100)}%` }} transition={{ duration: 0.6 }} />
                      <div className="shimmer absolute inset-0" />
                    </div>
                  </div>
                )}
                {result && (
                  <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="mt-5 space-y-4">
                    <div className={clsx("sheen flex items-center justify-between rounded-2xl border p-5", DECISION[result.v.decision].cls)}>
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.16em] opacity-80">Verdict</div>
                        <div className="text-3xl font-semibold tracking-tight">{DECISION[result.v.decision].label}</div>
                        <div className="mt-0.5 max-w-sm text-xs opacity-90">{result.v.triggered_rules[0]}</div>
                      </div>
                      <div className="text-right text-ink">
                        <div className="text-[11px] uppercase tracking-wider text-muted">Integrity</div>
                        <div className="text-3xl font-semibold">{result.a.score.toFixed(0)}<span className="text-sm text-muted">/100</span></div>
                        {result.v.weighted_mean != null && <div className="text-xs text-muted">jury {result.v.weighted_mean.toFixed(1)}/10</div>}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs">
                      <Badge tone={(result.a.summary.not_found ?? 0) > 0 ? "crit" : "good"}>{result.a.summary.verified}/{result.a.summary.references} references verified</Badge>
                      {(result.a.summary.retracted_cited ?? 0) > 0 && <Badge tone="crit">{result.a.summary.retracted_cited} retracted citation(s)</Badge>}
                      <Badge tone="accent">{result.v.ranked_fixes.length} ranked fixes</Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Button onClick={() => onOpenResult(result.p, "audit")}><ShieldCheck className="size-4" /> Open audit</Button>
                      <Button variant="primary" onClick={() => onOpenResult(result.p, "verdict")}><Gavel className="size-4" /> Open verdict</Button>
                    </div>
                    <button className="w-full text-center text-xs text-muted hover:text-ink" onClick={() => setResult(null)}>Run another</button>
                  </motion.div>
                )}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
