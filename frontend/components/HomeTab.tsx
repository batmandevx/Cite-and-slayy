"use client";

import { useAuth } from "@/components/auth/AuthProvider";
import clsx from "clsx";
import {
  Activity, ArrowRight, Bot, Calendar, CheckCircle2, Compass, FilePen, Flame, Gavel, Layers, ListTodo,
  NotebookPen, OctagonX, Pencil, Pin, Radar, RefreshCw, RotateCcw, ShieldCheck, Sparkles, Trophy, Zap,
} from "lucide-react";
import { motion } from "motion/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, usePersistent } from "@/lib/api";
import type { GapClass } from "@/lib/types";
import { AuroraOrb } from "./aurora/AuroraOrb";
import { CLASS_COLORS, CLASS_LABEL, chrome, ReactECharts, tooltipBase } from "./charts";
import { AnimatedNumber, SpotlightCard } from "./motion";
import { useTheme } from "./theme";
import { ThoughtOfTheDay } from "./ThoughtOfTheDay";
import { Badge, Card, Empty } from "./ui";

export interface OpenTarget {
  tab: "home" | "studio" | "explore" | "draft" | "audit" | "verdict" | "notes" | "library" | "play";
  gap?: string;
  doc?: string;
  audit?: string;
  review?: string;
  chat?: string;
  notesView?: "pages" | "stickies" | "todos";
  noteId?: string;
}

type ActivityKind = "all" | "scan" | "draft" | "audit" | "verdict" | "chat";

interface Dash {
  totals: Record<string, number | null>;
  streaks?: { current: number; longest: number; active_days: number; best_day: { date: string; total: number } | null };
  activity: { date: string; total: number; scan?: number; audit?: number; verdict?: number; draft?: number; chat?: number }[];
  weekly_velocity?: { week: string; end: string; scan: number; draft: number; audit: number; verdict: number; chat: number; total: number; cumulative: number }[];
  ref_status: Record<string, number>;
  claim_labels?: Record<string, number>;
  score_radar?: { axis: string; pct: number }[];
  persona_radar?: { persona: string; avg: number; n: number }[];
  decisions: Record<string, number>;
  papers: {
    document_id: string; audit_id: string; title: string; score: number; references: number;
    verified?: number; not_found?: number; retracted_cited: number; self_retracted: boolean;
    phrases?: number; overlaps?: number;
  }[];
  gap: { run_id: string; query: string; n_papers: number; classes: Record<string, number>; clusters: { label: string; size: number; classification: GapClass; growth: number; cites_per_year?: number }[] } | null;
  workspace?: { pages: number; stickies: number; todos_total: number; todos_done: number; tool_runs: number; top_tools: { name: string; count: number }[] };
  feed: { kind: string; title: string; at: string; ids: Record<string, string | undefined> }[];
}

function greeting(h: number) {
  if (h < 5) return "Burning the midnight oil";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 21) return "Good evening";
  return "Good night";
}

