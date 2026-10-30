"use client";

import clsx from "clsx";
import { BookOpen, Bot, CheckCircle2, CircleAlert, ClipboardCheck, Download, Gavel, ListChecks, OctagonX, RotateCcw, Scale, UserRound } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { API, api, useJob } from "@/lib/api";
import type { DocumentInfo, Health, Verdict } from "@/lib/types";
import { scoreTone } from "./AuditTab";
import { Confetti } from "./Confetti";
import { AnimatedNumber, TiltCard } from "./motion";
import { Badge, Button, Callout, Card, Empty, ExtLink, Field, Input, JobProgress, Meter, SectionTitle, Select } from "./ui";

const DECISION = {
  submit: { label: "Submit", tone: "good" as const, icon: CheckCircle2, cls: "border-edge bg-lime text-[#121212]", blurb: "Jury and integrity checks clear the bar." },
  revise: { label: "Revise", tone: "warn" as const, icon: RotateCcw, cls: "border-edge bg-yellow text-[#121212]", blurb: "Fix the ranked issues below before submitting." },
  dont_submit: { label: "Don't submit", tone: "crit" as const, icon: OctagonX, cls: "border-edge bg-crit text-white", blurb: "A blocking rule fired. See the reasoning." },
};

const VENUES = ["", "IEEE Access", "NeurIPS workshop", "ACL Findings", "Scientific Reports", "PLOS ONE", "ICLR (main track)", "arXiv preprint only"];

