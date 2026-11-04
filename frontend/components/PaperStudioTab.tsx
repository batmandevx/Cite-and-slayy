"use client";

import { track } from "@/lib/track";
import clsx from "clsx";
import {
  BadgeCheck, BookMarked, CheckCircle2, Download, ExternalLink, FileText, FileType2, Gamepad2, Loader2, NotebookPen,
  FileUp, Lightbulb, Presentation, Printer, RotateCcw, ShieldCheck, Sparkles, Wand2,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, toast, usePersistent, apiFetch, jobEvents } from "@/lib/api";
import { exportPaper, printPdf } from "@/lib/paperExport";
import { downloadDeck, type DeckTheme } from "@/lib/deck";
import type { Job, JobEvent } from "@/lib/types";
import { Confetti } from "./Confetti";
import { StudioDemoPapers } from "./DemoPapersShowcase";
import { RichMarkdown } from "./notes/RichMarkdown";
import { ReviseChat } from "./studio/ReviseChat";
import { SubmissionKit, type Kit } from "./studio/SubmissionKit";
import { VenueFinder } from "./studio/VenueFinder";
import { Button, Card, Select } from "./ui";
import { usePaid } from "./auth/AuthProvider";
import { ProChip, UnlockPanel } from "./billing/ProLock";
import { DeckThemePicker } from "./studio/DeckThemePicker";

interface StudioPaper {
  paper_id: string; title: string; topic: string; markdown: string; highlights: string[]; summary: string; keywords: string[];
  research_question: string; contributions: string[]; words: number; template: string; author: string; affiliation: string;
  references: { n: number; title: string; year?: number; doi?: string; url?: string; venue?: string; cited_by?: number }[];
  history?: { at: string; instruction: string }[]; revisable?: boolean; seeded?: string[]; last_change?: string; kit?: Kit | null; locked?: boolean; locked_sections?: number; references_total?: number;
  report: {
    references: number; candidates: number; retraction_checked: number; retracted_excluded: { title: string; doi?: string }[];
    invalid_citations_removed: number; claims_checked: number; claims_supported: number; claims_unsupported: number;
    paragraphs_flagged: number; paragraphs_revised: number; unmeasured_claims_found?: number; unmeasured_claims_remaining?: number; verbatim_paragraphs_after: number; tortured_phrases: string[];
  };
}

const AGENTS: { id: string; name: string; role: string; emoji: string; color: string }[] = [
  { id: "scout", name: "Scout", role: "finds & vets the literature", emoji: "🔭", color: "bg-lime" },
  { id: "analyst", name: "Analyst", role: "trends, venues & 300-DPI figures", emoji: "📊", color: "bg-blue" },
  { id: "experimenter", name: "Experimenter", role: "runs pilot benchmarks & a sandboxed simulation", emoji: "🧪", color: "bg-lime" },
  { id: "architect", name: "Architect", role: "model, acronym & theorems", emoji: "📐", color: "bg-yellow" },
  { id: "writer:intro", name: "Intro writer", role: "Introduction & scope", emoji: "✍️", color: "bg-pink" },
  { id: "writer:related", name: "Literature writer", role: "Related work & positioning", emoji: "📚", color: "bg-pink" },
  { id: "writer:formulation", name: "Modeler", role: "Formulation & notation table", emoji: "🧭", color: "bg-pink" },
  { id: "writer:method", name: "Method writer", role: "Architecture & Algorithm 1", emoji: "🧮", color: "bg-pink" },
  { id: "writer:theory", name: "Theory prover", role: "Theorems, proofs & bounds", emoji: "⚖️", color: "bg-pink" },
  { id: "writer:analysis", name: "Results writer", role: "Quantitative synthesis", emoji: "📈", color: "bg-pink" },
  { id: "writer:protocol", name: "Experiment designer", role: "Leak-free protocol & ablations", emoji: "🧪", color: "bg-pink" },
  { id: "writer:discussion", name: "Discussion writer", role: "Failure modes & conclusion", emoji: "💬", color: "bg-pink" },
  { id: "editor", name: "Editor", role: "Abstract & IEEE Index Terms", emoji: "🖋️", color: "bg-orange" },
  { id: "verifier", name: "Verifier", role: "citations, copying, claims", emoji: "🛡️", color: "bg-mint" },
  { id: "reviser", name: "Reviser", role: "fixes flagged paragraphs", emoji: "🔧", color: "bg-violet" },
];
type AgentState = { state: "idle" | "run" | "done"; text: string };