function toLocalIso(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const ago = (iso: string) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (Number.isNaN(s) || s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

// ---------- GitHub-style Contribution Heatmap with Category Filters ----------
const RAMPS: Record<ActivityKind, { light: string[]; dark: string[]; label: string; pill: string }> = {
  all: {
    label: "All",
    pill: "bg-lime text-[#121212]",
    light: ["var(--surface-3)", "#d9f99d", "#a3e635", "#65a30d", "#365314"],
    dark: ["#2a2622", "#1f3d14", "#3f6212", "#65a30d", "#a3e635"],
  },
  scan: {
    label: "Scans",
    pill: "bg-mint text-[#121212]",
    light: ["var(--surface-3)", "#bbf7d0", "#4ade80", "#16a34a", "#14532d"],
    dark: ["#2a2622", "#143828", "#15803d", "#22c55e", "#5ce1b9"],
  },
  draft: {
    label: "Drafts",
    pill: "bg-blue text-white",
    light: ["var(--surface-3)", "#bfdbfe", "#60a5fa", "#2563eb", "#1e3a8a"],
    dark: ["#2a2622", "#172554", "#1d4ed8", "#3b82f6", "#93c5fd"],
  },
  audit: {
    label: "Audits",
    pill: "bg-yellow text-[#121212]",
    light: ["var(--surface-3)", "#fef08a", "#facc15", "#ca8a04", "#713f12"],
    dark: ["#2a2622", "#422006", "#a16207", "#eab308", "#fde047"],
  },
  verdict: {
    label: "Verdicts",
    pill: "bg-pink text-[#121212]",
    light: ["var(--surface-3)", "#fbcfe8", "#f472b6", "#db2777", "#831843"],
    dark: ["#2a2622", "#4a122f", "#9d174d", "#ec4899", "#ff8cc4"],
  },
  chat: {
    label: "Azora AI",
    pill: "bg-violet text-white",
    light: ["var(--surface-3)", "#ddd6fe", "#a78bfa", "#7c3aed", "#4c1d95"],
    dark: ["#2a2622", "#2e1065", "#5b21b6", "#8b5cf6", "#c4b5fd"],
  },
};

function SnakeToggle({ on, setOn, eaten }: { on: boolean; setOn: (v: boolean) => void; eaten: number }) {
  return (
    <span className="flex items-center gap-2">
      <motion.button whileTap={{ scale: 0.9 }} onClick={() => setOn(!on)}
        className={clsx("inline-flex items-center gap-1 rounded-full border-2 border-edge px-2 py-0.5 font-display text-[11px] font-extrabold", on ? "bg-pink text-[#121212]" : "bg-surface")}>
        🐍 {on ? "Snake on" : "Snake off"}
      </motion.button>
      {on && <motion.span key={eaten} initial={{ scale: 1.5 }} animate={{ scale: 1 }} className="font-bold tabular-nums">{eaten} eaten</motion.span>}
    </span>
  );
}

function Heatmap({ activity, streaks }: { activity: Dash["activity"]; streaks?: Dash["streaks"] }) {
  const { theme } = useTheme();
  const [filter, setFilter] = useState<ActivityKind>("all");
  const [hover, setHover] = useState<{ d: string; v: Dash["activity"][number] | undefined; x: number; y: number } | null>(null);
  const levels = RAMPS[filter][theme];
  const map = useMemo(() => new Map(activity.map((a) => [a.date, a])), [activity]);

  const weeks = 26;
  const cells = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(today);
    start.setDate(start.getDate() - (weeks * 7 - 1) - today.getDay());
    const out: { d: string; col: number; row: number }[] = [];
    for (let i = 0; i < weeks * 7 + today.getDay() + 1; i++) {
      const dt = new Date(start);
      dt.setDate(start.getDate() + i);
      if (dt > today) break;
      out.push({ d: toLocalIso(dt), col: Math.floor(i / 7), row: dt.getDay() });
    }
    return out;
  }, []);

  const valOf = useCallback(
    (a?: Dash["activity"][number]) => (!a ? 0 : filter === "all" ? a.total : (a[filter] ?? 0)),
    [filter],
  );
  const max = Math.max(1, ...activity.map((a) => valOf(a)));
  const level = (v: number) => (v <= 0 ? 0 : Math.min(4, Math.ceil((v / max) * 4)));
  const total = activity.reduce((s, a) => s + valOf(a), 0);

  const months: { col: number; label: string }[] = [];
  cells.forEach((c) => {
    if (c.row === 0) {
      const m = new Date(`${c.d}T12:00:00`).toLocaleString(undefined, { month: "short" });
      if (!months.length || months[months.length - 1].label !== m) months.push({ col: c.col, label: m });
    }
  });
  const S = 13.5, G = 3.2;
  // Snake: walks the grid column by column (down, then up), eating every active day it passes.
  const path = useMemo(() => {
    const byCol = new Map<number, typeof cells>();
    cells.forEach((c) => byCol.set(c.col, [...(byCol.get(c.col) ?? []), c]));
    return [...byCol.keys()].sort((a, b) => a - b).flatMap((col) => {
      const cs = [...byCol.get(col)!].sort((a, b) => a.row - b.row);
      return col % 2 ? cs.reverse() : cs;
    });
  }, [cells]);
  const [snakeOn, setSnakeOn] = useState(true);
  const [head, setHead] = useState(-1);
  useEffect(() => {
    if (!snakeOn) return;
    const t = setInterval(() => setHead((h) => (h >= path.length + 25 ? -1 : h + 1)), 55);
    return () => clearInterval(t);
  }, [snakeOn, path.length]);
  const eatenSet = useMemo(() => new Set(snakeOn && head >= 0 ? path.slice(0, Math.min(head, path.length)).map((c) => c.d) : []), [path, head, snakeOn]);
  const eaten = path.slice(0, Math.max(0, Math.min(head, path.length))).filter((c) => valOf(map.get(c.d)) > 0).length;
  const SNAKE_LEN = 7;
  const xy = (c: { col: number; row: number }) => [30 + c.col * (S + G), 16 + c.row * (S + G)] as const;

  return (
    <div className="relative">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-display text-lg font-extrabold">
            <AnimatedNumber value={total} />{" "}
            {filter === "all" ? "research actions" : `${RAMPS[filter].label.toLowerCase()} actions`}{" "}
            <span className="text-sm font-bold text-muted">in the last 26 weeks</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          {(Object.keys(RAMPS) as ActivityKind[]).map((k) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={clsx(
                "rounded-full border-2 border-edge px-2.5 py-0.5 font-display text-[11px] font-extrabold transition hover:-translate-y-0.5",
                filter === k ? RAMPS[k].pill : "bg-surface text-ink-2",
              )}
            >
              {RAMPS[k].label}
            </button>
          ))}
        </div>
      </div>

      {/* Streak mini-strip */}
      {streaks && (
        <div className="mb-3.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="flex items-center gap-2 rounded-xl border-2 border-edge bg-surface-2 px-3 py-1.5">
            <Flame className="size-4 shrink-0 text-orange" />
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted">Current streak</div>
              <div className="font-display text-sm font-extrabold">{streaks.current} day{streaks.current === 1 ? "" : "s"}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-xl border-2 border-edge bg-surface-2 px-3 py-1.5">
            <Zap className="size-4 shrink-0 text-pink" />
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted">Longest streak</div>
              <div className="font-display text-sm font-extrabold">{streaks.longest} day{streaks.longest === 1 ? "" : "s"}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-xl border-2 border-edge bg-surface-2 px-3 py-1.5">
            <Calendar className="size-4 shrink-0 text-blue" />
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted">Active days</div>
              <div className="font-display text-sm font-extrabold">{streaks.active_days}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-xl border-2 border-edge bg-surface-2 px-3 py-1.5">
            <Trophy className="size-4 shrink-0 text-warn" />
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted">Peak output</div>
              <div className="font-display text-sm font-extrabold">
                {streaks.best_day ? `${streaks.best_day.total} on ${streaks.best_day.date.slice(5)}` : "—"}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="overflow-x-auto pb-1">
        <svg width={(weeks + 1) * (S + G) + 32} height={7 * (S + G) + 22} className="block">
          {months.map((m) => (
            <text key={m.col + m.label} x={30 + m.col * (S + G)} y={10} fontSize={10} fill="currentColor" opacity={0.65} fontWeight={700}>
              {m.label}
            </text>
          ))}
          {["Mon", "Wed", "Fri"].map((d, i) => (
            <text key={d} x={0} y={20 + (i * 2 + 1) * (S + G) + 10} fontSize={10} fill="currentColor" opacity={0.6}>
              {d}
            </text>
          ))}
          {cells.map((c) => {
            const rec = map.get(c.d);
            const count = valOf(rec);
            return (
              <motion.rect
                key={`${filter}-${c.d}`}
                x={30 + c.col * (S + G)}
                y={16 + c.row * (S + G)}
                width={S}
                height={S}
                rx={3.5}
                fill={levels[level(count)]}
                stroke={count > 0 ? "var(--edge)" : "rgba(128,128,128,0.18)"}
                strokeWidth={count > 0 ? 1.3 : 0.7}
                initial={{ opacity: 0, scale: 0.4 }}
                animate={eatenSet.has(c.d) && count > 0 ? { opacity: [1, 1, 0.35], scale: [1, 1.6, 0.55] } : { opacity: 1, scale: 1 }}
                whileHover={{ scale: 1.45 }}
                transition={eatenSet.has(c.d) ? { duration: 0.35 } : { delay: head < 0 ? c.col * 0.012 + c.row * 0.008 : 0, duration: 0.22 }}
                style={{ transformOrigin: `${30 + c.col * (S + G) + S / 2}px ${16 + c.row * (S + G) + S / 2}px`, cursor: "pointer" }}
                onMouseEnter={(e) => {
                  const box = (e.target as SVGRectElement).getBoundingClientRect();
                  setHover({ d: c.d, v: rec, x: box.left, y: box.top });
                }}
                onMouseLeave={() => setHover(null)}
              />
            );
          })}
          {snakeOn && head >= 0 && path.slice(Math.max(0, head - SNAKE_LEN + 1), Math.min(head + 1, path.length)).map((c, k, arr) => {
            const [x, y] = xy(c);
            const isHead = k === arr.length - 1;
            return (
              <g key={`snake-${c.d}`} pointerEvents="none">
                <rect x={x - 0.5} y={y - 0.5} width={S + 1} height={S + 1} rx={isHead ? 6 : 4}
                  fill={isHead ? "#ff4fa3" : `hsl(${330 - (arr.length - k) * 18} 95% 62%)`} stroke="#121212" strokeWidth={1.4}
                  opacity={0.35 + (k / arr.length) * 0.65} />
                {isHead && <>
                  <circle cx={x + S * 0.33} cy={y + S * 0.38} r={1.6} fill="#121212" />
                  <circle cx={x + S * 0.67} cy={y + S * 0.38} r={1.6} fill="#121212" />
                </>}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted">
        <SnakeToggle on={snakeOn} setOn={setSnakeOn} eaten={eaten} />
        <span className="flex items-center gap-1">
          Less
          {levels.map((c, i) => (
            <span key={i} className="inline-block size-3 rounded-[3px] border border-edge/40" style={{ background: c }} />
          ))}
          More
        </span>
      </div>

      {hover && (
        <div
          className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full rounded-xl border-2 border-edge bg-surface px-3 py-2 text-xs shadow-[3px_3px_0_var(--shadow-c)]"
          style={{ left: hover.x + 7, top: hover.y - 6 }}
        >
          <div className="font-bold">
            {valOf(hover.v)} {filter === "all" ? "actions" : RAMPS[filter].label.toLowerCase()} ·{" "}
            {new Date(`${hover.d}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
          </div>
          {hover.v && (
            <div className="text-muted">
              {(["scan", "draft", "audit", "verdict", "chat"] as const)
                .filter((k) => hover.v![k])
                .map((k) => `${hover.v![k]} ${k}`)
                .join(" · ")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- Interactive Decision Layer Architecture Infographic ----------
function DecisionInfographic({ totals, onOpen }: { totals: Record<string, number | null>; onOpen: (t: OpenTarget) => void }) {
  const stages = [
    {
      step: "01",
      tab: "explore" as const,
      title: "Gap Radar",
      question: "What should I research?",
      color: "bg-lime text-[#121212]",
      icon: Compass,
      stat: `${totals.papers_mapped ?? 0} papers mapped`,
      sub: `${totals.scans ?? 0} field scans · OpenAlex + arXiv`,
      pills: ["Semantic clustering", "Rising vs Saturated", "Grounded RQs"],
    },
    {
      step: "02",
      tab: "draft" as const,
      title: "Drafting engine",
      question: "Generate initial draft",
      color: "bg-blue text-white",
      icon: FilePen,
      stat: `${totals.drafts ?? 0} paper drafts`,
      sub: "Autonomous pipeline · 23 stages",
      pills: ["Agent pipeline", "Live Stage Stream", "PDF + LaTeX"],
    },
    {
      step: "03",
      tab: "audit" as const,
      title: "CiteGuard 5-Layer",
      question: "Can I trust this paper?",
      color: "bg-yellow text-[#121212]",
      icon: ShieldCheck,
      stat: `${totals.references_checked ?? 0} refs audited`,
      sub: `${totals.retractions_caught ?? 0} retractions · ${totals.phrases_caught ?? 0} tortured phrases`,
      pills: ["Crossref + S2", "Retraction Watch", "Claim Cosine"],
    },
    {
      step: "04",
      tab: "verdict" as const,
      title: "Reviewer Jury",
      question: "Ready to submit & where?",
      color: "bg-pink text-[#121212]",
      icon: Gavel,
      stat: `${totals.verdicts ?? 0} jury verdicts`,
      sub: totals.avg_integrity != null ? `Avg integrity ${totals.avg_integrity}/100` : "Hard integrity floor gates",
      pills: ["4 Personas", "Go / No-Go Rules", "OpenAlex Venues"],
    },
  ];

  return (
    <SpotlightCard className="p-6" glow="rgba(198, 242, 78, 0.22)">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="inline-flex items-center gap-1.5 rounded-full border-2 border-edge bg-surface-2 px-2.5 py-0.5 font-display text-[11px] font-extrabold uppercase tracking-widest">
            <Layers className="size-3.5 text-pink" /> Interactive Decision Architecture
          </div>
          <h2 className="mt-1 font-display text-xl font-extrabold md:text-2xl">
            Our agents write the draft, then Cite &amp; Slayy verifies every decision gate
          </h2>
        </div>
        <span className="text-xs font-bold text-muted">Click any stage to jump in →</span>
      </div>

      <div className="relative grid gap-4 lg:grid-cols-4">
        {/* Animated SVG Data Flow Beams on desktop */}
        <svg
          aria-hidden
          viewBox="0 0 1000 60"
          preserveAspectRatio="none"
          className="pointer-events-none absolute left-0 right-0 top-1/2 hidden h-10 w-full -translate-y-1/2 lg:block"
        >
          <line x1="120" y1="30" x2="880" y2="30" stroke="var(--edge)" strokeWidth="3" strokeOpacity="0.2" />
          <line x1="120" y1="30" x2="880" y2="30" stroke="var(--pink)" strokeWidth="4" className="beam-flow" />
        </svg>

        {stages.map((s, idx) => (
          <motion.button
            key={s.step}
            onClick={() => onOpen({ tab: s.tab })}
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 * idx, type: "spring", stiffness: 240, damping: 20 }}
            whileHover={{ y: -5, rotate: idx % 2 === 0 ? -0.6 : 0.6 }}
            whileTap={{ scale: 0.98 }}
            className="card relative z-10 flex flex-col justify-between bg-surface p-4 text-left transition-shadow hover:shadow-[7px_7px_0_var(--shadow-c)]"
          >
            <div>
              <div className="mb-2.5 flex items-center justify-between">
                <span className={clsx("inline-flex items-center gap-1.5 rounded-xl border-2 border-edge px-2.5 py-1 font-display text-xs font-extrabold", s.color)}>
                  <s.icon className="size-3.5" /> {s.step} · {s.title}
                </span>
                <ArrowRight className="size-4 text-muted" />
              </div>
              <div className="font-display text-sm font-extrabold text-ink">{s.question}</div>
              <div className="mt-2 rounded-xl border-2 border-edge bg-surface-2 px-3 py-2">
                <div className="font-display text-base font-extrabold">{s.stat}</div>
                <div className="text-[11px] text-ink-2">{s.sub}</div>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1">
              {s.pills.map((p) => (
                <span key={p} className="rounded-md border border-edge/40 bg-bg px-1.5 py-0.5 text-[10px] font-bold text-ink-2">
                  {p}
                </span>
              ))}
            </div>
          </motion.button>
        ))}
      </div>
    </SpotlightCard>
  );
}

// ---------- Animated ECharts Visualizations ----------
function VelocityChart({ weeks }: { weeks: NonNullable<Dash["weekly_velocity"]> }) {
  const { theme } = useTheme();
  const c = chrome(theme);
  return (
    <ReactECharts
      style={{ height: 265 }}
      option={{
        tooltip: { ...tooltipBase(c), trigger: "axis" },
        legend: { top: 0, itemWidth: 10, itemHeight: 10, textStyle: { color: c.ink2, fontSize: 11 } },
        grid: { left: 10, right: 16, top: 34, bottom: 8, containLabel: true },
        xAxis: {
          type: "category",
          data: weeks.map((w) => w.week),
          axisLine: { lineStyle: { color: c.axis } },
          axisLabel: { color: c.muted, fontSize: 10 },
        },
        yAxis: [
          { type: "value", name: "Weekly", nameTextStyle: { color: c.muted, fontSize: 10 }, splitLine: { lineStyle: { color: c.grid } }, axisLabel: { color: c.muted, fontSize: 10 } },
          { type: "value", name: "Total", nameTextStyle: { color: c.muted, fontSize: 10 }, splitLine: { show: false }, axisLabel: { color: c.muted, fontSize: 10 } },
        ],
        series: [
          { name: "Scans", type: "bar", stack: "wk", data: weeks.map((w) => w.scan), itemStyle: { color: "#c6f24e", borderColor: "#121212", borderWidth: 1.2 } },
          { name: "Drafts", type: "bar", stack: "wk", data: weeks.map((w) => w.draft), itemStyle: { color: "#4d6bfe", borderColor: "#121212", borderWidth: 1.2 } },
          { name: "Audits", type: "bar", stack: "wk", data: weeks.map((w) => w.audit), itemStyle: { color: "#ffd23f", borderColor: "#121212", borderWidth: 1.2 } },
          { name: "Verdicts", type: "bar", stack: "wk", data: weeks.map((w) => w.verdict), itemStyle: { color: "#ff4fa3", borderColor: "#121212", borderWidth: 1.2 } },
          { name: "Azora AI", type: "bar", stack: "wk", data: weeks.map((w) => w.chat), itemStyle: { color: "#9b6bff", borderColor: "#121212", borderWidth: 1.2, borderRadius: [5, 5, 0, 0] } },
          {
            name: "Cumulative",
            type: "line",
            yAxisIndex: 1,
            smooth: true,
            symbolSize: 7,
            data: weeks.map((w) => w.cumulative),
            lineStyle: { width: 3, color: "#eb6834" },
            itemStyle: { color: "#eb6834", borderColor: "#121212", borderWidth: 1.5 },
            animationDuration: 1400,
          },
        ],
      }}
    />
  );
}

function IntegrityRadar({ axes }: { axes: NonNullable<Dash["score_radar"]> }) {
  const { theme } = useTheme();
  const c = chrome(theme);
  return (
    <ReactECharts
      style={{ height: 255 }}
      option={{
        tooltip: { ...tooltipBase(c) },
        radar: {
          radius: "66%",
          indicator: axes.map((a) => ({ name: `${a.axis}\n(${a.pct}%)`, max: 100 })),
          axisName: { color: c.ink2, fontSize: 10.5, fontWeight: 700 },
          splitArea: { areaStyle: { color: ["transparent", c.grid] } },
          splitLine: { lineStyle: { color: c.grid } },
          axisLine: { lineStyle: { color: c.grid } },
        },
        series: [
          {
            type: "radar",
            data: [
              {
                value: axes.map((a) => a.pct),
                name: "Mean Audit Health (%)",
                areaStyle: { color: "rgba(255, 79, 163, 0.28)" },
                lineStyle: { color: "#ff4fa3", width: 2.8 },
                itemStyle: { color: "#ff4fa3", borderColor: "#121212", borderWidth: 1.5 },
              },
            ],
            animationDuration: 1200,
          },
        ],
      }}
    />
  );
}

function PersonaBars({ personas }: { personas: NonNullable<Dash["persona_radar"]> }) {
  const { theme } = useTheme();
  const c = chrome(theme);
  const sorted = [...personas].sort((a, b) => b.avg - a.avg);
  const palette = ["#c6f24e", "#5ce1b9", "#ffd23f", "#ff8a3d", "#9b6bff"];
  return (
    <ReactECharts
      style={{ height: 255 }}
      option={{
        tooltip: {
          ...tooltipBase(c),
          formatter: (p: { dataIndex: number }) => {
            const x = sorted[p.dataIndex];
            return `<b>${x.persona}</b><br/>Mean score: <b>${x.avg.toFixed(1)} / 10</b> (${x.n} review${x.n === 1 ? "" : "s"})`;
          },
        },
        grid: { left: 8, right: 44, top: 8, bottom: 10, containLabel: true },
        xAxis: { max: 10, splitLine: { lineStyle: { color: c.grid } }, axisLabel: { color: c.muted, fontSize: 10 } },
        yAxis: {
          type: "category",
          data: sorted.map((p) => (p.persona.length > 20 ? p.persona.slice(0, 19) + "…" : p.persona)),
          axisLabel: { color: c.ink2, fontSize: 11, fontWeight: 600 },
          axisLine: { lineStyle: { color: c.axis } },
        },
        series: [
          {
            type: "bar",
            barWidth: 20,
            data: sorted.map((p, i) => ({
              value: p.avg,
              itemStyle: { color: palette[i % palette.length], borderColor: "#121212", borderWidth: 2, borderRadius: [0, 8, 8, 0] },
            })),
            label: { show: true, position: "right", color: c.ink, fontWeight: 800, formatter: "{c}/10" },
            animationDuration: 1100,
            animationEasing: "backOut",
          },
        ],
      }}
    />
  );
}

// ---------- 100-Cell Citation Waffle Infographic ----------
function RefWaffle({ refs, totals }: { refs: Record<string, number>; totals: Record<string, number | null> }) {
  const entries = [
    { key: "verified", label: "Verified", count: refs.verified ?? 0, color: "#18a957" },
    { key: "metadata_mismatch", label: "Mismatch", count: refs.metadata_mismatch ?? 0, color: "#ffc21a" },
    { key: "not_found", label: "Not found", count: refs.not_found ?? 0, color: "#ef3b3b" },
    { key: "could_not_verify", label: "Unverified", count: refs.could_not_verify ?? 0, color: "#898781" },
  ];
  const sum = entries.reduce((s, e) => s + e.count, 0);
  if (!sum) return <Empty title="No citations audited yet">Run CiteGuard on a paper to populate the 100-cell citation matrix.</Empty>;

  const cells: { color: string; label: string }[] = [];
  let acc = 0;
  entries.forEach((e, idx) => {
    const n = idx === entries.length - 1 ? Math.max(0, 100 - acc) : Math.round((e.count / sum) * 100);
    acc += n;
    for (let k = 0; k < n && cells.length < 100; k++) cells.push({ color: e.color, label: e.label });
  });
  while (cells.length < 100) cells.push({ color: "#18a957", label: "Verified" });

  const verifiedPct = Math.round(((refs.verified ?? 0) / sum) * 100);

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <div>
          <span className="font-display text-3xl font-extrabold">{verifiedPct}%</span>
          <span className="ml-1.5 text-xs font-bold text-muted">verified across {sum} references</span>
        </div>
        <Badge tone={(refs.not_found ?? 0) > 0 ? "crit" : "good"}>
          {refs.not_found ?? 0} fabricated / missing
        </Badge>
      </div>

      {/* 10x10 Pictogram Matrix */}
      <div className="grid grid-cols-10 gap-1.5 rounded-2xl border-2 border-edge bg-surface-2 p-3">
        {cells.map((cell, idx) => (
          <motion.span
            key={idx}
            title={`Cell ${idx + 1}/100: ${cell.label}`}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: idx * 0.006, type: "spring", stiffness: 260, damping: 20 }}
            className="aspect-square rounded-[4px] border border-[#121212]/70"
            style={{ background: cell.color }}
          />
        ))}
      </div>

      <div className="grid grid-cols-2 gap-1.5 text-xs">
        {entries.map((e) => (
          <div key={e.key} className="flex items-center justify-between rounded-lg border border-line bg-bg/60 px-2.5 py-1">
            <span className="flex items-center gap-1.5 font-semibold">
              <span className="inline-block size-2.5 rounded-sm border border-[#121212]" style={{ background: e.color }} />
              {e.label}
            </span>
            <span className="tabular font-display font-extrabold">{e.count}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5 pt-0.5 text-[11px] font-bold">
        <span className="rounded-full border-2 border-edge bg-crit-soft px-2.5 py-0.5 text-crit-ink">
          {totals.retractions_caught ?? 0} retractions caught
        </span>
        <span className="rounded-full border-2 border-edge bg-serious-soft px-2.5 py-0.5 text-serious-ink">
          {totals.phrases_caught ?? 0} tortured phrases
        </span>
        <span className="rounded-full border-2 border-edge bg-surface-2 px-2.5 py-0.5 text-ink-2">
          {totals.overlaps_flagged ?? 0} possible overlaps
        </span>
      </div>
    </div>
  );
}

function RefDonut({ refs }: { refs: Record<string, number> }) {
  const { theme } = useTheme();
  const c = chrome(theme);
  const data = [
    { name: "Verified", value: refs.verified ?? 0, itemStyle: { color: "#18a957" } },
    { name: "Metadata mismatch", value: refs.metadata_mismatch ?? 0, itemStyle: { color: "#ffc21a" } },
    { name: "Not found", value: refs.not_found ?? 0, itemStyle: { color: "#ef3b3b" } },
    { name: "Could not verify", value: refs.could_not_verify ?? 0, itemStyle: { color: "#898781" } },
  ];
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <ReactECharts
      style={{ height: 250 }}
      option={{
        tooltip: { ...tooltipBase(c), trigger: "item", formatter: "{b}: <b>{c}</b> ({d}%)" },
        legend: { bottom: 0, itemWidth: 10, itemHeight: 10, textStyle: { color: c.ink2, fontSize: 11 } },
        title: {
          text: String(total),
          subtext: "references",
          left: "center",
          top: "33%",
          textStyle: { fontFamily: "var(--font-display)", fontSize: 30, fontWeight: 800, color: c.ink },
          subtextStyle: { color: c.muted },
        },
        series: [
          {
            type: "pie",
            radius: ["52%", "76%"],
            center: ["50%", "44%"],
            padAngle: 2,
            itemStyle: { borderColor: c.axis, borderWidth: 2, borderRadius: 6 },
            label: { show: false },
            data,
            animationType: "scale",
            animationEasing: "elasticOut",
            animationDuration: 1400,
          },
        ],
      }}
    />
  );
}

function IntegrityBars({ papers, onOpen }: { papers: Dash["papers"]; onOpen: (p: Dash["papers"][number]) => void }) {
  const { theme } = useTheme();
  const c = chrome(theme);
  const color = (p: Dash["papers"][number]) =>
    p.self_retracted || p.score < 50 ? "#ef3b3b" : p.retracted_cited || p.score < 80 ? "#ffc21a" : "#18a957";
  return (
    <ReactECharts
      style={{ height: Math.max(190, papers.length * 50 + 40) }}
      onEvents={{ click: (e: { dataIndex: number }) => onOpen(papers[e.dataIndex]) }}
      option={{
        grid: { left: 8, right: 46, top: 6, bottom: 6, containLabel: true },
        tooltip: {
          ...tooltipBase(c),
          formatter: (p: { dataIndex: number }) => {
            const x = papers[p.dataIndex];
            return `<b>${x.title.slice(0, 60)}</b><br/>${x.score.toFixed(0)}/100 · ${x.references} refs${x.retracted_cited ? ` · ${x.retracted_cited} retracted` : ""}${x.self_retracted ? " · paper retracted" : ""}`;
          },
        },
        xAxis: { max: 100, splitLine: { lineStyle: { color: c.grid } }, axisLabel: { color: c.muted } },
        yAxis: {
          type: "category",
          data: papers.map((p) => (p.title.length > 34 ? p.title.slice(0, 33) + "…" : p.title)),
          axisLabel: { color: c.ink2, fontSize: 11 },
          axisLine: { lineStyle: { color: c.axis } },
        },
        series: [
          {
            type: "bar",
            barWidth: 22,
            data: papers.map((p) => ({
              value: Math.round(p.score),
              itemStyle: { color: color(p), borderColor: "#121212", borderWidth: 2, borderRadius: [0, 8, 8, 0] },
            })),
            label: { show: true, position: "right", color: c.ink, fontWeight: 800, formatter: "{c}" },
            animationDuration: 1300,
            animationEasing: "cubicOut",
            cursor: "pointer",
          },
        ],
      }}
    />
  );
}

function ClusterBars({ gap }: { gap: NonNullable<Dash["gap"]> }) {
  const { theme } = useTheme();
  const c = chrome(theme);
  const colors = CLASS_COLORS[theme];
  const cl = [...gap.clusters].sort((a, b) => b.size - a.size);
  return (
    <ReactECharts
      style={{ height: 230 }}
      option={{
        grid: { left: 8, right: 10, top: 10, bottom: 40, containLabel: true },
        tooltip: {
          ...tooltipBase(c),
          formatter: (p: { dataIndex: number }) => {
            const x = cl[p.dataIndex];
            return `<b>${x.label}</b><br/>${CLASS_LABEL[x.classification]} · ${x.size} papers · growth ${(x.growth * 100).toFixed(0)}%`;
          },
        },
        xAxis: {
          type: "category",
          data: cl.map((x) => (x.label.length > 14 ? x.label.slice(0, 13) + "…" : x.label)),
          axisLabel: { color: c.ink2, fontSize: 10, rotate: 28 },
          axisLine: { lineStyle: { color: c.axis } },
        },
        yAxis: { splitLine: { lineStyle: { color: c.grid } }, axisLabel: { color: c.muted } },
        series: [
          {
            type: "bar",
            barWidth: "58%",
            data: cl.map((x) => ({
              value: x.size,
              itemStyle:
                x.classification === "unclassified"
                  ? { color: "transparent", borderColor: colors.unclassified, borderWidth: 2, borderType: "dashed", borderRadius: [8, 8, 0, 0] }
                  : { color: colors[x.classification], borderColor: "#121212", borderWidth: 2, borderRadius: [8, 8, 0, 0] },
            })),
            animationDelay: (i: number) => i * 80,
            animationDuration: 900,
            animationEasing: "backOut",
          },
        ],
      }}
    />
  );
}

function WorkspacePulse({
  ws, onOpen, onAurora,
}: {
  ws: NonNullable<Dash["workspace"]>; onOpen: (t: OpenTarget) => void; onAurora: () => void;
}) {
  const pct = ws.todos_total > 0 ? ws.todos_done / ws.todos_total : 0;
  const R = 36, C = 2 * Math.PI * R;
  return (
    <Card className="flex flex-col justify-between p-5">
      <div>
        <div className="mb-3 flex items-center justify-between">
          <span className="font-display text-sm font-extrabold uppercase tracking-widest text-muted">Workspace &amp; Agent Lab</span>
          <Bot className="size-4 text-violet" />
        </div>
        <div className="flex items-center gap-4 rounded-2xl border-2 border-edge bg-surface-2 p-3">
          <div className="relative grid size-20 shrink-0 place-items-center">
            <svg viewBox="0 0 88 88" className="size-20 -rotate-90">
              <circle cx="44" cy="44" r={R} fill="none" stroke="var(--surface-3)" strokeWidth="9" />
              <motion.circle
                cx="44"
                cy="44"
                r={R}
                fill="none"
                stroke="var(--good)"
                strokeWidth="9"
                strokeLinecap="round"
                strokeDasharray={C}
                initial={{ strokeDashoffset: C }}
                animate={{ strokeDashoffset: C * (1 - pct) }}
                transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
              />
            </svg>
            <span className="absolute font-display text-lg font-extrabold">{Math.round(pct * 100)}%</span>
          </div>
          <div className="min-w-0">
            <div className="font-display text-base font-extrabold">
              {ws.todos_done}/{ws.todos_total} research tasks done
            </div>
            <div className="mt-0.5 text-xs text-ink-2">
              <b>{ws.tool_runs}</b> real tool executions by Azora AI
            </div>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          <button
            onClick={() => onOpen({ tab: "notes", notesView: "pages" })}
            className="btn-brut rounded-xl bg-yellow p-2.5 text-left text-[#121212]"
          >
            <NotebookPen className="size-4" />
            <div className="mt-1 font-display text-xl font-extrabold">{ws.pages}</div>
            <div className="text-[10.5px] font-bold opacity-80">Pages</div>
          </button>
          <button
            onClick={() => onOpen({ tab: "notes", notesView: "stickies" })}
            className="btn-brut rounded-xl bg-pink p-2.5 text-left text-[#121212]"
          >
            <Pin className="size-4" />
            <div className="mt-1 font-display text-xl font-extrabold">{ws.stickies}</div>
            <div className="text-[10.5px] font-bold opacity-80">Stickies</div>
          </button>
          <button
            onClick={() => onOpen({ tab: "notes", notesView: "todos" })}
            className="btn-brut rounded-xl bg-lime p-2.5 text-left text-[#121212]"
          >
            <ListTodo className="size-4" />
            <div className="mt-1 font-display text-xl font-extrabold">{ws.todos_total}</div>
            <div className="text-[10.5px] font-bold opacity-80">To-dos</div>
          </button>
        </div>

        {ws.top_tools.length > 0 && (
          <div className="mt-3">
            <div className="mb-1 text-[10.5px] font-bold uppercase tracking-wider text-muted">Top Azora Lab Tools Used</div>
            <div className="flex flex-wrap gap-1">
              {ws.top_tools.map((t) => (
                <span key={t.name} className="rounded-full border border-edge bg-surface px-2 py-0.5 font-mono text-[10.5px] font-semibold">
                  {t.name} · {t.count}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      <button
        onClick={onAurora}
        className="btn-brut mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-violet px-3 py-2 font-display text-xs font-extrabold text-white"
      >
        <AuroraOrb size={18} /> Launch Azora Lab Experiment
      </button>
    </Card>
  );
}

// ---------- Page ----------
export function HomeTab({ onOpen, onSlay, onAurora }: { onOpen: (t: OpenTarget) => void; onSlay: () => void; onAurora: () => void }) {
  const { me } = useAuth();
  const [savedName, setName] = usePersistent<string>("displayName", "");
  const name = savedName || me?.name?.split(" ")[0] || "researcher";
  const [editing, setEditing] = useState(false);
  const [d, setD] = useState<Dash | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [now] = useState(() => new Date());

  const refresh = useCallback(() => {
    setRefreshing(true);
    api.get<Dash>("/api/dashboard")
      .then(setD)
      .catch(() => {})
      .finally(() => setRefreshing(false));
  }, []);

  useEffect(() => {
    api.get<Dash>("/api/dashboard").then(setD).catch(() => {});
  }, []);

  const t = d?.totals ?? {};
  const kpis: [string, number | null | undefined, string, number?][] = [
    ["Papers mapped", t.papers_mapped as number, "bg-lime"],
    ["References checked", t.references_checked as number, "bg-surface"],
    ["Retractions caught", t.retractions_caught as number, "bg-crit text-white"],
    ["Avg integrity", t.avg_integrity as number, "bg-yellow", 1],
    ["Papers audited", t.papers_audited as number, "bg-blue text-white"],
    ["Jury verdicts", t.verdicts as number, "bg-pink"],
    ["Field scans", t.scans as number, "bg-mint"],
    ["Azora tool runs", (t.tool_runs ?? t.chats) as number, "bg-violet text-white"],
  ];

  const funnel: [string, number | null | undefined, typeof Compass, string][] = [
    ["Papers mapped", t.papers_mapped as number, Compass, "bg-lime"],
    ["Drafts", t.drafts as number, FilePen, "bg-blue text-white"],
    ["Audited", t.papers_audited as number, ShieldCheck, "bg-yellow"],
    ["Verdicts", t.verdicts as number, Gavel, "bg-pink"],
  ];

  return (
    <div className="space-y-6">
      {/* Mesh-Gradient Spotlight Hero */}
      <SpotlightCard className="mesh-hero bg-surface p-6 md:p-8" glow="rgba(255, 79, 163, 0.22)">
        <div className="relative flex flex-wrap items-center justify-between gap-6">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-display text-xs font-extrabold uppercase tracking-widest text-muted">
                {now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
              </span>
              {d?.streaks && d.streaks.current > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full border-2 border-[#121212] bg-orange px-2.5 py-0.5 font-display text-[11px] font-extrabold text-[#121212]">
                  <Flame className="size-3.5" /> {d.streaks.current}d research streak
                </span>
              )}
              <button
                onClick={refresh}
                title="Refresh telemetry"
                className="inline-flex items-center gap-1 rounded-full border border-edge/40 bg-surface/80 px-2 py-0.5 text-[11px] font-semibold text-ink-2 hover:border-edge"
              >
                <RefreshCw className={clsx("size-3", refreshing && "animate-spin")} /> Live
              </button>
            </div>

            <h1 className="mt-1.5 font-display text-4xl font-extrabold leading-tight md:text-5xl">
              {greeting(now.getHours())},{" "}
              {editing ? (
                <input
                  autoFocus
                  defaultValue={name}
                  onBlur={(e) => { setName(e.target.value.trim() || "there"); setEditing(false); }}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                  className="w-48 rounded-xl border-[2.5px] border-edge bg-yellow px-2 text-[#121212] outline-none"
                />
              ) : (
                <button
                  onClick={() => setEditing(true)}
                  title="Change name"
                  className="group inline-flex items-center gap-1 rounded-xl border-2 border-[#121212] bg-yellow px-2.5 text-[#121212] shadow-[3px_3px_0_#121212] -rotate-1"
                >
                  {name}
                  <Pencil className="size-4 opacity-0 transition group-hover:opacity-65" />
                </button>
              )}{" "}
              <motion.span
                className="inline-block origin-[70%_70%]"
                animate={{ rotate: [0, 18, -8, 18, 0] }}
                transition={{ duration: 1.6, delay: 0.4, repeat: 2, repeatDelay: 2 }}
              >
                👋
              </motion.span>
            </h1>

            <p className="mt-2.5 max-w-xl text-ink-2">
              {d ? (
                <>
                  Your research decision layer has verified <b className="text-ink">{t.references_checked}</b> references, caught{" "}
                  <b className="text-crit-ink">{t.retractions_caught}</b> retraction{t.retractions_caught === 1 ? "" : "s"}, and mapped{" "}
                  <b className="text-ink">{t.papers_mapped}</b> real papers. Ready for the next experiment?
                </>
              ) : (
                "Loading your live research telemetry…"
              )}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button onClick={onSlay} className="btn-brut flex items-center gap-2 rounded-2xl bg-pink px-4 py-3 font-display font-extrabold text-[#121212]">
              <Zap className="size-5" /> Slay it
            </button>
            <button onClick={onAurora} className="btn-brut flex items-center gap-2 rounded-2xl bg-surface px-4 py-3 font-display font-extrabold">
              <AuroraOrb size={24} ring /> Azora AI Lab
            </button>
            <button onClick={() => onOpen({ tab: "explore" })} className="btn-brut flex items-center gap-2 rounded-2xl bg-lime px-4 py-3 font-display font-extrabold text-[#121212]">
              <Radar className="size-5" /> Scan a field
            </button>
            <button onClick={() => onOpen({ tab: "audit" })} className="btn-brut flex items-center gap-2 rounded-2xl bg-yellow px-4 py-3 font-display font-extrabold text-[#121212]">
              <ShieldCheck className="size-5" /> Audit a paper
            </button>
          </div>
        </div>
      </SpotlightCard>

      {/* Interactive 4-Gate Decision Architecture Infographic */}
      <DecisionInfographic totals={t} onOpen={onOpen} />

      <ThoughtOfTheDay onOpen={(tab) => onOpen({ tab })} />

      {/* KPI Tiles */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {kpis.map(([label, v, color, dec], i) => (
          <motion.div
            key={label}
            initial={{ opacity: 0, y: 24, rotate: i % 2 ? 1.6 : -1.6 }}
            animate={{ opacity: 1, y: 0, rotate: 0 }}
            transition={{ type: "spring", stiffness: 240, damping: 18, delay: i * 0.04 }}
            className={clsx(
              "card card-pop px-5 py-4",
              color,
              !color.includes("surface") && !color.includes("text-white") && "text-[#121212]",
            )}
          >
            <div className="font-display text-[11px] font-extrabold uppercase tracking-wider opacity-75">{label}</div>
            <div className="mt-1 font-display text-4xl font-extrabold tracking-tight">
              {typeof v === "number" ? <AnimatedNumber value={v} decimals={dec ?? 0} /> : "—"}
            </div>
          </motion.div>
        ))}
      </div>

      {/* GitHub Contribution Heatmap + Pipeline Funnel */}
      <div className="grid gap-6 xl:grid-cols-[1.68fr_1fr]">
        <Card className="p-6">
          {d ? <Heatmap activity={d.activity} streaks={d.streaks} /> : <div className="shimmer h-48 rounded-xl" />}
        </Card>

        <Card className="flex flex-col justify-between p-6">
          <div>
            <div className="mb-4 font-display text-sm font-extrabold uppercase tracking-widest text-muted">
              Conversion Funnel · Explore → Verdict
            </div>
            <div className="space-y-3">
              {funnel.map(([label, v, Icon, color], i) => {
                const top = Math.max(1, (funnel[0][1] as number) || 1);
                const w = typeof v === "number" ? Math.max(46, Math.min(100, (Math.log10(v + 1) / Math.log10(top + 1)) * 100)) : 46;
                return (
                  <div key={label} className="flex items-center gap-3">
                    <span className={clsx("grid size-9 shrink-0 place-items-center rounded-xl border-2 border-edge", color, !color.includes("text-white") && "text-[#121212]")}>
                      <Icon className="size-4" />
                    </span>
                    <div className="flex-1">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${w}%` }}
                        transition={{ type: "spring", stiffness: 80, damping: 16, delay: 0.18 + i * 0.1 }}
                        className={clsx(
                          "flex h-9 items-center justify-between rounded-xl border-2 border-edge px-3 font-display text-sm font-extrabold",
                          color,
                          !color.includes("text-white") && "text-[#121212]",
                        )}
                      >
                        <span className="truncate">{label}</span>
                        <span>{typeof v === "number" ? <AnimatedNumber value={v} /> : "—"}</span>
                      </motion.div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <p className="pt-3 text-[11px] text-muted">
            Log-scaled bars preserve visibility from 1,000+ mapped field papers down to curated jury verdicts.
          </p>
        </Card>
      </div>

      {/* 12-Week Velocity Timeline + CiteGuard 5-Pillar Radar + Jury Persona Profile */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-5">
          <div className="mb-1 font-display text-sm font-extrabold uppercase tracking-widest text-muted">
            12-Week Research Velocity
          </div>
          <p className="mb-1 text-xs text-ink-2">Weekly stacked actions + cumulative momentum curve.</p>
          {d?.weekly_velocity?.some((w) => w.total > 0) ? (
            <VelocityChart weeks={d.weekly_velocity} />
          ) : (
            <Empty title="No weekly trend yet">Run a scan, audit or Azora experiment to start your curve.</Empty>
          )}
        </Card>

        <Card className="p-5">
          <div className="mb-1 font-display text-sm font-extrabold uppercase tracking-widest text-muted">
            CiteGuard 5-Pillar Radar
          </div>
          <p className="mb-1 text-xs text-ink-2">Mean health % across audited papers per integrity dimension.</p>
          {d?.score_radar && d.score_radar.length >= 3 ? (
            <IntegrityRadar axes={d.score_radar} />
          ) : (
            <Empty title="No audit profile yet">Audit a paper to map its 5-pillar radar.</Empty>
          )}
        </Card>

        <Card className="p-5">
          <div className="mb-1 font-display text-sm font-extrabold uppercase tracking-widest text-muted">
            Reviewer Jury Persona Profile
          </div>
          <p className="mb-1 text-xs text-ink-2">Mean score (/10) by reviewer persona across verdicts.</p>
          {d?.persona_radar && d.persona_radar.length > 0 ? (
            <PersonaBars personas={d.persona_radar} />
          ) : (
            <Empty title="No jury reviews yet">Convene the jury in Step 4 to compare reviewer personas.</Empty>
          )}
        </Card>
      </div>

      {/* 100-Cell Citation Waffle Infographic + Donut + Per-Paper Integrity Bars */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-5">
          <div className="mb-2 font-display text-sm font-extrabold uppercase tracking-widest text-muted">
            100-Cell Citation Integrity Matrix
          </div>
          {d ? <RefWaffle refs={d.ref_status} totals={t} /> : <div className="shimmer h-64 rounded-xl" />}
        </Card>

        <Card className="p-5">
          <div className="font-display text-sm font-extrabold uppercase tracking-widest text-muted">
            References by Verification Status
          </div>
          {d && Object.values(d.ref_status).some(Boolean) ? (
            <RefDonut refs={d.ref_status} />
          ) : (
            <Empty title="No audits yet">Audit a paper to see this.</Empty>
          )}
        </Card>

        <Card className="p-5">
          <div className="mb-2 font-display text-sm font-extrabold uppercase tracking-widest text-muted">
            Integrity by Paper · Click to Inspect
          </div>
          {d?.papers.length ? (
            <IntegrityBars papers={d.papers} onOpen={(p) => onOpen({ tab: "audit", doc: p.document_id, audit: p.audit_id })} />
          ) : (
            <Empty title="No audits yet" />
          )}
        </Card>
      </div>

      {/* Verdict Mix + Latest Gap Scan + Workspace Pulse */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-5">
          <div className="mb-4 font-display text-sm font-extrabold uppercase tracking-widest text-muted">Go / No-Go Verdict Mix</div>
          <div className="space-y-3">
            {(
              [
                ["submit", "Submit", CheckCircle2, "bg-lime"],
                ["revise", "Revise", RotateCcw, "bg-yellow"],
                ["dont_submit", "Don't submit", OctagonX, "bg-crit text-white"],
              ] as const
            ).map(([k, label, Icon, color], i) => (
              <motion.div
                key={k}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2 + i * 0.1 }}
                className={clsx(
                  "flex items-center justify-between rounded-2xl border-[2.5px] border-edge px-4 py-3 shadow-[3px_3px_0_var(--shadow-c)]",
                  color,
                  !color.includes("text-white") && "text-[#121212]",
                )}
              >
                <span className="flex items-center gap-2 font-display font-extrabold">
                  <Icon className="size-5" />
                  {label}
                </span>
                <span className="font-display text-3xl font-extrabold">
                  <AnimatedNumber value={d?.decisions[k] ?? 0} />
                </span>
              </motion.div>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <div className="font-display text-sm font-extrabold uppercase tracking-widest text-muted">
              Latest Gap Scan{d?.gap ? ` · “${d.gap.query}”` : ""}
            </div>
            {d?.gap && (
              <button
                onClick={() => onOpen({ tab: "explore", gap: d.gap!.run_id })}
                className="inline-flex items-center gap-1 text-xs font-bold text-accent-ink"
              >
                Open <ArrowRight className="size-3" />
              </button>
            )}
          </div>
          {d?.gap ? (
            <>
              <div className="mb-1 flex flex-wrap gap-1.5 pt-2">
                {(["underexplored", "rising", "saturated", "unclassified"] as GapClass[]).map((k) => (
                  <span key={k} className="inline-flex items-center gap-1.5 rounded-full border-2 border-edge bg-surface px-2 py-0.5 text-[11px] font-bold">
                    <span
                      className="inline-block size-2.5 rounded-full"
                      style={k === "unclassified" ? { border: `2px dashed ${CLASS_COLORS.light[k]}` } : { background: CLASS_COLORS.light[k] }}
                    />
                    {CLASS_LABEL[k]} · {d.gap!.classes[k] ?? 0}
                  </span>
                ))}
              </div>
              <ClusterBars gap={d.gap} />
            </>
          ) : (
            <Empty title="No scans yet">Scan a field in Explore.</Empty>
          )}
        </Card>

        {d?.workspace ? (
          <WorkspacePulse ws={d.workspace} onOpen={onOpen} onAurora={onAurora} />
        ) : (
          <Card className="p-5"><div className="shimmer h-64 rounded-xl" /></Card>
        )}
      </div>

      {/* Live Activity Feed */}
      <Card className="p-5">
        <div className="mb-3 flex items-center gap-2 font-display text-sm font-extrabold uppercase tracking-widest text-muted">
          <Sparkles className="size-4 text-pink" /> Recent Lab Telemetry &amp; Decisions
        </div>
        {d?.feed.length ? (
          <ul className="divide-y-2 divide-dashed divide-line">
            {d.feed.map((f, i) => {
              const meta =
                {
                  scan: [Radar, "bg-lime"],
                  audit: [ShieldCheck, "bg-yellow"],
                  verdict: [Gavel, "bg-pink"],
                  draft: [FilePen, "bg-blue text-white"],
                  chat: [Bot, "bg-violet text-white"],
                }[f.kind as "scan"] ?? [Activity, "bg-surface-2"];
              const Icon = meta[0] as typeof Radar;
              return (
                <motion.li key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
                  <button
                    onClick={() => {
                      if (f.kind === "chat") {
                        if (f.ids.chat) onOpen({ tab: "home", chat: f.ids.chat });
                        onAurora();
                        return;
                      }
                      const tab = (f.kind === "scan" ? "explore" : f.kind === "draft" ? "draft" : f.kind) as OpenTarget["tab"];
                      onOpen({ tab, ...f.ids } as OpenTarget);
                    }}
                    className="flex w-full items-center gap-3 py-2.5 text-left transition hover:translate-x-1"
                  >
                    <span
                      className={clsx(
                        "grid size-8 shrink-0 place-items-center rounded-xl border-2 border-edge",
                        meta[1] as string,
                        !(meta[1] as string).includes("text-white") && "text-[#121212]",
                      )}
                    >
                      <Icon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{f.title}</span>
                    <span className="shrink-0 text-xs text-muted">{ago(f.at)}</span>
                  </button>
                </motion.li>
              );
            })}
          </ul>
        ) : (
          <Empty title="Nothing yet">Your scans, audits, verdicts and Azora sessions will show up here.</Empty>
        )}
      </Card>
    </div>
  );
}
