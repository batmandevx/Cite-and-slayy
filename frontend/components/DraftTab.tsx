"use client";

import { useAuth } from "./auth/AuthProvider";

import clsx from "clsx";
import { ArrowRight, Check, FileText, Play, Terminal } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { API, api, useJob, writePersistent } from "@/lib/api";
import type { AutoClawRun, Health } from "@/lib/types";
import { Badge, Button, Callout, Card, Empty, Field, Input, JobProgress, SectionTitle, Select } from "./ui";

const PHASES: [string, number[]][] = [
  ["Scoping", [1, 2]], ["Literature", [3, 4, 5, 6]], ["Synthesis", [7, 8]], ["Design", [9, 10, 11]],
  ["Experiments", [12, 13]], ["Analysis", [14, 15]], ["Writing", [16, 17, 18, 19]], ["Finalise", [20, 21, 22, 23]],
];

export function DraftTab({
  topic, setTopic, health, onAudit, onStudio,
}: { topic: string; setTopic: (t: string) => void; health: Health | null; onAudit: (documentId: string) => void; onStudio?: () => void }) {
  const { me, config } = useAuth();
  const founder = !config?.auth_required || !!me?.is_owner;
  const [mode, setMode] = useState<"auto" | "co-pilot" | "gate-only" | "express">("auto");
  const [demoChoice, setDemo] = useState<boolean | null>(null);
  const live = !!health?.drafting_live;                 // is the external drafting CLI installed on this server?
  const demo = live ? (demoChoice ?? health?.demo_mode ?? true) : true;
  const [run, setRun] = useState<AutoClawRun | null>(null);
  const job = useJob();

  useEffect(() => { api.get<AutoClawRun | null>("/api/autoclaw/latest").then((r) => r && setRun(r)).catch(() => {}); }, []);

  // Poll the stored run while the job streams, so the stage grid and log update live.
  // A live run keeps going on the server even if this page's connection drops, so keep polling it while it runs.
  const liveRunning = !!run && !run.demo && run.status === "running";
  useEffect(() => {
    if (!job.running && !liveRunning) return;
    const t = setInterval(() => {
      api.get<AutoClawRun | null>("/api/autoclaw/latest").then((r) => r && setRun(r)).catch(() => {});
    }, job.running ? 600 : 8000);
    return () => clearInterval(t);
  }, [job.running, liveRunning]);

  const start = () =>
    job.start(
      () => api.post("/api/autoclaw/runs", { topic, mode, demo }),
      (id) => api.get<AutoClawRun>(`/api/autoclaw/runs/${id}`).then(setRun),
      "Draft",
    );

  if (!founder) {
    return (
      <Card className="grid place-items-center p-10 text-center">
        <div className="max-w-md">
          <div className="text-5xl">✍️</div>
          <h3 className="mt-3 font-display text-2xl font-extrabold">Drafting happens in Paper Studio</h3>
          <p className="mt-2 text-sm text-ink-2">Give it your topic and Paper Studio&apos;s agents write the full paper with verified references, figures and equations. Then come back here to audit and score it.</p>
          <Button variant="primary" className="mt-5" onClick={onStudio}><Play className="size-4" />Open Paper Studio</Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <SectionTitle eyebrow="Step 2 · Draft" title="Turn the question into a paper draft">
          Our autonomous drafting engine runs a 23-stage research pipeline (literature, hypotheses, experiments, writing) and streams every stage here.
          Want a fully referenced paper in minutes instead? Use Paper Studio.
        </SectionTitle>
        <div className="grid gap-3 md:grid-cols-[1fr_240px_auto] md:items-end">
          <Field label="Research topic">
            <Input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Pick a question in Explore, or type your own" />
          </Field>
          <Field label="Mode">
            <Select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)} className="w-full">
              <option value="auto">Autonomous (--auto-approve)</option>
              <option value="co-pilot">Co-pilot</option>
              <option value="gate-only">Gate-only</option>
              <option value="express">Express</option>
            </Select>
          </Field>
          <Button variant="primary" onClick={start} loading={job.running} disabled={!topic.trim()}>
            <Play className="size-4" /> {demo ? "Replay demo run" : "Run drafting engine"}
          </Button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
          <label className={clsx("inline-flex items-center gap-2", live ? "cursor-pointer" : "cursor-not-allowed opacity-70")}>
            <input type="checkbox" checked={demo} disabled={!live} onChange={(e) => setDemo(e.target.checked)} className="size-4 accent-[var(--accent)]" />
            <span>Demo mode</span>
            <span className="text-xs text-muted">{live ? "replays a real cached run instead of a ~1h live run" : "live runs aren't installed on this server, so this replays a real cached run"}</span>
          </label>
          <Button variant="lime" className="!py-1.5 text-xs" onClick={() => { writePersistent("studioTopic", topic); onStudio?.(); }} disabled={!topic.trim()}>
            <Play className="size-3.5" />Write it live in Paper Studio
          </Button>
        </div>
        {!demo && (
          <div className="mt-3">
            <Callout tone="accent" title="Live run requirements">
              Live runs take about an hour and need the drafting engine enabled on the server. Co-pilot and gate modes pause for
              approvals from the server operator.
            </Callout>
          </div>
        )}
      </Card>

      <JobProgress state={job} label="Drafting engine" />

      {!run && !job.running && <Empty icon={<FileText className="size-8" />} title="No draft yet">Run the drafting engine or replay the demo run.</Empty>}

      {run && (
        <div className="rise grid gap-6 xl:grid-cols-[1.4fr_1fr]">
          <Card className="p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="mb-1 flex items-center gap-2">
                  {run.demo ? <Badge tone="warn">Demo replay</Badge> : <Badge tone="accent">Live run</Badge>}
                  {!run.demo && run.spend_inr != null && <Badge tone="neutral">₹{Math.round(run.spend_inr)} AI spend</Badge>}
                  <Badge tone={run.status === "done" ? "good" : run.status === "error" ? "crit" : "neutral"}>{run.status}</Badge>
                </div>
                <div className="truncate text-sm text-ink-2">Topic: <span className="text-ink">{run.topic}</span></div>
              </div>
            </div>
            <div className="space-y-3">
              {PHASES.map(([phase, nums]) => (
                <div key={phase} className="grid grid-cols-[96px_1fr] items-center gap-3">
                  <div className="text-xs font-medium text-muted">{phase}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {nums.map((n) => {
                      const s = run.stages[n - 1];
                      return (
                        <motion.div key={n} title={`Stage ${n}: ${s.name}`} layout
                          initial={false}
                          animate={s.status === "running" ? { scale: [1, 1.08, 1], transition: { repeat: Infinity, duration: 1.1 } } : { scale: 1 }}
                          className={clsx("flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
                            s.status === "done" && "border-good/30 bg-good-soft text-good-ink",
                            s.status === "running" && "border-accent bg-accent-soft text-accent-ink shadow-[0_0_20px_-4px_var(--accent)]",
                            s.status === "pending" && "border-line bg-surface-2 text-muted")}>
                          {s.status === "done" ? <Check className="size-3" /> : <span className="tabular">{String(n).padStart(2, "0")}</span>}
                          {s.name.replaceAll("_", " ").toLowerCase()}
                        </motion.div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            {run.provenance && <div className="mt-5"><Callout tone="warn" title="Provenance">{run.provenance}</Callout></div>}
          </Card>

          <div className="space-y-6">
            <Card className="p-5">
              <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted">Output</div>
              {run.document_id ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-3 rounded-xl border border-line p-3">
                    <FileText className="size-8 text-accent" />
                    <div className="min-w-0 flex-1 text-sm">
                      <div className="truncate font-medium">{run.pdf_path?.split("/").pop()}</div>
                      <a className="text-xs text-accent-ink hover:underline" href={`${API}/api/documents/${run.document_id}/file`} target="_blank" rel="noreferrer">Open PDF</a>
                    </div>
                  </div>
                  <Button variant="primary" className="w-full" onClick={() => onAudit(run.document_id!)}>
                    Audit this draft with CiteGuard <ArrowRight className="size-4" />
                  </Button>
                </div>
              ) : (
                <div className="text-sm text-ink-2">The PDF appears here when the pipeline finishes.</div>
              )}
            </Card>
            <Card className="overflow-hidden">
              <div className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-xs font-medium text-ink-2">
                <Terminal className="size-3.5" /> Log tail
              </div>
              <pre className="max-h-72 overflow-auto bg-surface-2 px-4 py-3 font-mono text-[11px] leading-relaxed text-ink-2">
                {run.log_tail.join("\n") || "…"}
              </pre>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
