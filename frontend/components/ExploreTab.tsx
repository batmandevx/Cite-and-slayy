"use client";

import clsx from "clsx";
import { ArrowRight, Compass, History, Lightbulb, Orbit, Radar, ScatterChart, Sparkles } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { api, useJob } from "@/lib/api";
import type { GapClass, GapRadarResult, QuestionsResult } from "@/lib/types";
import { BubbleChart, CLASS_COLORS, CLASS_LABEL, YearHeatmap } from "./charts";
import { useTheme } from "./theme";
import { Badge, Button, Callout, Card, Empty, ExtLink, Field, Input, JobProgress, SectionTitle, Select, type Tone } from "./ui";

const ResearchGalaxy = lazy(() => import("./three/ResearchGalaxy"));

const CLASS_TONE: Record<GapClass, Tone> = { underexplored: "accent", rising: "serious", saturated: "good", unclassified: "neutral" };

function ClassDot({ cls }: { cls: GapClass }) {
  const { theme } = useTheme();
  const color = CLASS_COLORS[theme][cls];
  return (
    <span
      className="inline-block size-2.5 shrink-0 rounded-full"
      style={cls === "unclassified" ? { border: `2px dashed ${color}` } : { background: color }}
    />
  );
}

export function ExploreTab({
  runId, setRunId, onSendTopic,
}: { runId: string | null; setRunId: (id: string) => void; onSendTopic: (topic: string) => void }) {
  const [query, setQuery] = useState("parameter-efficient fine-tuning");
  const [maxPapers, setMaxPapers] = useState(800);
  const [fromYear, setFromYear] = useState(2020);
  const [clustering, setClustering] = useState<"kmeans" | "hdbscan">("kmeans");
  const [run, setRun] = useState<GapRadarResult | null>(null);
  const [history, setHistory] = useState<GapRadarResult[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [qResult, setQuestions] = useState<QuestionsResult | null>(null);
  const [qLoading, setQLoading] = useState(false);
  const [qError, setQError] = useState<string | null>(null);
  const job = useJob();
  const [view, setView] = useState<"3d" | "2d">("3d");
  const reduced = useReducedMotion();

  useEffect(() => {
    api.get<GapRadarResult[]>("/api/gap-radar/runs").then(setHistory).catch(() => {});
  }, [run]);

  useEffect(() => {
    if (!runId) return;
    api.get<GapRadarResult>(`/api/gap-radar/runs/${runId}`).then((r) => {
      setRun(r);
      setQuery(r.query);
      setSelected((s) => (s !== null && r.clusters.some((c) => c.cluster_id === s) ? s : r.clusters[0]?.cluster_id ?? null));
    }).catch(() => {});
  }, [runId]);


  const questions = qResult && qResult.run_id === run?.run_id && qResult.cluster_id === selected ? qResult : null;
  const select = (id: number) => { setSelected(id); setQError(null); };
  const cluster = useMemo(() => run?.clusters.find((c) => c.cluster_id === selected) ?? null, [run, selected]);

  const start = () =>
    job.start(
      () => api.post("/api/gap-radar/runs", { query, max_papers: maxPapers, from_year: fromYear, clustering }),
      (id) => setRunId(id),
      "Gap Radar scan",
    );

  const genQuestions = async () => {
    if (!run || selected === null) return;
    setQLoading(true);
    setQError(null);
    try {
      setQuestions(await api.post<QuestionsResult>(`/api/gap-radar/runs/${run.run_id}/clusters/${selected}/questions`));
    } catch (e) {
      setQError((e as Error).message);
    } finally {
      setQLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="scroll-mt-40 p-5" id="explore-start">
        <SectionTitle eyebrow="Step 1 · Gap Radar" title="What should I research?">
          Pull recent papers from OpenAlex and arXiv, cluster them by meaning, and classify each sub-topic as
          Rising, Saturated or Underexplored using thresholds you can inspect.
        </SectionTitle>
        <div className="grid gap-3 md:grid-cols-[1fr_120px_110px_170px_auto] md:items-end">
          <Field label="Field or seed query">
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. speculative decoding"
              onKeyDown={(e) => e.key === "Enter" && !job.running && start()} />
          </Field>
          <Field label="Papers">
            <Select value={maxPapers} onChange={(e) => setMaxPapers(+e.target.value)} className="w-full">
              {[300, 500, 800, 1200, 2000].map((n) => <option key={n} value={n}>{n}</option>)}
            </Select>
          </Field>
          <Field label="From year">
            <Select value={fromYear} onChange={(e) => setFromYear(+e.target.value)} className="w-full">
              {[2018, 2019, 2020, 2021, 2022, 2023].map((n) => <option key={n} value={n}>{n}</option>)}
            </Select>
          </Field>
          <Field label="Clustering">
            <Select value={clustering} onChange={(e) => setClustering(e.target.value as "kmeans" | "hdbscan")} className="w-full">
              <option value="kmeans">KMeans (auto k)</option>
              <option value="hdbscan">HDBSCAN</option>
            </Select>
          </Field>
          <Button variant="primary" onClick={start} loading={job.running} disabled={!query.trim()}>
            <Radar className="size-4" /> Scan field
          </Button>
        </div>
        {history.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-ink-2">
            <History className="size-3.5 text-muted" /> Previous scans:
            {history.slice(0, 6).map((h) => (
              <button key={h.run_id} onClick={() => setRunId(h.run_id)}
                className={clsx("rounded-full border px-2.5 py-1 transition hover:border-line-strong",
                  h.run_id === run?.run_id ? "border-accent bg-accent-soft text-accent-ink" : "border-line bg-surface")}>
                {h.query} · {h.n_papers}
              </button>
            ))}
          </div>
        )}
      </Card>

      <JobProgress state={job} label="Gap Radar" />

      {!run && !job.running && (
        <Empty icon={<Compass className="size-8" />} title="No scan yet">
          Enter a field and press <b>Scan field</b>. A scan of ~800 papers takes about a minute.
        </Empty>
      )}

      {run && (
        <div className="rise space-y-6">
          <div className="grid gap-6 xl:grid-cols-[1.35fr_1fr]">
            <Card className="overflow-hidden p-5">
              <SectionTitle eyebrow={`${run.n_papers} papers · ${run.clusters.length} clusters`} title="Opportunity map"
                right={
                  <div className="relative flex rounded-xl border border-line bg-surface-2 p-1 text-xs font-medium">
                    {(["3d", "2d"] as const).map((v) => (
                      <button key={v} onClick={() => setView(v)} className={clsx("relative z-10 flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition", view === v ? "text-white" : "text-ink-2 hover:text-ink")}>
                        {view === v && <motion.span layoutId="view-pill" className="absolute inset-0 -z-10 rounded-lg bg-accent" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
                        {v === "3d" ? <><Orbit className="size-3.5" /> 3D Galaxy</> : <><ScatterChart className="size-3.5" /> 2D Map</>}
                      </button>
                    ))}
                  </div>
                }>
                {view === "3d"
                  ? "Each orb is a cluster, sized by papers; each dot is a paper. Axes: growth → citations/yr ↑ recency ↗. Drag to orbit, scroll to zoom, click an orb."
                  : "Bubble size is the number of papers; dashed lines are the field medians. Click a bubble to inspect it."}
              </SectionTitle>
              <AnimatePresence mode="wait">
                {view === "3d" ? (
                  <motion.div key="3d" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }} transition={{ duration: 0.35 }}
                    className="stage plain h-[440px] !rounded-2xl">
                    <Suspense fallback={<div className="absolute inset-0 shimmer" />}>
                      <ResearchGalaxy run={run} mode="explore" selected={selected} onSelect={select} reduced={!!reduced} className="absolute inset-0" />
                    </Suspense>
                  </motion.div>
                ) : (
                  <motion.div key="2d" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
                    <BubbleChart run={run} selected={selected} onSelect={select} />
                  </motion.div>
                )}
              </AnimatePresence>
            </Card>
            <Card className="p-5">
              <SectionTitle eyebrow="Papers per year" title="Momentum heatmap" />
              <YearHeatmap run={run} selected={selected} onSelect={select} />
              <p className="mt-2 text-[11px] text-muted">
                {run.years[run.years.length - 1]} is a partial year. Sources: {Object.entries(run.sources_used).map(([k, v]) => `${k} ${v}`).join(" · ")}.
              </p>
            </Card>
          </div>

          <div className="grid gap-6 xl:grid-cols-[1fr_1.15fr]">
            <Card className="overflow-hidden">
              <div className="border-b border-line px-5 py-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Ranked gap list</div>
                <div className="text-sm text-ink-2">Underexplored first, then Rising.</div>
              </div>
              <div className="max-h-[560px] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-surface-2 text-left text-[11px] uppercase tracking-wider text-muted">
                    <tr>
                      <th className="px-4 py-2 font-medium">Cluster</th>
                      <th className="px-2 py-2 text-right font-medium">Papers</th>
                      <th className="px-2 py-2 text-right font-medium">Growth</th>
                      <th className="px-4 py-2 text-right font-medium">Cites/yr</th>
                    </tr>
                  </thead>
                  <tbody>
                    {run.clusters.map((c, i) => (
                      <motion.tr key={c.cluster_id} onClick={() => select(c.cluster_id)}
                        initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.04 * i, duration: 0.35 }}
                        className={clsx("cursor-pointer border-t border-line transition hover:bg-surface-2",
                          c.cluster_id === selected && "bg-accent-soft/60")}>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <ClassDot cls={c.classification} />
                            <span className="font-medium text-ink">{c.label}</span>
                          </div>
                          <div className="mt-0.5 pl-[18px] text-xs text-muted">{CLASS_LABEL[c.classification]}</div>
                        </td>
                        <td className="tabular px-2 text-right text-ink-2">{c.size}</td>
                        <td className="tabular px-2 text-right text-ink-2">{(c.growth * 100).toFixed(0)}%</td>
                        <td className="tabular px-4 text-right text-ink-2">{c.cites_per_year.toFixed(1)}</td>
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <details className="border-t border-line px-5 py-3 text-xs text-ink-2">
                <summary className="cursor-pointer font-medium text-ink">Classification thresholds (transparent rules)</summary>
                <dl className="mt-2 space-y-1.5">
                  {Object.entries(run.thresholds).map(([k, v]) => (
                    <div key={k}><dt className="inline font-semibold capitalize text-ink">{k}: </dt><dd className="inline">{v}</dd></div>
                  ))}
                  <div className="pt-1 text-muted">
                    Field medians: growth {(run.field_baseline.median_growth * 100).toFixed(0)}% · recency {(run.field_baseline.median_recency * 100).toFixed(0)}% ·
                    cites/yr {run.field_baseline.median_cites_per_year.toFixed(2)} · size tertiles {run.field_baseline.size_lower_tertile.toFixed(0)} / {run.field_baseline.size_upper_tertile.toFixed(0)}
                  </div>
                </dl>
              </details>
            </Card>

            {cluster && (
              <motion.div key={cluster.cluster_id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}>
              <Card className="h-full p-5">
                <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="mb-1 flex items-center gap-2">
                      <Badge tone={CLASS_TONE[cluster.classification]}>{CLASS_LABEL[cluster.classification]}</Badge>
                      {cluster.label_source === "keywords" && <Badge tone="neutral" icon={false}>keyword label (AI offline)</Badge>}
                    </div>
                    <h3 className="text-lg font-semibold tracking-tight">{cluster.label}</h3>
                    <p className="mt-0.5 text-sm text-ink-2">{cluster.description}</p>
                  </div>
                </div>
                <div className="mb-4 rounded-lg bg-surface-2 px-3 py-2 text-xs text-ink-2">
                  <span className="font-semibold text-ink">Why: </span>{cluster.reasons.join("; ")}
                </div>
                <div className="mb-4 flex flex-wrap gap-1.5">
                  {cluster.keywords.map((k) => <span key={k} className="rounded-md bg-surface-2 px-2 py-0.5 text-xs text-ink-2">{k}</span>)}
                </div>
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Most central papers</div>
                <ul className="mb-5 space-y-1.5 text-sm">
                  {cluster.top_papers.slice(0, 6).map((p) => (
                    <li key={p.id} className="leading-snug">
                      <ExtLink href={p.doi ? `https://doi.org/${p.doi}` : p.url}>{p.title}</ExtLink>
                      <span className="text-xs text-muted"> · {p.year}{p.venue ? ` · ${p.venue}` : ""}{p.cited_by != null ? ` · ${p.cited_by} cites` : ""}</span>
                    </li>
                  ))}
                </ul>

                <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
                  <div className="text-sm text-ink-2">Turn this gap into research questions grounded in these papers.</div>
                  <Button variant="primary" onClick={genQuestions} loading={qLoading}>
                    <Lightbulb className="size-4" /> Generate 3 questions
                  </Button>
                </div>
                {qError && <div className="mt-3"><Callout tone="warn" title="Could not generate questions">{qError}</Callout></div>}
                {questions && (
                  <div className="mt-4 space-y-3">
                    {questions.dropped > 0 && (
                      <Callout tone="warn">{questions.dropped} AI suggestion(s) were dropped because they cited papers outside the provided list.</Callout>
                    )}
                    {questions.questions.map((q, i) => (
                      <motion.div key={i} className="rounded-xl border border-line bg-surface p-4" initial={{ opacity: 0, y: 14, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ delay: i * 0.12, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}>
                        <div className="flex gap-3">
                          <Sparkles className="mt-0.5 size-4 shrink-0 text-accent" />
                          <div className="min-w-0 flex-1">
                            <div className="font-medium leading-snug">{q.text}</div>
                            <p className="mt-1 text-sm text-ink-2">{q.rationale}</p>
                            <div className="mt-2 space-y-0.5 text-xs">
                              {q.evidence.map((p) => (
                                <div key={p.id}><ExtLink href={p.doi ? `https://doi.org/${p.doi}` : p.url}>{p.title}</ExtLink> <span className="text-muted">({p.year})</span></div>
                              ))}
                            </div>
                            <div className="mt-3 flex justify-end">
                              <Button onClick={() => onSendTopic(q.text)}>Send to Draft <ArrowRight className="size-4" /></Button>
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                )}
              </Card>
              </motion.div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
