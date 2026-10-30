"use client";

import clsx from "clsx";
import {
  ArrowRight, ArrowUp, BookOpenCheck, BrainCircuit, Building2, Check, ChevronDown, Copy, FilePlus2, FlaskConical,
  Gavel, History, Lightbulb, ListChecks, ListTodo, Loader2, Maximize2, Minimize2, NotebookPen, Pin, Plus, Radar,
  Search, ShieldAlert, ShieldCheck, Sparkles, TestTube2, X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, toast, usePersistent, writePersistent, jobEvents } from "@/lib/api";
import { AuroraOrb } from "./AuroraOrb";

export interface AppLink {
  tab: string;
  paper?: string;
  doc?: string;
  audit?: string;
  review?: string;
  gap?: string;
  chat?: string;
  notesView?: "pages" | "stickies" | "todos";
  noteId?: string;
}

interface ChartData {
  type: "multi" | "bar";
  series?: Record<string, Record<string, number>>;
  items?: { label: string; value: number }[];
}

interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: "running" | "done" | "error";
  thought?: string;
  summary?: string;
  progress?: string;
  link?: AppLink | null;
  chart?: ChartData | null;
  papers?: { title: string; year?: number; url?: string; cited_by?: number; venue?: string }[] | null;
}

interface Msg {
  role: "user" | "assistant";
  content: string;
  tools?: ToolCall[];
  thoughts?: string[];
  at?: string;
}

interface ChatSummary {
  chat_id: string;
  title: string;
  n: number;
}

const TOOL_META: Record<string, { label: string; icon: typeof Search; color: string }> = {
  search_papers: { label: "Searching OpenAlex", icon: Search, color: "bg-blue text-white" },
  trend_experiment: { label: "Trend Lab experiment", icon: FlaskConical, color: "bg-lime" },
  venue_fit_experiment: { label: "Venue Fit experiment", icon: Building2, color: "bg-mint" },
  text_integrity_test: { label: "Prose Integrity scan", icon: Sparkles, color: "bg-orange" },
  check_citation: { label: "Citation verification", icon: BookOpenCheck, color: "bg-yellow" },
  check_retraction: { label: "Retraction Watch lookup", icon: ShieldAlert, color: "bg-crit text-white" },
  test_claim: { label: "Claim–Abstract test", icon: TestTube2, color: "bg-violet text-white" },
  list_papers: { label: "Workspace papers", icon: ListChecks, color: "bg-surface-2" },
  audit_paper: { label: "CiteGuard 5-check audit", icon: ShieldCheck, color: "bg-yellow" },
  review_paper: { label: "4-Persona Reviewer Jury", icon: Gavel, color: "bg-pink" },
  scan_field: { label: "Gap Radar cluster scan", icon: Radar, color: "bg-lime" },
  research_questions: { label: "Grounded RQ generator", icon: Lightbulb, color: "bg-orange" },
  save_note: { label: "Saved Workspace Page", icon: NotebookPen, color: "bg-yellow" },
  pin_stickies: { label: "Pinned Sticky Cards", icon: Pin, color: "bg-pink" },
  add_todos: { label: "Added Research Tasks", icon: ListTodo, color: "bg-lime" },
};