export function VerdictTab({
  documentId, auditId, reviewId, setReviewId, health, goAudit,
}: {
  documentId: string | null; auditId: string | null; reviewId: string | null; setReviewId: (id: string) => void;
  health: Health | null; goAudit: () => void;
}) {
  const [venue, setVenue] = useState("");
  const [customVenue, setCustomVenue] = useState("");
  const [doc, setDoc] = useState<DocumentInfo | null>(null);
  const [v, setV] = useState<Verdict | null>(null);
  const job = useJob();

  useEffect(() => { if (documentId) api.get<DocumentInfo>(`/api/documents/${documentId}`).then(setDoc).catch(() => setDoc(null)); }, [documentId]);
  useEffect(() => { if (reviewId) api.get<Verdict>(`/api/jury/reviews/${reviewId}`).then(setV).catch(() => setV(null)); }, [reviewId]);

  const chosenVenue = venue === "__custom" ? customVenue : venue;
  const run = () =>
    job.start(() => api.post("/api/jury/reviews", { document_id: documentId, audit_id: auditId, venue: chosenVenue || null }), setReviewId, "Jury verdict");

  const d = v ? DECISION[v.decision] : null;
  const blocking = v?.ranked_fixes.some((f) => f.blocking && f.source === "citeguard");
  const integrityTone = v?.integrity != null ? (blocking && scoreTone(v.integrity) === "good" ? "warn" : scoreTone(v.integrity)) : "neutral";
  const stale = v && v.document_id !== documentId;

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <SectionTitle eyebrow="Step 4 · Reviewer Jury" title="Is it ready to submit, and where?">
          Four reviewer personas (Methods, Novelty, Clarity, Ethics &amp; Reproducibility) plus an optional venue persona each score the paper.
          The aggregator combines their scores with CiteGuard into Submit / Revise / Don&apos;t submit, using fixed rules shown below.
        </SectionTitle>
        {!documentId ? (
          <Callout tone="accent" title="No paper selected">Upload or pick a paper in <button className="font-semibold underline" onClick={goAudit}>Audit</button> first.</Callout>
        ) : (
          <div className="grid gap-3 md:grid-cols-[1fr_220px_auto] md:items-end">
            <div className="min-w-0">
              <div className="text-xs font-medium text-ink-2">Paper</div>
              <div className="truncate font-medium">{doc?.title ?? doc?.filename ?? documentId}</div>
              <div className="text-xs text-muted">
                {auditId ? "CiteGuard audit attached" : <>No CiteGuard audit yet. A <b>Submit</b> verdict requires one: <button className="underline" onClick={goAudit}>run it</button></>}
              </div>
            </div>
            <Field label="Target venue (optional persona)">
              <Select value={venue} onChange={(e) => setVenue(e.target.value)} className="w-full">
                {VENUES.map((x) => <option key={x} value={x}>{x || "No venue persona"}</option>)}
                <option value="__custom">Other…</option>
              </Select>
            </Field>
            <Button variant="primary" onClick={run} loading={job.running}><Gavel className="size-4" /> Convene the jury</Button>
            {venue === "__custom" && (
              <div className="md:col-span-3"><Input placeholder="Venue name" value={customVenue} onChange={(e) => setCustomVenue(e.target.value)} /></div>
            )}
          </div>
        )}
        {health && !health.llm.available && (
          <div className="mt-4"><Callout tone="warn" title="AI reviewers offline: checklist reviewer only">
            The rule-based checklist and CiteGuard still run, but the four AI content reviewers are offline right now.
            Without a content reviewer, the verdict can be at best <b>Revise</b>.
          </Callout></div>
        )}
        {health?.llm.local && (
          <div className="mt-4 text-xs text-muted">
            Reviewers run on this device. Expect a few minutes per review; identical re-runs are cached.
          </div>
        )}
      </Card>

      <JobProgress state={job} label="Reviewer jury" />

      {!v && !job.running && <Empty icon={<Scale className="size-8" />} title="No verdict yet">Convene the jury to get a decision with reasons and a ranked fix list.</Empty>}

      {v && d && (
        <div className="rise space-y-6">
          {stale && <Callout tone="warn">This verdict is for a different paper than the one selected. Convene the jury again to refresh it.</Callout>}
          <motion.div key={v.review_id} className={clsx("sheen relative overflow-visible rounded-3xl border-[3px] p-7 shadow-[8px_8px_0_var(--shadow-c)]", d.cls)}
            initial={{ opacity: 0, scale: 0.9, rotateX: 18, y: 20 }} animate={{ opacity: 1, scale: 1, rotateX: 0, y: 0 }}
            transition={{ type: "spring", stiffness: 160, damping: 18 }} style={{ transformPerspective: 1000 }}>
            {v.decision === "submit" && <Confetti />}
            <div className="flex flex-wrap items-center justify-between gap-6">
              <div className="flex items-center gap-5">
                <div className="relative grid size-16 shrink-0 place-items-center">
                  <span className="pulse-ring absolute inset-0 rounded-full bg-current opacity-30" />
                  <motion.span initial={{ scale: 0, rotate: -120 }} animate={{ scale: 1, rotate: 0 }}
                    transition={{ type: "spring", stiffness: 220, damping: 14, delay: 0.15 }}
                    className="relative grid size-16 place-items-center rounded-full border-[3px] border-[#121212] bg-white text-[#121212] shadow-[3px_3px_0_#121212]">
                    <d.icon className="size-8" strokeWidth={2} />
                  </motion.span>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] opacity-80">Verdict</div>
                  <motion.div className="font-display text-6xl font-extrabold tracking-tight" initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.25, duration: 0.5 }}>
                    {d.label}
                  </motion.div>
                  <div className="text-sm opacity-90">{d.blurb}</div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-6">
                <a href={`${API}/api/jury/reviews/${v.review_id}/report.md`} className="btn-brut inline-flex items-center gap-1.5 rounded-xl bg-white px-3 py-2 font-display text-xs font-extrabold text-[#121212]">
                  <Download className="size-3.5" /> Report
                </a>
                <div className="rounded-2xl border-2 border-[#121212] bg-white/90 px-4 py-2 text-[#121212] shadow-[3px_3px_0_#121212]">
                  <div className="text-[10.5px] font-bold uppercase tracking-wider opacity-70">Jury (weighted)</div>
                  <div className="font-display text-3xl font-extrabold">{v.weighted_mean != null ? <AnimatedNumber value={v.weighted_mean} decimals={1} /> : "—"}<span className="text-sm font-bold opacity-65"> /10</span></div>
                </div>
                <div className="rounded-2xl border-2 border-[#121212] bg-white/90 px-4 py-2 text-[#121212] shadow-[3px_3px_0_#121212]">
                  <div className="text-[10.5px] font-bold uppercase tracking-wider opacity-70">Integrity</div>
                  <div className={clsx("font-display text-3xl font-extrabold", v.integrity != null && { good: "text-[#0b6b35]", warn: "text-[#7a5600]", crit: "text-[#b01818]" }[integrityTone as "good"])}>
                    {v.integrity != null ? <AnimatedNumber value={v.integrity} /> : "—"}<span className="text-sm font-bold text-[#121212]/65"> /100</span>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>

          {v.llm?.provider && v.llm.provider !== "none" && (
            <div className="-mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
              <Bot className="size-3.5" /> Reviewed by the <b className="text-ink-2">Azora reviewer panel</b>
              {v.llm.condensed && <Badge tone="warn" icon={false}>read a condensed {Math.round((v.llm.chars_read ?? 0) / 1000)}k of {Math.round((v.llm.chars_total ?? 0) / 1000)}k characters (opening + ending)</Badge>}
            </div>
          )}

          <div className="grid gap-6 xl:grid-cols-[1fr_1.2fr]">
            <Card className="p-5">
              <div className="mb-3 flex items-center gap-2 font-semibold"><Scale className="size-4 text-muted" /> Reasoning</div>
              <ul className="space-y-2">
                {v.triggered_rules.map((r, i) => (
                  <motion.li key={i} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 + i * 0.1 }}
                    className="flex gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm"><span className="text-accent">→</span>{r}</motion.li>
                ))}
              </ul>
              <details className="mt-4 text-xs text-ink-2">
                <summary className="cursor-pointer font-medium text-ink">All decision rules (evaluated in order)</summary>
                <ol className="mt-2 list-decimal space-y-1 pl-5">{v.rules.map((r) => <li key={r}>{r}</li>)}</ol>
                <p className="mt-2 text-muted">Weighted mean = Σ(score × confidence) ÷ Σ confidence over personas that returned a review.</p>
              </details>
            </Card>

            <Card className="p-5">
              <div className="mb-3 flex items-center gap-2 font-semibold"><ListChecks className="size-4 text-muted" /> Ranked fix list</div>
              {v.ranked_fixes.length === 0 && <div className="text-sm text-muted">No fixes proposed.</div>}
              <ol className="max-h-[420px] space-y-2 overflow-auto pr-1">
                {v.ranked_fixes.map((f, i) => (
                  <motion.li key={f.rank} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 + Math.min(i, 10) * 0.06 }}
                    className={clsx("flex gap-3 rounded-lg border px-3 py-2.5 transition hover:border-line-strong hover:bg-surface-2",
                      f.blocking ? "border-crit/40 bg-crit-soft/40" : "border-line")}>
                    <span className="tabular mt-0.5 w-5 shrink-0 text-right text-xs font-semibold text-muted">{f.rank}</span>
                    <div className="min-w-0 flex-1 text-sm">
                      <div className="leading-snug">{f.fix}</div>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {f.blocking && <Badge tone="crit">Blocking</Badge>}
                        <Badge tone={f.source === "citeguard" ? "accent" : "neutral"} icon={false}>{f.source}</Badge>
                      </div>
                    </div>
                  </motion.li>
                ))}
              </ol>
            </Card>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {v.personas.map((p, i) => (
              <motion.div key={`${v.review_id}-${p.persona}`} initial={{ opacity: 0, rotateY: 180, y: 16 }} animate={{ opacity: 1, rotateY: 0, y: 0 }}
                transition={{ delay: 0.45 + i * 0.16, type: "spring", stiffness: 110, damping: 15 }}
                style={{ transformPerspective: 1000, backfaceVisibility: "hidden" }}>
              <TiltCard className="h-full rounded-[14px]">
              <Card className="flex h-full flex-col p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-semibold"><UserRound className="size-4 text-muted" />{p.persona}</div>
                  {p.score != null && <div className="text-2xl font-semibold"><AnimatedNumber value={p.score} /><span className="text-sm text-muted">/10</span></div>}
                </div>
                {p.error ? (
                  <Callout tone="neutral" title="Not assessed">{p.error}</Callout>
                ) : (
                  <>
                    <Meter value={p.score ?? 0} max={10} tone={(p.score ?? 0) >= 7 ? "good" : (p.score ?? 0) >= 5 ? "warn" : "crit"} />
                    <div className="mt-1 text-[11px] text-muted">confidence {((p.confidence ?? 0) * 100).toFixed(0)}%</div>
                    {p.summary && <p className="mt-2 text-sm text-ink-2">{p.summary}</p>}
                    <div className="mt-3 text-[10px] font-semibold uppercase tracking-wider text-muted">Weaknesses</div>
                    <ul className="mt-1 list-disc space-y-1 pl-4 text-sm">{p.weaknesses.map((w, i) => <li key={i}>{w}</li>)}</ul>
                    <div className="mt-3 text-[10px] font-semibold uppercase tracking-wider text-muted">Fixes</div>
                    <ul className="mt-1 list-disc space-y-1 pl-4 text-sm text-ink-2">{p.fixes.map((w, i) => <li key={i}>{w}</li>)}</ul>
                  </>
                )}
              </Card>
              </TiltCard>
              </motion.div>
            ))}
          </div>

          {v.checklist?.length > 0 && (
            <Card className="p-5">
              <div className="mb-1 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-semibold"><ClipboardCheck className="size-4 text-muted" /> Readiness checklist</div>
                <span className="tabular text-sm text-ink-2">{v.checklist.filter((c) => c.passed).length}/{v.checklist.length} passed</span>
              </div>
              <p className="mb-4 text-sm text-ink-2">Deterministic checks for evidence in the text. They check structure and reporting, not scientific quality.</p>
              <div className="grid gap-2 md:grid-cols-2">
                {v.checklist.map((c, i) => (
                  <motion.div key={c.name} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 + i * 0.04 }}
                    className={clsx("flex gap-3 rounded-xl border p-3", c.passed ? "border-good/30 bg-good-soft/50" : "border-warn/40 bg-warn-soft/50")}>
                    {c.passed ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-good" /> : <CircleAlert className="mt-0.5 size-4 shrink-0 text-warn" />}
                    <div className="min-w-0 text-sm">
                      <div className="font-medium">{c.name}</div>
                      <div className="text-xs text-ink-2">{c.detail}</div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </Card>
          )}

          <Card className="p-5">
            <div className="mb-1 flex items-center gap-2 font-semibold"><BookOpen className="size-4 text-muted" /> Where similar work was published</div>
            <p className="mb-4 text-sm text-ink-2">Venues of the closest real papers on OpenAlex (repositories like arXiv excluded). This is evidence of fit, not a guarantee of acceptance.</p>
            {v.venue_suggestions.length === 0 ? <div className="text-sm text-muted">No venue data found.</div> : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {v.venue_suggestions.map((s) => (
                  <TiltCard key={s.venue} className="rounded-xl" max={5}>
                  <div className="h-full rounded-xl border border-line bg-surface p-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <ExtLink href={s.openalex_source_id ? `https://openalex.org/${s.openalex_source_id}` : null} className="font-medium">{s.venue}</ExtLink>
                      <span className="tabular shrink-0 text-xs text-muted">{s.count} similar</span>
                    </div>
                    <ul className="mt-1.5 space-y-0.5 text-xs text-ink-2">{s.example_titles.map((t) => <li key={t} className="truncate">· {t}</li>)}</ul>
                  </div>
                  </TiltCard>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
