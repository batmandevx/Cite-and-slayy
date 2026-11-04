"use client";

import { EmptyState } from "@/components/ui/States";
import clsx from "clsx";
import { ExternalLink, Search, SearchX, Wrench } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import { RESOURCES } from "@/lib/resources";

const TAG_EMOJI: Record<string, string> = {
  All: "✨", Search: "🔎", Discover: "🧭", Manage: "🗂️", Write: "✍️", Bibliometrics: "📈", Data: "🧹", Networks: "🕸️", Stats: "📊",
  ML: "🤖", GIS: "🗺️", Figures: "🎨", Qualitative: "💬", Forensics: "🕵️", Integrity: "🛡️", "Open access": "🔓", Books: "📚", Analyse: "🔬",
};

export function ToolboxTab() {
  const [q, setQ] = useState("");
  const [tag, setTag] = useState("All");
  const tags = useMemo(() => ["All", ...Array.from(new Set(RESOURCES.map((r) => r.tag)))], []);
  const shown = RESOURCES.filter((r) => (tag === "All" || r.tag === tag)
    && (!q || `${r.name} ${r.what} ${r.tag}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="space-y-6">
      <div className="card card-pop relative overflow-hidden p-6 md:p-8">
        <motion.div className="pointer-events-none absolute -right-10 -top-10 text-[160px] opacity-10" animate={{ rotate: [0, 15, -10, 0] }} transition={{ repeat: Infinity, duration: 8 }}>🧰</motion.div>
        <div className="relative">
          <span className="sticker bg-lime text-[#121212]"><Wrench className="size-4" />{RESOURCES.length} trusted tools</span>
          <h2 className="mt-3 font-display text-4xl font-extrabold">Research toolbox</h2>
          <p className="mt-1 max-w-2xl text-ink-2">The free and professional tools researchers actually use: references, statistics, networks, bibliometrics, figures, qualitative coding and more. Every link goes to the official site.</p>
          <div className="mt-5 flex items-center gap-2 rounded-2xl border-[2.5px] border-edge bg-surface px-3 shadow-[4px_4px_0_var(--shadow-c)]">
            <Search className="size-5 text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tools, e.g. “statistics”, “BibTeX”, “network”"
              className="w-full bg-transparent py-3 text-sm outline-none" />
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {tags.map((t) => (
          <motion.button key={t} whileHover={{ y: -2 }} whileTap={{ scale: 0.94 }} onClick={() => setTag(t)}
            className={clsx("relative rounded-full border-2 border-edge px-3 py-1 text-xs font-extrabold", tag === t ? "text-bg" : "bg-surface")}>
            {tag === t && <motion.span layoutId="toolbox-tag" className="absolute inset-0 -z-0 rounded-full bg-ink" transition={{ type: "spring", stiffness: 400, damping: 30 }} />}
            <span className="relative">{TAG_EMOJI[t] ?? "•"} {t}</span>
          </motion.button>
        ))}
      </div>
      <motion.div layout className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <AnimatePresence mode="popLayout">
          {shown.map((r, i) => (
            <motion.a layout key={r.name} href={r.url} target="_blank" rel="noreferrer"
              initial={{ opacity: 0, scale: 0.85, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.85 }}
              transition={{ delay: Math.min(i, 12) * 0.02, type: "spring", stiffness: 260, damping: 22 }}
              whileHover={{ y: -6, rotate: i % 2 ? 0.8 : -0.8 }} className="card group flex flex-col p-4">
              <div className="flex items-center gap-3">
                <motion.div whileHover={{ rotate: [0, -12, 12, 0] }} className={clsx("grid size-11 shrink-0 place-items-center rounded-xl border-2 border-edge font-display text-lg font-extrabold text-[#121212]", r.color)}>{r.name[0]}</motion.div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1 font-display font-extrabold leading-tight">{r.name}<ExternalLink className="size-3 opacity-0 transition group-hover:opacity-60" /></div>
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted">{TAG_EMOJI[r.tag] ?? ""} {r.tag}</span>
                </div>
              </div>
              <p className="mt-2 text-xs text-ink-2">{r.what}</p>
            </motion.a>
          ))}
        </AnimatePresence>
      </motion.div>
      {shown.length === 0 && <EmptyState icon={<SearchX />} title={`No tool matches “${q}”`}>Try a shorter word, such as &ldquo;cite&rdquo;, &ldquo;PDF&rdquo; or &ldquo;stats&rdquo;.</EmptyState>}
      <p className="text-xs text-muted">
        Not listed on purpose: shadow libraries (they distribute copyrighted papers without permission) and “AI humanizer” tools
        (built to hide AI-generated text from detectors, which conflicts with research-integrity policies).
      </p>
    </div>
  );
}