const QUICK_LABS: { label: string; icon: typeof Lightbulb; color: string; prompt: string; autoSend?: boolean }[] = [
  {
    label: "Brainstorm + Momentum",
    icon: Lightbulb,
    color: "bg-yellow",
    prompt: "Brainstorm 3 novel research ideas in speculative decoding, run a trend_experiment to see which sub-direction is accelerating fastest, and pin the top 3 ideas to my sticky board.",
    autoSend: true,
  },
  {
    label: "Trend Lab",
    icon: FlaskConical,
    color: "bg-lime",
    prompt: "Run a trend_experiment comparing: QLoRA, DoRA, AdaLoRA, GaLore from 2020 onward and interpret the momentum curves.",
    autoSend: true,
  },
  {
    label: "Venue Fit",
    icon: Building2,
    color: "bg-mint",
    prompt: "Run a venue_fit_experiment for 'retrieval-augmented generation hallucination mitigation' and recommend the best workshop and main-track venues.",
    autoSend: true,
  },
  {
    label: "Retraction Test",
    icon: ShieldAlert,
    color: "bg-crit text-white",
    prompt: "Check whether DOI 10.1155/2022/4989248 is retracted and explain the evidence notice.",
    autoSend: true,
  },
  {
    label: "Prose Scan",
    icon: Sparkles,
    color: "bg-orange",
    prompt: "Run text_integrity_test on this draft snippet: 'Our profound neural organization achieves 100% accuracy on colossal information and completely solves hallucination.'",
    autoSend: true,
  },
  {
    label: "Save Action Plan",
    icon: NotebookPen,
    color: "bg-pink",
    prompt: "List our uploaded papers, summarize what experiments or fixes are most urgent, save a clean IEEE experiment plan note to my Pages, and add 4 concrete tasks to my To-dos.",
    autoSend: true,
  },
];

const SERIES_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#9b6bff"];

function TrendChart({ series }: { series: Record<string, Record<string, number>> }) {
  const [hoverYr, setHoverYr] = useState<number | null>(null);
  const names = Object.keys(series);
  const years = [...new Set(names.flatMap((n) => Object.keys(series[n])))].map(Number).sort((a, b) => a - b);
  if (!years.length) return null;
  const max = Math.max(1, ...names.flatMap((n) => Object.values(series[n])));
  const W = 340, H = 128, P = 10;
  const x = (i: number) => P + (i * (W - 2 * P)) / Math.max(1, years.length - 1);
  const y = (v: number) => H - P - (v / max) * (H - 2 * P);
  const hiIdx = hoverYr !== null ? years.indexOf(hoverYr) : -1;

  return (
    <div className="mt-2.5 rounded-xl border-2 border-edge bg-bg/70 p-2.5">
      <div className="mb-1 flex items-center justify-between text-[10.5px] font-bold uppercase tracking-wider text-muted">
        <span>OpenAlex Longitudinal Experiment</span>
        {hoverYr !== null && (
          <span className="rounded bg-yellow px-1.5 py-0.5 text-[#121212]">
            {hoverYr}: {names.map((n) => `${n} (${series[n][hoverYr] ?? 0})`).join(" · ")}
          </span>
        )}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-28 w-full overflow-visible"
        role="img"
        aria-label="publications per year"
        onMouseLeave={() => setHoverYr(null)}
      >
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={P} x2={W - P} y1={y(max * f)} y2={y(max * f)} stroke="currentColor" opacity={0.09} strokeDasharray="3 3" />
        ))}
        {hiIdx >= 0 && (
          <line x1={x(hiIdx)} x2={x(hiIdx)} y1={P} y2={H - P} stroke="var(--pink)" strokeWidth={1.5} strokeDasharray="3 3" />
        )}
        {names.map((n, si) => {
          const pts = years.map((yr, i) => `${x(i)},${y(series[n][yr] ?? 0)}`).join(" ");
          return (
            <g key={n}>
              <motion.polyline
                points={pts}
                fill="none"
                stroke={SERIES_COLORS[si % 4]}
                strokeWidth={2.8}
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 1.05, delay: si * 0.14 }}
              />
              {years.map((yr, i) => (
                <motion.circle
                  key={yr}
                  cx={x(i)}
                  cy={y(series[n][yr] ?? 0)}
                  r={hoverYr === yr ? 4.8 : 3.2}
                  fill={SERIES_COLORS[si % 4]}
                  stroke="#121212"
                  strokeWidth={1.2}
                  className="cursor-pointer"
                  onMouseEnter={() => setHoverYr(yr)}
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: 0.45 + i * 0.04 }}
                >
                  <title>{`${n} · ${yr}: ${series[n][yr] ?? 0} papers`}</title>
                </motion.circle>
              ))}
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink-2">
        <span className="tabular font-semibold">{years[0]}</span>
        <span className="flex flex-wrap gap-2.5">
          {names.map((n, i) => (
            <span key={n} className="inline-flex items-center gap-1 font-bold">
              <span className="inline-block size-2.5 rounded-full border border-[#121212]" style={{ background: SERIES_COLORS[i % 4] }} />
              {n}
            </span>
          ))}
        </span>
        <span className="tabular font-semibold">{years[years.length - 1]}*</span>
      </div>
    </div>
  );
}