const IDEAS = [
  "Retrieval-augmented generation for scientific question answering",
  "Federated learning for privacy-preserving medical imaging",
  "Graph neural networks for traffic forecasting",
  "Large language models for automated code review",
  "Machine learning for early wildfire detection from satellite images",
  "Explainable AI for credit risk assessment",
];

function useStudioJob(onDone: (pid: string) => void) {
  const [jobId, setJobId] = usePersistent<string | null>("studioJob", null);
  const [agents, setAgents] = useState<Record<string, AgentState>>({});
  const [progress, setProgress] = useState(0);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = usePersistent<number>("studioStarted", 0);
  const doneRef = useRef(onDone);
  useEffect(() => { doneRef.current = onDone; });

  useEffect(() => {
    if (!jobId) return;
    const src = jobEvents(jobId);
    let alive = true;
    src.onopen = () => alive && setRunning(true);
    src.onmessage = (m) => {
      const ev = JSON.parse(m.data) as JobEvent;
      setProgress(ev.progress);
      try {
        const d = JSON.parse(ev.message) as { agent: string; state: "run" | "done"; text: string };
        if (d.agent) setAgents((a) => ({ ...a, [d.agent]: { state: d.state, text: d.text } }));
      } catch { /* plain lifecycle message */ }
    };
    src.addEventListener("end", (m) => {
      const job = JSON.parse((m as MessageEvent).data) as Job;
      src.close(); setRunning(false); setJobId(null);
      if (job.status === "done" && job.result_id) { track("paper_generated"); doneRef.current(job.result_id); }
      else { setError(job.error ?? "The paper could not be generated."); toast({ title: "Paper generation failed", body: job.error ?? undefined, tone: "crit" }); }
    });
    src.onerror = () => {
      if (src.readyState === EventSource.CLOSED) { setRunning(false); setJobId(null); setError("Lost connection to the server."); }
    };
    return () => { alive = false; src.close(); };
  }, [jobId, setJobId]);

  const start = useCallback(async (body: object) => {
    setAgents({}); setProgress(0); setError(null);
    try {
      const { job_id } = await api.post<{ job_id: string }>("/api/paper-studio", body);
      setStarted(Date.now()); setJobId(job_id); setRunning(true); track("paper_started");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [setJobId, setStarted]);
  return { start, agents, progress, running: running || !!jobId, error, started };
}

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const s = Math.max(0, Math.round((now - since) / 1000));
  return <span className="tabular-nums">{Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}</span>;
}

function AgentBoard({ agents, progress, started, onPlay }: { agents: Record<string, AgentState>; progress: number; started: number; onPlay: () => void }) {
  const active = AGENTS.filter((a) => agents[a.id]?.state === "run");
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b-[2.5px] border-edge bg-ink px-5 py-4 text-bg">
        <Loader2 className="size-6 animate-spin" />
        <div className="flex-1">
          <div className="font-display text-xl font-extrabold">Your research team is writing…</div>
          <div className="text-xs opacity-75">{active.length ? active.map((a) => a.name).join(" · ") + " working" : "Warming up"} · <Elapsed since={started} /> elapsed · usually 3–6 min</div>
        </div>
        <Button variant="lime" onClick={onPlay}><Gamepad2 className="size-4" />Play while you wait</Button>
      </div>
      <div className="h-3 border-b-2 border-edge bg-surface-2">
        <motion.div className="h-full bg-[linear-gradient(90deg,var(--pink),var(--yellow),var(--lime))]" animate={{ width: `${Math.max(3, progress * 100)}%` }} transition={{ type: "spring", stiffness: 40 }} />
      </div>
      <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {AGENTS.map((a, i) => {
          const st = agents[a.id]?.state ?? "idle";
          return (
            <motion.div key={a.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
              className={clsx("relative rounded-2xl border-[2.5px] border-edge p-3 transition-colors",
                st === "run" ? `${a.color} text-[#121212] shadow-[4px_4px_0_var(--shadow-c)]` : st === "done" ? "bg-surface" : "bg-surface-2 opacity-60")}>
              <div className="flex items-center gap-2.5">
                <motion.span className="grid size-10 shrink-0 place-items-center rounded-xl border-2 border-edge bg-surface text-xl"
                  animate={st === "run" ? { rotate: [0, -10, 10, 0], scale: [1, 1.12, 1] } : {}} transition={{ repeat: Infinity, duration: 1.4 }}>{a.emoji}</motion.span>
                <div className="min-w-0 flex-1">
                  <div className="font-display text-sm font-extrabold leading-tight">{a.name}</div>
                  <div className="truncate text-[11px] opacity-75">{a.role}</div>
                </div>
                {st === "done" && <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }}><CheckCircle2 className="size-5 text-good" /></motion.span>}
                {st === "run" && <span className="typing-dots"><i /><i /><i /></span>}
              </div>
              {agents[a.id]?.text && <div className="mt-2 line-clamp-2 text-[11px] leading-snug opacity-90">{agents[a.id].text}</div>}
            </motion.div>
          );
        })}
      </div>
    </Card>
  );
}

