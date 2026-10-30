"use client";

import { BookOpen, ChevronLeft, ChevronRight, Gamepad2, NotebookPen, Quote, Wand2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";

// Original research tips written for Cite & Slayy. Deliberately unattributed: we don't put words in famous people's mouths.
const THOUGHTS: { text: string; tag: string }[] = [
  { text: "A citation is a promise to your reader. Open the paper before you make that promise.", tag: "Integrity" },
  { text: "Write the limitations section first. It tells you which experiments you still owe.", tag: "Writing" },
  { text: "Three seeds and an error bar beat one lucky run and a bold headline.", tag: "Experiments" },
  { text: "If you can't explain your contribution in two sentences, the reviewers can't either.", tag: "Writing" },
  { text: "A crowded field isn't a closed door. Look for the question everyone is stepping around.", tag: "Ideas" },
  { text: "Retracted papers keep collecting citations for years. Don't be one of them.", tag: "Integrity" },
  { text: "Baselines deserve the same tuning budget as your method. Reviewers notice when they don't get it.", tag: "Experiments" },
  { text: "Save the raw numbers, the config and the commit hash. Future you will need all three.", tag: "Reproducibility" },
  { text: "Read the abstract, the figures, then the conclusion. Read the rest only if it earned it.", tag: "Reading" },
  { text: "A negative result written up honestly saves the next person six months.", tag: "Ideas" },
  { text: "Your related-work section is a map. Show where your paper sits on it.", tag: "Writing" },
  { text: "Paraphrasing tools make sentences worse and reviewers more suspicious. Write it yourself.", tag: "Integrity" },
  { text: "Ablations answer the question every reviewer will ask: which part actually mattered?", tag: "Experiments" },
  { text: "Small, finished, honest beats big, vague and late.", tag: "Mindset" },
  { text: "Keep a lab notebook, even a messy one. Memory is not a data source.", tag: "Reproducibility" },
  { text: "Pick the venue before you write. Its readers decide how you tell the story.", tag: "Writing" },
  { text: "Every claim needs a source, a number, or the word “we hypothesise”.", tag: "Integrity" },
  { text: "Rest is part of research. Ideas show up when you stop staring at them.", tag: "Mindset" },
];

const TAG_COLOR: Record<string, string> = {
  Integrity: "bg-crit text-white", Writing: "bg-blue text-white", Experiments: "bg-lime text-[#121212]", Ideas: "bg-yellow text-[#121212]",
  Reproducibility: "bg-violet text-white", Reading: "bg-mint text-[#121212]", Mindset: "bg-orange text-[#121212]",
};

function dayIndex() {
  const d = new Date();
  return Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 0)) / 864e5);
}

export function ThoughtOfTheDay({ onOpen }: { onOpen: (tab: "studio" | "notes" | "library" | "play") => void }) {
  const [i, setI] = useState(() => dayIndex() % THOUGHTS.length);
  const [paused, setPaused] = useState(false);
  const step = (d: number) => setI((n) => (n + d + THOUGHTS.length) % THOUGHTS.length);
  const t = THOUGHTS[i];
  const words = t.text.split(" ");
  const links = [
    { tab: "studio", label: "Paper Studio", sub: "topic in, full paper out", icon: Wand2, color: "bg-pink" },
    { tab: "notes", label: "Notes", sub: "pages · stickies · to-dos", icon: NotebookPen, color: "bg-yellow" },
    { tab: "library", label: "Library", sub: "trending papers & books", icon: BookOpen, color: "bg-mint" },
    { tab: "play", label: "Arcade", sub: "3D games while you wait", icon: Gamepad2, color: "bg-orange" },
  ] as const;
  return (
    <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
      <div onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
        className="card relative overflow-hidden bg-[linear-gradient(120deg,var(--violet),var(--pink))] p-6 text-[#121212]">
        <Quote className="floaty pointer-events-none absolute -right-3 -top-3 size-28 rotate-12 opacity-20" />
        <div className="relative z-10 mb-3 flex items-center gap-2">
          <span className="rounded-full border-2 border-[#121212] bg-white px-2.5 py-0.5 font-display text-[11px] font-extrabold uppercase tracking-widest">Thought of the day</span>
          <AnimatePresence mode="wait">
            <motion.span key={t.tag} initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}
              className={`rounded-full border-2 border-[#121212] px-2.5 py-0.5 text-[11px] font-extrabold ${TAG_COLOR[t.tag]}`}>#{t.tag}</motion.span>
          </AnimatePresence>
          <motion.button onClick={() => step(-1)} title="Previous" whileTap={{ scale: 0.85 }} whileHover={{ y: -2 }}
            className="ml-auto grid size-7 place-items-center rounded-full border-2 border-[#121212] bg-white text-xs font-extrabold">
            <ChevronLeft className="size-4" />
          </motion.button>
          <motion.button onClick={() => step(1)} title="Another one" whileTap={{ scale: 0.85, rotate: -6 }} whileHover={{ y: -2 }}
            className="inline-flex items-center gap-0.5 rounded-full border-2 border-[#121212] bg-white px-2.5 py-0.5 text-xs font-extrabold">
            Next<ChevronRight className="size-3.5" />
          </motion.button>
        </div>
        <AnimatePresence mode="wait">
          <motion.p key={i} className="relative z-10 font-display text-2xl font-extrabold leading-snug md:text-[28px]">
            {words.map((w, k) => (
              <motion.span key={k} className="mr-[0.25em] inline-block" initial={{ opacity: 0, y: 14, filter: "blur(6px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} exit={{ opacity: 0, y: -8 }} transition={{ delay: k * 0.035 }}>{w}</motion.span>
            ))}
          </motion.p>
        </AnimatePresence>
        <div className="relative z-10 mt-4 h-1.5 overflow-hidden rounded-full bg-white/40">
          <motion.div key={i} className="h-full bg-[#121212]" initial={{ width: "0%" }} animate={{ width: paused ? undefined : "100%" }}
            transition={{ duration: 12, ease: "linear" }} onAnimationComplete={() => !paused && step(1)} />
        </div>
      </div>
      <div className="grid gap-3">
        {links.map((l, k) => (
          <motion.button key={l.tab} onClick={() => onOpen(l.tab)} initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 + k * 0.08 }}
            whileHover={{ x: 6 }} className="btn-brut flex items-center gap-3 rounded-2xl bg-surface px-4 py-3 text-left">
            <span className={`grid size-10 place-items-center rounded-xl border-2 border-edge text-[#121212] ${l.color}`}><l.icon className="size-5" /></span>
            <span className="flex-1"><span className="block font-display font-extrabold">{l.label}</span><span className="block text-xs text-muted">{l.sub}</span></span>
            <ChevronRight className="size-5 text-muted" />
          </motion.button>
        ))}
      </div>
    </div>
  );
}