function MiniBarChart({ items }: { items: { label: string; value: number }[] }) {
  if (!items.length) return null;
  const max = Math.max(1, ...items.map((x) => x.value));
  const palette = ["bg-lime", "bg-yellow", "bg-pink", "bg-mint", "bg-orange", "bg-blue text-white"];
  return (
    <div className="mt-2.5 space-y-1.5 rounded-xl border-2 border-edge bg-bg/70 p-2.5">
      {items.map((it, i) => {
        const pct = Math.max(6, Math.round((it.value / max) * 100));
        return (
          <div key={it.label} className="space-y-0.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="truncate font-semibold text-ink-2">{it.label}</span>
              <span className="tabular font-display font-extrabold">{it.value}</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full border border-edge bg-surface">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.7, delay: i * 0.07, ease: [0.22, 1, 0.36, 1] }}
                className={clsx("h-full rounded-full", palette[i % palette.length])}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ThoughtTrace({ thoughts, live }: { thoughts?: string[]; live?: boolean }) {
  const [open, setOpen] = useState(Boolean(live));
  if (!thoughts || thoughts.length === 0) return null;
  return (
    <div className="rounded-xl border-2 border-dashed border-edge/50 bg-surface-2/70 px-3 py-2 text-xs">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 text-left font-display text-[11.5px] font-extrabold text-ink-2"
      >
        <BrainCircuit className={clsx("size-3.5 text-violet", live && "animate-pulse")} />
        <span>Agent reasoning ({thoughts.length} step{thoughts.length === 1 ? "" : "s"})</span>
        <ChevronDown className={clsx("ml-auto size-3.5 transition-transform", open && "rotate-180")} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ol
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="mt-1.5 space-y-1 overflow-hidden border-t border-line pt-1.5 text-[11.5px] text-ink-2"
          >
            {thoughts.map((t, idx) => (
              <li key={idx} className="flex gap-1.5">
                <span className="tabular font-mono text-[10px] font-bold text-muted">{idx + 1}.</span>
                <span>{t}</span>
              </li>
            ))}
          </motion.ol>
        )}
      </AnimatePresence>
    </div>
  );
}

function linkLabel(link: AppLink) {
  if (link.tab === "notes") {
    if (link.notesView === "stickies") return "Open Sticky Board";
    if (link.notesView === "todos") return "Open To-dos";
    return "Open in Notes";
  }
  if (link.tab === "explore") return "Open Gap Radar";
  if (link.tab === "audit") return "Open CiteGuard Audit";
  if (link.tab === "verdict") return "Open Jury Verdict";
  return "Open in app";
}

function ToolCard({ t, onOpen }: { t: ToolCall; onOpen: (l: AppLink) => void }) {
  const meta = TOOL_META[t.name] ?? { label: t.name, icon: FlaskConical, color: "bg-surface-2" };
  const args = Object.entries(t.args ?? {})
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v).slice(0, 70)}`)
    .join(" · ");

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -14, scale: 0.97 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 300, damping: 24 }}
      className="rounded-2xl border-[2.5px] border-edge bg-surface p-3 shadow-[3px_3px_0_var(--shadow-c)]"
    >
      <div className="flex items-center gap-2.5">
        <span className={clsx("grid size-8 shrink-0 place-items-center rounded-xl border-2 border-edge", meta.color, !meta.color.includes("text-white") && "text-[#121212]")}>
          <meta.icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 font-display text-[13px] font-extrabold">
            {meta.label}
            {t.status === "running" && <Loader2 className="size-3.5 animate-spin text-pink" />}
            {t.status === "done" && <Check className="size-3.5 text-good" />}
            {t.status === "error" && <X className="size-3.5 text-crit" />}
          </div>
          {args && <div className="truncate font-mono text-[10.5px] text-muted">{args}</div>}
        </div>
      </div>

      {(t.summary || t.progress) && (
        <div className={clsx("mt-2 text-xs font-medium", t.status === "error" ? "text-crit-ink" : "text-ink-2")}>
          {t.status === "running" ? t.progress : t.summary}
        </div>
      )}

      {t.chart?.type === "multi" && t.chart.series && <TrendChart series={t.chart.series} />}
      {t.chart?.type === "bar" && t.chart.items && <MiniBarChart items={t.chart.items} />}

      {t.papers && t.papers.length > 0 && (
        <ul className="mt-2 space-y-1 rounded-xl border border-line bg-surface-2/50 p-2">
          {t.papers.slice(0, 4).map((p) => (
            <li key={p.title} className="truncate text-[11.5px]">
              <a href={p.url} target="_blank" rel="noreferrer" className="font-semibold underline decoration-pink decoration-2">
                {p.title}
              </a>
              <span className="text-muted">
                {p.year ? ` · ${p.year}` : ""}
                {p.venue ? ` · ${p.venue}` : ""}
                {p.cited_by != null ? ` · ${p.cited_by} cites` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}

      {t.link && (
        <button
          onClick={() => onOpen(t.link!)}
          className="btn-brut mt-2.5 inline-flex items-center gap-1 rounded-lg bg-lime px-2.5 py-1 font-display text-[11px] font-extrabold text-[#121212]"
        >
          {linkLabel(t.link)} <ArrowRight className="size-3" />
        </button>
      )}
    </motion.div>
  );
}

export function AuroraChat({
  open, onClose, onOpenLink, name,
}: {
  open: boolean; onClose: () => void; onOpenLink: (l: AppLink) => void; name: string;
}) {
  const [chatId, setChatId] = usePersistent<string | null>("auroraChat", null);
  const [studio, setStudio] = usePersistent<boolean>("auroraStudio", false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [live, setLive] = useState<ToolCall[]>([]);
  const [liveThoughts, setLiveThoughts] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [savedIdx, setSavedIdx] = useState<number | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const es = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!chatId) return;
    api.get<{ messages: Msg[] }>(`/api/agent/chats/${chatId}`)
      .then((c) => setMessages(c.messages))
      .catch(() => setChatId(null));
  }, [chatId, setChatId]);

  useEffect(() => {
    if (!historyOpen) return;
    api.get<ChatSummary[]>("/api/agent/chats").then(setChats).catch(() => setChats([]));
  }, [historyOpen]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages, live, liveThoughts, busy]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 220);
  }, [open]);

  useEffect(() => () => es.current?.close(), []);

  const saveReplyToNotes = async (md: string, idx: number) => {
    try {
      const cur = await api.get<{ items: Record<string, unknown>[] }>("/api/workspace/pages");
      const firstLine = md.split("\n").find((l) => l.trim())?.replace(/^#+\s*/, "").slice(0, 64) || "Azora AI Lab Note";
      const pid = Math.random().toString(36).slice(2, 10);
      const next = [
        { id: pid, title: firstLine, md: `# ${firstLine}\n\n${md}`, template: "ieee", updated: Date.now(), emoji: "✨" },
        ...(cur.items ?? []),
      ];
      await api.put("/api/workspace/pages", { items: next });
      writePersistent("notesView", "pages");
      writePersistent("notesActive", pid);
      setSavedIdx(idx);
      setTimeout(() => setSavedIdx(null), 2200);
      toast({ title: "Saved to Workspace → Pages", body: firstLine, tone: "good" });
    } catch (e) {
      toast({ title: "Couldn't save note", body: (e as Error).message, tone: "crit" });
    }
  };

  const copyReply = (md: string, idx: number) => {
    navigator.clipboard?.writeText(md).then(() => {
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 1600);
    }).catch(() => {});
  };

  const send = async (text: string) => {
    const msg = text.trim();
    if (!msg || busy) return;
    es.current?.close();
    setInput("");
    setBusy(true);
    setLive([]);
    setLiveThoughts([]);
    setHistoryOpen(false);
    setMessages((m) => [...m, { role: "user", content: msg }]);

    try {
      const r = await api.post<{ job_id: string; chat_id: string }>("/api/agent/chat", { message: msg, chat_id: chatId });
      setChatId(r.chat_id);
      let finished = false;
      const src = jobEvents(r.job_id);
      es.current = src;

      const finish = async (errBody?: string) => {
        if (finished) return;
        finished = true;
        src.close();
        if (errBody) toast({ title: "Azora AI hit an error", body: errBody, tone: "crit" });
        try {
          const c = await api.get<{ messages: Msg[] }>(`/api/agent/chats/${r.chat_id}`);
          setMessages(c.messages);
        } catch {}
        setLive([]);
        setLiveThoughts([]);
        setBusy(false);
      };

      src.onmessage = (m) => {
        let ev: { stage: string; message: string };
        try { ev = JSON.parse(m.data); } catch { return; }
        if (ev.stage === "agent_thought") {
          try {
            const p = JSON.parse(ev.message) as { thought?: string };
            if (p.thought) setLiveThoughts((ts) => (ts[ts.length - 1] === p.thought ? ts : [...ts, p.thought!]));
          } catch {}
          return;
        }
        if (!ev.stage.startsWith("tool_")) return;
        let p: ToolCall & { message?: string };
        try { p = JSON.parse(ev.message); } catch { return; }
        setLive((xs) => {
          if (ev.stage === "tool_start") return [...xs, { ...p, status: "running" }];
          if (ev.stage === "tool_progress") return xs.map((t) => (t.id === p.id ? { ...t, progress: p.message } : t));
          if (ev.stage === "tool_done") return xs.map((t) => (t.id === p.id ? { ...t, ...p } : t));
          return xs;
        });
      };

      src.addEventListener("end", (m) => {
        try {
          const job = JSON.parse((m as MessageEvent).data) as { status: string; error?: string };
          void finish(job.status !== "done" ? job.error ?? "Job failed" : undefined);
        } catch {
          void finish();
        }
      });

      src.onerror = () => {
        if (finished) return;
        api.get<{ status: string; error?: string }>(`/api/jobs/${r.job_id}`)
          .then((job) => {
            if (job.status === "done" || job.status === "error") {
              void finish(job.status === "error" ? job.error : undefined);
            } else if (src.readyState === EventSource.CLOSED) {
              void finish("Connection interrupted");
            }
          })
          .catch(() => {
            if (src.readyState === EventSource.CLOSED) void finish("Lost connection to backend");
          });
      };
    } catch (e) {
      setBusy(false);
      toast({ title: "Couldn't reach Azora AI", body: (e as Error).message, tone: "crit" });
    }
  };

  const newChat = () => {
    es.current?.close();
    setChatId(null);
    setMessages([]);
    setLive([]);
    setLiveThoughts([]);
    setBusy(false);
    setHistoryOpen(false);
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-50 bg-black/35 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            role="dialog"
            aria-label="Azora AI research agent"
            layout
            initial={{ x: "105%" }}
            animate={{ x: 0 }}
            exit={{ x: "105%" }}
            transition={{ type: "spring", stiffness: 270, damping: 28 }}
            className={clsx(
              "fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l-[3px] border-edge bg-bg shadow-[-10px_0_0_var(--shadow-c)] transition-[max-width] duration-300",
              studio ? "sm:max-w-[900px]" : "sm:max-w-[490px]",
            )}
          >
            {/* Header */}
            <header className="mesh-hero relative flex items-center gap-3 border-b-[2.5px] border-edge bg-surface px-4 py-3.5">
              <AuroraOrb size={42} thinking={busy} ring />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-display text-lg font-extrabold leading-none">Azora AI</span>
                  <span className="rounded-full border-2 border-[#121212] bg-lime px-2 py-0.5 font-display text-[10px] font-extrabold uppercase tracking-wider text-[#121212]">
                    Agentic Lab · 15 Tools
                  </span>
                </div>
                <div className="mt-1 truncate text-[11.5px] text-ink-2">
                  {busy
                    ? live.some((t) => t.status === "running")
                      ? `Running live experiment: ${TOOL_META[live.find((t) => t.status === "running")!.name]?.label ?? "tool"}…`
                      : "Planning next reasoning step…"
                    : "Brainstorms, runs live experiments, checks citations & writes to your workspace"}
                </div>
              </div>
              <button
                onClick={() => setHistoryOpen((h) => !h)}
                title="Past lab sessions"
                className={clsx("btn-brut grid size-9 place-items-center rounded-xl", historyOpen ? "bg-yellow text-[#121212]" : "bg-surface")}
              >
                <History className="size-4" />
              </button>
              <button
                onClick={() => setStudio((s) => !s)}
                title={studio ? "Compact copilot drawer" : "Expand Agent Studio"}
                className="btn-brut hidden size-9 place-items-center rounded-xl bg-surface sm:grid"
              >
                {studio ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
              </button>
              <button onClick={newChat} title="New session" className="btn-brut grid size-9 place-items-center rounded-xl bg-surface">
                <Plus className="size-4" />
              </button>
              <button onClick={onClose} title="Close" className="btn-brut grid size-9 place-items-center rounded-xl bg-surface">
                <X className="size-4" />
              </button>
            </header>

            {/* Session History Drawer */}
            <AnimatePresence>
              {historyOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden border-b-[2.5px] border-edge bg-surface-2"
                >
                  <div className="max-h-52 space-y-1.5 overflow-y-auto p-3">
                    <div className="flex items-center justify-between px-1 text-[11px] font-bold uppercase tracking-wider text-muted">
                      <span>Recent Azora Sessions</span>
                      <button onClick={newChat} className="text-accent-ink underline">+ Start fresh</button>
                    </div>
                    {chats.length === 0 && <div className="py-3 text-center text-xs text-muted">No saved sessions yet.</div>}
                    {chats.map((c) => (
                      <button
                        key={c.chat_id}
                        onClick={() => { setChatId(c.chat_id); setHistoryOpen(false); }}
                        className={clsx(
                          "flex w-full items-center justify-between gap-2 rounded-xl border-2 px-3 py-2 text-left text-xs font-semibold transition",
                          c.chat_id === chatId ? "border-edge bg-yellow text-[#121212]" : "border-transparent bg-surface hover:border-edge",
                        )}
                      >
                        <span className="truncate">{c.title}</span>
                        <span className="tabular shrink-0 rounded-full border border-edge/40 px-1.5 py-0.5 text-[10px] text-muted">{c.n} msgs</span>
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Conversation Stream */}
            <div ref={scroller} className="flex-1 space-y-4 overflow-y-auto px-4 py-5">
              {messages.length === 0 && !busy && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="pt-2">
                  <div className="rounded-3xl border-[2.5px] border-edge bg-surface p-5 text-center shadow-[5px_5px_0_var(--shadow-c)]">
                    <AuroraOrb size={82} ring className="mx-auto" />
                    <h3 className="mt-4 font-display text-2xl font-extrabold">
                      Hey {name}, ready to run some experiments?
                    </h3>
                    <p className="mx-auto mt-1.5 max-w-md text-sm text-ink-2">
                      I&apos;m <b>Azora AI</b> — your agentic research lab partner. Ask me to brainstorm hypotheses, test longitudinal publication trends, verify citations &amp; retractions, check prose integrity, or write outlines &amp; tasks straight into your workspace.
                    </p>
                    <div className="mt-4 flex flex-wrap justify-center gap-1.5 text-[11px] font-bold">
                      {["OpenAlex Trends", "Crossref + Retraction Watch", "Claim support check", "Gap Radar", "Workspace Sync"].map((tag) => (
                        <span key={tag} className="rounded-full border-2 border-edge bg-surface-2 px-2.5 py-0.5">{tag}</span>
                      ))}
                    </div>
                  </div>

                  <div className="mt-5">
                    <div className="mb-2.5 font-display text-xs font-extrabold uppercase tracking-widest text-muted">
                      Launch a live agentic experiment
                    </div>
                    <div className={clsx("grid gap-2.5", studio ? "sm:grid-cols-2" : "grid-cols-1")}>
                      {QUICK_LABS.map((lab, i) => (
                        <motion.button
                          key={lab.label}
                          initial={{ opacity: 0, y: 14 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.06 + i * 0.05 }}
                          whileHover={{ y: -2 }}
                          onClick={() => (lab.autoSend ? send(lab.prompt) : setInput(lab.prompt))}
                          className="btn-brut flex items-start gap-3 rounded-2xl bg-surface p-3 text-left"
                        >
                          <span className={clsx("mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl border-2 border-edge", lab.color, !lab.color.includes("text-white") && "text-[#121212]")}>
                            <lab.icon className="size-4" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="font-display text-sm font-extrabold">{lab.label}</div>
                            <div className="mt-0.5 line-clamp-2 text-xs text-ink-2">{lab.prompt}</div>
                          </div>
                        </motion.button>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}

              {messages.map((m, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ type: "spring", stiffness: 300, damping: 26 }}
                  className={clsx("flex", m.role === "user" ? "justify-end" : "gap-2.5")}
                >
                  {m.role === "assistant" && <AuroraOrb size={30} className="mt-1" />}
                  <div className={clsx("min-w-0", m.role === "user" ? "max-w-[85%]" : "flex-1 space-y-2")}>
                    {m.role === "assistant" && m.thoughts && m.thoughts.length > 0 && (
                      <ThoughtTrace thoughts={m.thoughts} />
                    )}
                    {m.role === "assistant" && m.tools && m.tools.length > 0 && (
                      <div className={clsx("grid gap-2", studio && m.tools.length > 1 ? "md:grid-cols-2" : "grid-cols-1")}>
                        {m.tools.map((t) => <ToolCard key={t.id} t={t} onOpen={onOpenLink} />)}
                      </div>
                    )}
                    <div
                      className={clsx(
                        "rounded-2xl border-[2.5px] border-edge px-3.5 py-2.5 shadow-[3px_3px_0_var(--shadow-c)]",
                        m.role === "user" ? "rounded-br-md bg-pink text-[#121212]" : "rounded-tl-md bg-surface",
                      )}
                    >
                      {m.role === "user" ? (
                        <p className="whitespace-pre-wrap text-sm font-medium">{m.content}</p>
                      ) : (
                        <>
                          <div className="md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown></div>
                          <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-dashed border-line pt-2 text-[11px]">
                            <button
                              type="button"
                              onClick={() => copyReply(m.content, i)}
                              className="inline-flex items-center gap-1 rounded-lg border border-edge/40 bg-surface-2 px-2 py-0.5 font-semibold text-ink-2 hover:border-edge hover:text-ink"
                            >
                              {copiedIdx === i ? <><Check className="size-3 text-good" />Copied</> : <><Copy className="size-3" />Copy</>}
                            </button>
                            <button
                              type="button"
                              onClick={() => saveReplyToNotes(m.content, i)}
                              className="inline-flex items-center gap-1 rounded-lg border border-edge/40 bg-yellow px-2 py-0.5 font-semibold text-[#121212] hover:bg-yellow"
                            >
                              {savedIdx === i ? <><Check className="size-3" />Saved to Pages</> : <><FilePlus2 className="size-3" />Save to Notes</>}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </motion.div>
              ))}

              {busy && (
                <div className="flex gap-2.5">
                  <AuroraOrb size={30} thinking className="mt-1" />
                  <div className="flex-1 space-y-2">
                    {liveThoughts.length > 0 && <ThoughtTrace thoughts={liveThoughts} live />}
                    {live.map((t) => <ToolCard key={t.id} t={t} onOpen={onOpenLink} />)}
                    <div className="inline-flex items-center gap-1.5 rounded-2xl border-[2.5px] border-edge bg-surface px-4 py-3 shadow-[3px_3px_0_var(--shadow-c)]">
                      <span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" />
                      <span className="ml-2 font-display text-xs font-bold text-ink-2">
                        {live.some((t) => t.status === "running") ? "Executing live experiment…" : "Synthesizing evidence…"}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Quick Mode Strip when chatting */}
            {messages.length > 0 && (
              <div className="flex gap-1.5 overflow-x-auto border-t-2 border-dashed border-line bg-surface-2/60 px-3 py-2">
                {QUICK_LABS.map((lab) => (
                  <button
                    key={lab.label}
                    type="button"
                    disabled={busy}
                    onClick={() => setInput(lab.prompt)}
                    className="inline-flex shrink-0 items-center gap-1 rounded-full border-2 border-edge bg-surface px-2.5 py-0.5 text-[11px] font-bold transition hover:-translate-y-0.5 disabled:opacity-40"
                  >
                    <lab.icon className="size-3 text-pink" />
                    {lab.label}
                  </button>
                ))}
              </div>
            )}

            {/* Composer */}
            <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="border-t-[2.5px] border-edge bg-surface p-3">
              <div className="flex items-end gap-2 rounded-2xl border-[2.5px] border-edge bg-bg p-2 shadow-[3px_3px_0_var(--shadow-c)] focus-within:shadow-[4px_4px_0_var(--accent)]">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  rows={1}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
                  placeholder="Brainstorm, test a claim/DOI, compare trends, or save an experiment plan…"
                  className="max-h-36 min-h-[40px] flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-muted"
                />
                <motion.button
                  whileTap={{ scale: 0.9 }}
                  type="submit"
                  disabled={busy || !input.trim()}
                  className="grid size-10 shrink-0 place-items-center rounded-xl border-2 border-edge bg-pink text-[#121212] disabled:opacity-40"
                >
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-5" />}
                </motion.button>
              </div>
              <p className="mt-1.5 text-center text-[10.5px] text-muted">
                Azora AI executes 15 real scholarly &amp; workspace tools — never fabricates papers or citations.
              </p>
            </form>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

/** Floating launcher with a pulsing sentient orb. */
export function AuroraLauncher({ onClick }: { onClick: () => void }) {
  return (
    <motion.button
      onClick={onClick}
      initial={{ scale: 0, rotate: -20 }}
      animate={{ scale: 1, rotate: 0 }}
      whileHover={{ scale: 1.06, rotate: -1.5 }}
      whileTap={{ scale: 0.94 }}
      transition={{ type: "spring", stiffness: 300, damping: 18 }}
      className="fixed bottom-24 right-5 z-40 flex items-center gap-2.5 rounded-full border-[2.5px] border-edge bg-surface py-2 pl-2 pr-4 shadow-[4px_4px_0_var(--shadow-c)] lg:bottom-6"
      title="Open Azora AI Lab (A)"
    >
      <AuroraOrb size={38} ring />
      <div className="text-left">
        <span className="block font-display text-sm font-extrabold leading-tight">Azora AI</span>
        <span className="block text-[10px] font-bold text-muted">Agentic Lab · A</span>
      </div>
    </motion.button>
  );
}