function Report({ p }: { p: StudioPaper }) {
  const r = p.report;
  const rows: [string, string, boolean][] = [
    ["Real references, every one linked", `${r.references} works`, true],
    ["Checked for retraction notices", `${r.retraction_checked} clear${r.retracted_excluded.length ? ` · ${r.retracted_excluded.length} retracted excluded` : ""}`, true],
    ["Citation claims checked against abstracts", `${r.claims_supported} supported · ${r.claims_unsupported} fixed of ${r.claims_checked}`, true],
    ["Copied text (8-word matches) after revision", r.verbatim_paragraphs_after ? `${r.verbatim_paragraphs_after} paragraph(s)` : "none found", !r.verbatim_paragraphs_after],
    ["Unmeasured numbers / results claims", `${r.unmeasured_claims_found ?? 0} found · ${r.unmeasured_claims_remaining ?? 0} left`, !(r.unmeasured_claims_remaining ?? 0)],
    ["Paragraphs revised for originality / support", `${r.paragraphs_revised} of ${r.paragraphs_flagged} flagged`, true],
    ["Tortured phrases", r.tortured_phrases.length ? r.tortured_phrases.join(", ") : "none found", !r.tortured_phrases.length],
    ["Invalid citation numbers removed", String(r.invalid_citations_removed), true],
  ];
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2 font-display text-lg font-extrabold"><ShieldCheck className="size-5 text-good" />Integrity report</div>
      <div className="space-y-1.5">
        {rows.map(([k, v, ok]) => (
          <div key={k} className="flex items-start justify-between gap-3 border-b-2 border-dashed border-line pb-1.5 text-sm last:border-0">
            <span className="text-ink-2">{k}</span>
            <span className={clsx("shrink-0 text-right font-bold", ok ? "text-good-ink" : "text-warn-ink")}>{v}</span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-muted">
        Results are measured from real bibliographic data. The experimental protocol lists experiments to run; its cells say “to be measured”
        until you add your own numbers. Similarity checks here compare against the cited abstracts. Run your institution&apos;s checker before submitting.
      </p>
    </Card>
  );
}

function abstractOf(md: string) {
  const m = md.match(/# Abstract\s+([\s\S]*?)(?=\n# |\n\*\*Keywords)/);
  return (m?.[1] ?? "").trim().slice(0, 2500);
}

function TopicIdeas({ onPick }: { onPick: (topic: string, angle: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [ideas, setIdeas] = useState<{ title: string; pitch: string; method: string; evidence: { title: string }[] }[]>([]);
  const go = async () => {
    if (!q.trim()) return;
    setBusy(true);
    try { setIdeas((await api.post<{ ideas: typeof ideas }>("/api/library/ideas", { query: q })).ideas); }
    catch (e) { toast({ title: "Couldn't brainstorm topics", body: (e as Error).message, tone: "crit" }); }
    finally { setBusy(false); }
  };
  return (
    <div className="mt-3">
      {!open ? (
        <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1 text-xs font-bold text-pink hover:underline"><Lightbulb className="size-3.5" />Not sure what to write about? Brainstorm topics from your interests</button>
      ) : (
        <div className="rounded-2xl border-[2.5px] border-dashed border-edge p-3">
          <div className="flex gap-2">
            <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} placeholder="Your interests, e.g. “AI in agriculture, drones”"
              className="min-w-0 flex-1 rounded-xl border-2 border-edge bg-surface px-3 py-1.5 text-sm outline-none" />
            <Button variant="primary" className="!px-3 !py-1.5 text-xs" loading={busy} onClick={go}><Sparkles className="size-3.5" />Suggest</Button>
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {ideas.map((i, k) => (
              <motion.button key={i.title} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: k * 0.06 }}
                onClick={() => { onPick(i.title, `${i.pitch} First experiment: ${i.method}`); setOpen(false); }}
                className="rounded-xl border-2 border-edge bg-surface p-2.5 text-left hover:bg-yellow hover:text-[#121212]">
                <div className="font-display text-sm font-extrabold leading-tight">{i.title}</div>
                <div className="mt-0.5 line-clamp-2 text-[11px] opacity-80">{i.pitch}</div>
                <div className="mt-1 text-[10px] opacity-60">Grounded in {i.evidence.length} recent paper{i.evidence.length === 1 ? "" : "s"} · click to use</div>
              </motion.button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SeedPapers({ ids, setIds }: { ids: { id: string; name: string }[]; setIds: (v: { id: string; name: string }[]) => void }) {
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    const out = [...ids];
    for (const f of Array.from(files).slice(0, 8 - ids.length)) {
      try {
        const info = await api.upload<{ document_id: string; title?: string | null; filename: string }>("/api/documents", f);
        out.push({ id: info.document_id, name: info.title || info.filename });
      } catch (e) {
        toast({ title: `Couldn't read ${f.name}`, body: (e as Error).message, tone: "crit" });
      }
    }
    setIds(out); setBusy(false);
  };
  return (
    <div className="mt-3 rounded-2xl border-[2.5px] border-dashed border-edge bg-surface/60 p-3">
      <div className="flex items-center gap-2">
        <FileUp className="size-4" />
        <span className="flex-1 text-xs font-bold">Papers you&apos;ve studied (optional): we&apos;ll find them and cite them</span>
        <Button className="!px-2.5 !py-1 text-[11px]" loading={busy} onClick={() => input.current?.click()} disabled={ids.length >= 8}>Add PDFs</Button>
        <input ref={input} type="file" accept=".pdf,.txt" multiple hidden onChange={(e) => add(e.target.files)} />
      </div>
      {ids.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {ids.map((d) => (
            <span key={d.id} className="inline-flex max-w-full items-center gap-1 rounded-full border-2 border-edge bg-yellow px-2 py-0.5 text-[11px] font-bold text-[#121212]">
              <span className="truncate">{d.name}</span>
              <button onClick={() => setIds(ids.filter((x) => x.id !== d.id))}>✕</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function PaperStudioTab({
  onPlay,
  onAudit,
  onAuditDoc,
  onOriginality,
}: {
  onPlay: () => void;
  onAudit: () => void;
  onAuditDoc?: (docId: string) => void;
  onOriginality?: (paperId: string) => void;
}) {
  const [topic, setTopic] = usePersistent("studioTopic", "");
  const [angle, setAngle] = usePersistent("studioAngle", "");
  const [template, setTemplate] = usePersistent("studioTemplate", "ieee");
  const [author, setAuthor] = usePersistent("paperAuthor", "");
  const [affil, setAffil] = usePersistent("paperAffil", "");
  const [disclose, setDisclose] = usePersistent("studioDisclose", true);
  const [seeds, setSeeds] = useState<{ id: string; name: string }[]>([]);
  const [kitVenue, setKitVenue] = useState<{ name: string; type: string } | null>(null);
  const [paperId, setPaperId] = usePersistent<string | null>("studioPaper", null);
  const [paper, setPaper] = useState<StudioPaper | null>(null);
  const [history, setHistory] = useState<{ paper_id: string; title: string; words: number; created_at: string }[]>([]);
  const [party, setParty] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const preview = useRef<HTMLDivElement>(null);
  const { paid, gate } = usePaid();
  const [deckTheme, setDeckTheme] = usePersistent<string | DeckTheme>("deckTheme", "aurora");

  const job = useStudioJob((pid) => { setPaperId(pid); setParty((n) => n + 1); toast({ title: "Your paper is ready 🎉", tone: "good" }); });
  useEffect(() => { api.get<typeof history>("/api/paper-studio").then(setHistory).catch(() => {}); }, [paperId]);
  const reload = useCallback(() => {
    if (paperId) api.get<StudioPaper>(`/api/paper-studio/${paperId}`).then(setPaper).catch(() => setPaperId(null));
  }, [paperId, setPaperId]);
  useEffect(() => {
    if (!paperId) return;
    api.get<StudioPaper>(`/api/paper-studio/${paperId}`).then(setPaper).catch(() => setPaperId(null));
  }, [paperId, setPaperId]);
  const shown = paperId ? paper : null;

  const doc = () => ({ title: shown!.title, markdown: shown!.markdown, template, author, affiliation: affil });
  const run = async (label: string, fn: () => Promise<void> | void, feature?: string) => {
    if (feature && !gate(feature)) return;
    setBusy(label); try { await fn(); } finally { setBusy(null); }
  };
  const toNotes = async () => {
    if (!shown) return;
    const cur = await api.get<{ items: unknown[] }>("/api/workspace/pages");
    const page = { id: shown.paper_id, title: shown.title, md: shown.markdown, template, updated: Date.now(), emoji: "📄" };
    await apiFetch(`/api/workspace/pages`, { method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: [page, ...cur.items.filter((x) => (x as { id: string }).id !== shown.paper_id)] }) });
    toast({ title: "Saved to Notes", body: "Edit it with the live editor in Notes → Pages.", tone: "good" });
  };

  return (
    <div className="space-y-6">
      {party > 0 && <Confetti key={party} />}
      {/* composer */}
      {!job.running && (
        <Card pop className="relative overflow-hidden p-6 md:p-8">
          <div className="pointer-events-none absolute -right-16 -top-16 size-64 rounded-full bg-pink/30 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-20 left-1/3 size-64 rounded-full bg-lime/30 blur-3xl" />
          <div className="relative">
            <div className="flex flex-wrap items-center gap-2">
              <span className="sticker bg-yellow text-[#121212]">15 AI agents</span>
              <span className="sticker bg-lime text-[#121212]">theorems + Algorithm 1</span>
              <span className="sticker bg-blue text-white">300-DPI figures + ablations</span>
            </div>
            <h2 className="mt-3 font-display text-3xl font-extrabold leading-tight md:text-4xl">
              Topic in. <span className="gradient-text">Monograph-grade paper</span> out.
            </h2>
            <p className="mt-1 max-w-2xl text-ink-2">Specialist agents vet literature on OpenAlex &amp; Crossref, formulate mathematical notation &amp; assumptions, design Algorithm 1, derive formal propositions &amp; failure bounds, and audit every citation and claim.</p>
            <div className="mt-5 grid gap-3 lg:grid-cols-[1.4fr_1fr]">
              <div>
                <textarea value={topic} onChange={(e) => setTopic(e.target.value)} rows={2} placeholder="Your research topic, e.g. “Graph neural networks for traffic forecasting”"
                  className="w-full resize-none rounded-2xl border-[2.5px] border-edge bg-surface px-4 py-3 font-display text-lg font-bold shadow-[4px_4px_0_var(--shadow-c)] outline-none" />
                <textarea value={angle} onChange={(e) => setAngle(e.target.value)} rows={2} placeholder="Optional: your angle, idea or constraints (dataset, domain, method you like)…"
                  className="mt-3 w-full resize-none rounded-2xl border-[2.5px] border-edge bg-surface px-4 py-2.5 text-sm shadow-[3px_3px_0_var(--shadow-c)] outline-none" />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <span className="self-center text-xs font-bold text-muted">Need inspiration?</span>
                  {IDEAS.map((t) => (
                    <motion.button key={t} whileHover={{ y: -2 }} onClick={() => setTopic(t)}
                      className="rounded-full border-2 border-edge bg-surface px-2.5 py-0.5 text-[11px] font-bold">{t}</motion.button>
                  ))}
                </div>
                <TopicIdeas onPick={(t, a) => { setTopic(t); setAngle(a); }} />
                <SeedPapers ids={seeds} setIds={setSeeds} />
              </div>
              <div className="space-y-2.5 rounded-2xl border-[2.5px] border-edge bg-surface-2 p-4">
                <label className="block text-xs font-extrabold uppercase tracking-wider text-muted">Format</label>
                <Select value={template} onChange={(e) => setTemplate(e.target.value)}>
                  <option value="ieee">IEEE Transactions / Access (two-column)</option>
                  <option value="springer">Springer LNCS</option>
                  <option value="plain">Plain monograph article</option>
                </Select>
                <div className="grid grid-cols-2 gap-2">
                  <input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Author(s)" className="rounded-xl border-2 border-edge bg-surface px-3 py-2 text-sm" />
                  <input value={affil} onChange={(e) => setAffil(e.target.value)} placeholder="Affiliation" className="rounded-xl border-2 border-edge bg-surface px-3 py-2 text-sm" />
                </div>
                <label className="flex items-start gap-2 text-xs text-ink-2">
                  <input type="checkbox" checked={disclose} onChange={(e) => setDisclose(e.target.checked)} className="mt-0.5 size-4 accent-[var(--pink)]" />
                  Add an AI-assistance acknowledgment (most journals and conferences require one)
                </label>
                <Button variant="primary" className="w-full !py-3.5 text-lg" disabled={topic.trim().length < 6}
                  onClick={() => job.start({ topic, angle, template, author, affiliation: affil, ai_disclosure: disclose, seed_document_ids: seeds.map((x) => x.id) })}>
                  <Wand2 className="size-5" />Write my paper
                </Button>
              </div>
            </div>
            {job.error && <p className="mt-3 rounded-xl border-2 border-crit bg-crit-soft px-3 py-2 text-sm text-crit-ink">{job.error}</p>}
          </div>
        </Card>
      )}

      {!job.running && (
        <StudioDemoPapers
          onUseSeed={(seedDoc, nextTopic, nextAngle) => {
            setSeeds((prev) => (prev.some((x) => x.id === seedDoc.id) ? prev : [...prev.slice(0, 7), seedDoc]));
            setTopic(nextTopic);
            setAngle(nextAngle);
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
          onAuditDoc={(docId) => (onAuditDoc ? onAuditDoc(docId) : onAudit())}
        />
      )}

      {job.running && <AgentBoard agents={job.agents} progress={job.progress} started={job.started} onPlay={onPlay} />}

      {/* result */}
      <AnimatePresence>
        {shown && !job.running && (
          <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
            <Card className="overflow-hidden">
              <div className="flex flex-wrap items-center gap-3 border-b-[2.5px] border-edge bg-lime px-5 py-4 text-[#121212]">
                <BadgeCheck className="size-7" />
                <div className="min-w-0 flex-1">
                  <div className="font-display text-xs font-extrabold uppercase tracking-widest opacity-70">Paper ready · {shown.words.toLocaleString()} words · {shown.references.length} references</div>
                  <div className="font-display text-xl font-extrabold leading-tight md:text-2xl">{shown.title}</div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 px-5 py-3">
                <Button variant="primary" loading={busy === "pdf"} onClick={() => run("pdf", () => { if (preview.current) printPdf(shown.title, [author, affil].filter(Boolean).join(" · "), preview.current.innerHTML, template); }, "exports")}><Printer className="size-4" />PDF{!paid && <ProChip />}</Button>
                <Button loading={busy === "docx"} onClick={() => run("docx", () => exportPaper("docx", doc()), "exports")}><FileType2 className="size-4" />Word{!paid && <ProChip />}</Button>
                <Button loading={busy === "zip"} onClick={() => run("zip", () => exportPaper("latex-zip", doc()), "exports")}><Download className="size-4" />LaTeX (.zip){!paid && <ProChip />}</Button>
                <div className="inline-flex items-stretch">
                  <Button variant="lime" className="rounded-r-none" loading={busy === "deck"} onClick={() => run("deck", async () => {
                    try {
                      await downloadDeck(shown.paper_id, author, affil, apiFetch, shown.title.replace(/[^a-z0-9]+/gi, "-").slice(0, 50), deckTheme);
                      toast({ title: "Presentation downloaded 🎤", body: "16 slides with native charts, diagrams and speaker notes.", tone: "good" });
                    } catch (e) { toast({ title: "Couldn't build the presentation", body: (e as Error).message, tone: "crit" }); }
                  }, "decks")}><Presentation className="size-4" />Slides (.pptx){!paid && <ProChip />}</Button>
                  <DeckThemePicker value={deckTheme} onChange={setDeckTheme} />
                </div>
                <Button variant="lime" onClick={() => run("notes", toNotes, "exports")}><NotebookPen className="size-4" />Edit in Notes{!paid && <ProChip />}</Button>
                {onOriginality && <Button variant="blue" onClick={() => onOriginality(shown.paper_id)}><Sparkles className="size-4" />AI &amp; Plag Report</Button>}
                <Button variant="blue" onClick={onAudit}><ShieldCheck className="size-4" />Audit a PDF</Button>
                <Button variant="ghost" className="ml-auto" onClick={() => setPaperId(null)}><RotateCcw className="size-4" />New paper</Button>
              </div>
            </Card>

            {shown.last_change && <div className="rounded-xl border-2 border-edge bg-lime/40 px-4 py-2 text-sm"><b>Last change:</b> {shown.last_change}</div>}
            <ReviseChat paperId={shown.paper_id} history={shown.history ?? []} revisable={!!shown.revisable} onChanged={reload} />

            <div className="grid gap-5 lg:grid-cols-[1.25fr_1fr]">
              <Card className="p-5">
                <div className="mb-3 flex items-center gap-2 font-display text-lg font-extrabold"><Sparkles className="size-5 text-pink" />Highlights</div>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {shown.highlights.map((h, i) => (
                    <motion.div key={i} initial={{ opacity: 0, scale: 0.9, rotate: i % 2 ? 1.5 : -1.5 }} animate={{ opacity: 1, scale: 1, rotate: 0 }} transition={{ delay: 0.1 * i }}
                      className={clsx("rounded-xl border-2 border-edge p-3 text-sm font-semibold text-[#121212]", ["bg-yellow", "bg-pink", "bg-lime", "bg-mint"][i % 4])}>{h}</motion.div>
                  ))}
                </div>
                <div className="mt-4 font-display text-sm font-extrabold uppercase tracking-wider text-muted">In plain words</div>
                <p className="mt-1 text-sm text-ink-2">{shown.summary}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">{shown.keywords.map((k) => <span key={k} className="rounded-full border-2 border-edge bg-surface-2 px-2 text-[11px] font-bold">#{k}</span>)}</div>
              </Card>
              <Report p={shown} />
            </div>

            <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
              <Card className="bg-white p-0 text-[#111]">
                <div ref={preview} className="paper-preview mx-auto max-w-[820px] px-6 py-8 md:px-12">
                  <h1 className="mb-1 text-center font-serif text-2xl font-bold leading-snug md:text-3xl">{shown.title}</h1>
                  <p className="mb-6 text-center font-serif italic text-[#555]">{[author, affil].filter(Boolean).join(" · ")}</p>
                  <RichMarkdown>{shown.markdown}</RichMarkdown>
                </div>
                {shown.locked && (
                  <div className="relative -mt-40 bg-[linear-gradient(to_bottom,transparent,white_35%)] px-4 pb-8 pt-40">
                    <UnlockPanel feature="exports" className="mx-auto max-w-xl text-ink"
                      title={`${shown.locked_sections ?? "The remaining"} more section${shown.locked_sections === 1 ? "" : "s"} of your paper are ready`}
                      perks={[`Read all ${shown.words.toLocaleString()} words and all ${shown.references_total ?? shown.references.length} verified references`,
                        "Download Word, LaTeX (.zip with figures) and PDF, or open in Overleaf",
                        "Turn it into a 16-slide presentation in 6 designer themes",
                        "Revise it by chat, run AI & plagiarism reports, get a submission kit"]} />
                  </div>
                )}
              </Card>
              <Card className="h-fit p-4 xl:sticky xl:top-6">
                <div className="mb-2 flex items-center gap-2 font-display font-extrabold"><BookMarked className="size-4" />References</div>
                <ol className="max-h-[70vh] space-y-1.5 overflow-y-auto pr-1 text-xs">
                  {shown.references.map((r) => (
                    <li key={r.n} className="flex gap-1.5">
                      <span className="font-bold">[{r.n}]</span>
                      <a href={r.url} target="_blank" rel="noreferrer" className="hover:underline">{r.title} <span className="text-muted">({r.year})</span><ExternalLink className="ml-0.5 inline size-3 opacity-50" /></a>
                    </li>
                  ))}
                </ol>
              </Card>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {shown && !job.running && <VenueFinder key={shown.paper_id} title={shown.title} abstract={abstractOf(shown.markdown)} auto
        onPick={(v) => { setKitVenue(v); document.getElementById("submission-kit")?.scrollIntoView({ behavior: "smooth", block: "start" }); }} />}
      {shown && !job.running && (
        <div id="submission-kit" className="scroll-mt-6">
          <SubmissionKit key={shown.paper_id} paperId={shown.paper_id} title={shown.title} template={template} author={author} affiliation={affil}
            initial={shown.kit} venue={kitVenue} />
        </div>
      )}

      {history.length > 0 && !job.running && (
        <Card className="p-5">
          <div className="mb-2 flex items-center gap-2 font-display font-extrabold"><FileText className="size-4" />Your papers</div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {history.map((h) => (
              <button key={h.paper_id} onClick={() => setPaperId(h.paper_id)}
                className={clsx("btn-brut rounded-xl px-3 py-2 text-left", h.paper_id === paperId ? "bg-yellow text-[#121212]" : "bg-surface")}>
                <div className="line-clamp-2 text-sm font-bold leading-snug">{h.title}</div>
                <div className="text-[11px] opacity-70">{h.words?.toLocaleString()} words · {new Date(h.created_at).toLocaleDateString()}</div>
              </button>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
