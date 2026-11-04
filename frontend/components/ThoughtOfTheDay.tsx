"use client";

import clsx from "clsx";
import {
  BookOpen, Check, ChevronLeft, ChevronRight, Copy, Crown, Flame, Gamepad2, Heart, Lock, NotebookPen, Quote, Share2, Shuffle, Sparkles,
  Volume2, VolumeX, Wand2,
} from "lucide-react";
import { AnimatePresence, motion, useMotionValue, useSpring, useTransform, type PanInfo } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast, usePersistent } from "@/lib/api";
import { usePaid } from "./auth/AuthProvider";

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
  { text: "Figures are read before paragraphs. Make the caption say the finding, not the axis labels.", tag: "Writing" },
  { text: "Twenty minutes with the dataset beats two hours with the model summary.", tag: "Experiments" },
  { text: "If the result surprises you, look for the bug before you write the press release.", tag: "Experiments" },
  { text: "Cite the paper that did it first, not the one you happened to read first.", tag: "Integrity" },
  { text: "Skim ten abstracts before you deep-read one. Breadth tells you where depth is worth it.", tag: "Reading" },
  { text: "A good research question fits on a sticky note and still makes people argue.", tag: "Ideas" },
  { text: "Version your data like you version your code. Silent changes ruin replications.", tag: "Reproducibility" },
  { text: "Reviewers are your first readers, not your enemies. Answer the question behind the comment.", tag: "Mindset" },
  { text: "Delete the sentence you're proudest of if it doesn't help the reader.", tag: "Writing" },
  { text: "Two weeks of reading can save two months of building something that already exists.", tag: "Reading" },
  { text: "Report what you tried and dropped. It's half the story of how you got here.", tag: "Reproducibility" },
  { text: "Progress is a pile of small days. Show up for this one.", tag: "Mindset" },
  { text: "I stopped asking for a seat at the table when I realized I was built to own the room.", tag: "Grit" },
  { text: "When my body asks for mercy, my will shall remind it who is in charge.", tag: "Grit" },
  { text: "Until breath leaves the body, defeat remains a rumour.", tag: "Grit" },
  { text: "No one is coming to save you. That means no one is coming to stop you either.", tag: "Grit" },
  { text: "The arrow which goes the farthest was pulled back the most.", tag: "Grit" },
  { text: "Why seek validation from a world that crucified a perfect man?", tag: "Grit" },
  { text: "Trees don't hang around with the grass, even though they all started from the same place.", tag: "Grit" },
  { text: "I love how you don't let facts get in the way of your opinions.", tag: "Wit" },
  { text: "Nice to finally meet someone who's reached their full potential!", tag: "Wit" },
];

// Shown in full to paid members; free members see it blurred.
const PRO_INSIGHTS = [
  "Before submitting, search the venue's last two years for your keywords: cite the 2–3 closest papers or a reviewer from that group will.",
  "Turn every reviewer comment into a table row: comment, change, where. Editors accept faster when the response letter is scannable.",
  "Put your strongest figure on page 2. Most reviewers decide their score before reaching the method section.",
  "If your method has a weakness, name it in the introduction. Reviewers penalise hidden limitations more than stated ones.",
  "Match your abstract's first sentence to the venue's call for papers wording. Desk editors pattern-match.",
  "Run your related work through a citation audit before submission: a single retracted reference is an easy reject reason.",
];

const TAG_COLOR: Record<string, string> = {
  Integrity: "bg-crit text-white", Writing: "bg-blue text-white", Experiments: "bg-lime text-[#121212]", Ideas: "bg-yellow text-[#121212]",
  Reproducibility: "bg-violet text-white", Reading: "bg-mint text-[#121212]", Mindset: "bg-orange text-[#121212]",
  Grit: "bg-pink text-[#121212]", Wit: "bg-[#121212] text-white",
};
const TAG_GRAD: Record<string, string> = {
  Integrity: "from-[#ff6b6b] via-[#ff8fab] to-[#ffd166]", Writing: "from-[#4d7cff] via-[#a78bfa] to-[#ff8fab]",
  Experiments: "from-[#b8f35b] via-[#5ee6c1] to-[#4dd2ff]", Ideas: "from-[#ffe14d] via-[#ffb86b] to-[#ff7eb6]",
  Reproducibility: "from-[#8b5cf6] via-[#c084fc] to-[#60a5fa]", Reading: "from-[#5ee6c1] via-[#a7f3d0] to-[#fde68a]",
  Mindset: "from-[#ffa94d] via-[#ff7eb6] to-[#c084fc]",
  Grit: "from-[#ff4d8d] via-[#ff8a5c] to-[#ffd166]", Wit: "from-[#2b2d42] via-[#6b5bd6] to-[#ff7eb6]",
};
const TAGS = ["All", ...Object.keys(TAG_COLOR)];
const FREE_FAVS = 3;

const today = () => new Date().toISOString().slice(0, 10);
function dayIndex() {
  const d = new Date();
  return Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 0)) / 864e5);
}

function HeartBurst({ id }: { id: number }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center">
      {Array.from({ length: 10 }, (_, k) => {
        const a = (k / 10) * Math.PI * 2;
        return (
          <motion.span key={`${id}-${k}`} className="absolute text-2xl" initial={{ x: 0, y: 0, scale: 0.4, opacity: 1 }}
            animate={{ x: Math.cos(a) * 120, y: Math.sin(a) * 90, scale: 1.2, opacity: 0, rotate: k * 30 }} transition={{ duration: 0.9, ease: "easeOut" }}>
            {k % 3 ? "💖" : "✨"}
          </motion.span>
        );
      })}
    </div>
  );
}

export function ThoughtOfTheDay({ onOpen }: { onOpen: (tab: "studio" | "notes" | "library" | "play") => void }) {
  const { paid, gate } = usePaid();
  const [tag, setTag] = useState("All");
  const list = useMemo(() => THOUGHTS.map((t, i) => ({ ...t, i })).filter((t) => tag === "All" || t.tag === tag), [tag]);
  const [pos, setPos] = useState(() => dayIndex() % THOUGHTS.length);
  const [dir, setDir] = useState(1);
  const [paused, setPaused] = useState(false);
  const [favs, setFavs] = usePersistent<number[]>("thoughtFavs", []);
  const [streak, setStreak] = usePersistent<{ last: string; n: number }>("thoughtStreak", { last: "", n: 0 });
  const [burst, setBurst] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showFavs, setShowFavs] = useState(false);
  const cur = list[((pos % list.length) + list.length) % list.length];

  // daily streak
  useEffect(() => {
    const t = today();
    if (streak.last === t) return;
    const y = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    const id = setTimeout(() => setStreak({ last: t, n: streak.last === y ? streak.n + 1 : 1 }), 0);
    return () => clearTimeout(id);
  }, [streak, setStreak]);
  useEffect(() => () => { if (typeof window !== "undefined") window.speechSynthesis?.cancel(); }, []);

  // 3D tilt + shine following the pointer
  const card = useRef<HTMLDivElement>(null);
  const mx = useMotionValue(0.5), my = useMotionValue(0.5);
  const rx = useSpring(useTransform(my, [0, 1], [8, -8]), { stiffness: 180, damping: 18 });
  const ry = useSpring(useTransform(mx, [0, 1], [-10, 10]), { stiffness: 180, damping: 18 });
  const shine = useTransform([mx, my] as never, ([x, y]: number[]) => `radial-gradient(420px circle at ${x * 100}% ${y * 100}%, rgba(255,255,255,.45), transparent 45%)`);
  const onMove = (e: React.PointerEvent) => {
    const r = card.current?.getBoundingClientRect(); if (!r) return;
    mx.set((e.clientX - r.left) / r.width); my.set((e.clientY - r.top) / r.height);
  };

  const step = (d: number) => { setDir(d); setPos((p) => p + d); window.speechSynthesis?.cancel(); setSpeaking(false); };
  const shuffle = () => { setDir(1); setPos((p) => p + 1 + Math.floor(Math.random() * Math.max(1, list.length - 1))); };
  const onDragEnd = (_: unknown, info: PanInfo) => { if (Math.abs(info.offset.x) > 90 || Math.abs(info.velocity.x) > 500) step(info.offset.x < 0 ? 1 : -1); };

  const liked = favs.includes(cur.i);
  const like = () => {
    if (liked) { setFavs(favs.filter((x) => x !== cur.i)); return; }
    if (!paid && favs.length >= FREE_FAVS) { gate("favorites"); return; }
    setFavs([...favs, cur.i]); setBurst((b) => b + 1);
  };
  const listen = () => {
    const s = window.speechSynthesis; if (!s) return;
    if (speaking) { s.cancel(); setSpeaking(false); return; }
    const u = new SpeechSynthesisUtterance(cur.text); u.rate = 0.98; u.onend = () => setSpeaking(false);
    s.cancel(); s.speak(u); setSpeaking(true);
  };
  const copy = () => { navigator.clipboard?.writeText(`“${cur.text}” · Cite & Slayy`); setCopied(true); setTimeout(() => setCopied(false), 1400); };
  const share = async () => {
    const text = `“${cur.text}”\n\nThought of the day on Cite & Slayy · https://citeslayy.com`;
    try { if (navigator.share) await navigator.share({ text }); else { await navigator.clipboard.writeText(text); toast({ title: "Copied to share", tone: "good" }); } } catch { /* cancelled */ }
  };

  const words = cur.text.split(" ");
  const insight = PRO_INSIGHTS[dayIndex() % PRO_INSIGHTS.length];
  const links = [
    { tab: "studio", label: "Paper Studio", sub: "topic in, full paper out", icon: Wand2, color: "bg-pink" },
    { tab: "notes", label: "Notes", sub: "pages · stickies · to-dos", icon: NotebookPen, color: "bg-yellow" },
    { tab: "library", label: "Library", sub: "trending papers & books", icon: BookOpen, color: "bg-mint" },
    { tab: "play", label: "Arcade", sub: "3D games while you wait", icon: Gamepad2, color: "bg-orange" },
  ] as const;

  return (
    <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
      <div className="relative min-w-0" style={{ perspective: 1200 }} onMouseEnter={() => setPaused(true)} onMouseLeave={() => { setPaused(false); mx.set(0.5); my.set(0.5); }}>
        <AnimatePresence mode="popLayout" custom={dir} initial={false}>
          <motion.div key={`${tag}-${pos}`} ref={card} custom={dir} onPointerMove={onMove} drag="x" dragConstraints={{ left: 0, right: 0 }} dragElastic={0.5} onDragEnd={onDragEnd}
            initial={{ x: dir * 220, opacity: 0, rotate: dir * 5 }} animate={{ x: 0, opacity: 1, rotate: 0 }} exit={{ x: -dir * 260, opacity: 0, rotate: -dir * 6 }}
            transition={{ type: "spring", stiffness: 260, damping: 28 }} style={{ rotateX: rx, rotateY: ry, transformStyle: "preserve-3d" }}
            className="card relative h-full cursor-grab touch-pan-y select-none overflow-hidden bg-[linear-gradient(120deg,var(--violet),var(--pink))] p-5 text-[#121212] active:cursor-grabbing sm:p-6">
            {/* living background */}
            <motion.div aria-hidden className={clsx("pointer-events-none absolute -left-20 -top-24 size-72 rounded-full bg-gradient-to-br opacity-60 blur-3xl", TAG_GRAD[cur.tag])}
              animate={{ x: [0, 70, 0], y: [0, 40, 0], scale: [1, 1.15, 1] }} transition={{ repeat: Infinity, duration: 10 }} />
            <motion.div aria-hidden className="pointer-events-none absolute -bottom-24 right-0 size-72 rounded-full bg-white/30 blur-3xl" animate={{ x: [0, -60, 0], y: [0, -30, 0] }} transition={{ repeat: Infinity, duration: 12 }} />
            <motion.div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: shine }} />
            <motion.div aria-hidden animate={{ rotate: [12, 20, 12], y: [0, -6, 0] }} transition={{ repeat: Infinity, duration: 6 }} className="pointer-events-none absolute -right-3 -top-3 opacity-20">
              <Quote className="size-28" />
            </motion.div>

            {/* header: same place as before, plus category picker and streak */}
            <div className="relative z-10 mb-3 flex flex-wrap items-center gap-2" style={{ transform: "translateZ(30px)" }} onPointerDown={(e) => e.stopPropagation()}>
              <span className="rounded-full border-2 border-[#121212] bg-white px-2.5 py-0.5 font-display text-[11px] font-extrabold uppercase tracking-widest">Thought of the day</span>
              <label className="relative">
                <select value={tag} onChange={(e) => { setTag(e.target.value); setPos(0); }} aria-label="Category"
                  className={clsx("cursor-pointer appearance-none rounded-full border-2 border-[#121212] py-0.5 pl-2.5 pr-6 text-[11px] font-extrabold outline-none", tag === "All" ? TAG_COLOR[cur.tag] : TAG_COLOR[tag])}>
                  {TAGS.map((t) => <option key={t} value={t} className="bg-white text-[#121212]">{t === "All" ? `#${cur.tag} · all topics` : `#${t}`}</option>)}
                </select>
                <ChevronRight className="pointer-events-none absolute right-1.5 top-1/2 size-3 -translate-y-1/2 rotate-90" />
              </label>
              <span className="hidden items-center gap-1 rounded-full border-2 border-[#121212] bg-orange px-2 py-0.5 text-[11px] font-extrabold sm:inline-flex" title="Days in a row you've visited">
                <motion.span animate={{ rotate: [0, -12, 12, 0], scale: [1, 1.2, 1] }} transition={{ repeat: Infinity, duration: 2.2 }}><Flame className="size-3.5" /></motion.span>{streak.n || 1}
              </span>
              <motion.button onClick={() => step(-1)} title="Previous" whileTap={{ scale: 0.85 }} whileHover={{ y: -2 }}
                className="ml-auto grid size-7 place-items-center rounded-full border-2 border-[#121212] bg-white"><ChevronLeft className="size-4" /></motion.button>
              <motion.button onClick={() => step(1)} title="Another one" whileTap={{ scale: 0.85, rotate: -6 }} whileHover={{ y: -2 }}
                className="inline-flex items-center gap-0.5 rounded-full border-2 border-[#121212] bg-white px-2.5 py-0.5 text-xs font-extrabold">Next<ChevronRight className="size-3.5" /></motion.button>
            </div>

            <p className="relative z-10 font-display text-2xl font-extrabold leading-snug md:text-[28px]" style={{ transform: "translateZ(50px)" }}>
              {words.map((w, k) => (
                <motion.span key={k} className="mr-[0.25em] inline-block" initial={{ opacity: 0, y: 16, filter: "blur(8px)", rotateX: 60 }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)", rotateX: 0 }} transition={{ delay: 0.06 + k * 0.035, type: "spring", stiffness: 300, damping: 22 }}>{w}</motion.span>
              ))}
            </p>

            {/* actions */}
            <div className="relative z-10 mt-4 flex flex-wrap items-center gap-1.5" style={{ transform: "translateZ(40px)" }} onPointerDown={(e) => e.stopPropagation()}>
              <motion.button whileTap={{ scale: 0.8 }} whileHover={{ y: -2 }} onClick={like} title={liked ? "Remove from favourites" : "Save to favourites"}
                className={clsx("inline-flex items-center gap-1 rounded-full border-2 border-[#121212] px-2.5 py-0.5 text-xs font-extrabold", liked ? "bg-[#121212] text-white" : "bg-white/90")}>
                <motion.span animate={liked ? { scale: [1, 1.4, 1] } : {}}><Heart className={clsx("size-3.5", liked && "fill-pink text-pink")} /></motion.span>{favs.length || ""}
              </motion.button>
              {[
                { on: listen, icon: speaking ? VolumeX : Volume2, label: speaking ? "Stop" : "Listen" },
                { on: copy, icon: copied ? Check : Copy, label: copied ? "Copied" : "Copy" },
                { on: share, icon: Share2, label: "Share" },
                { on: shuffle, icon: Shuffle, label: "Shuffle" },
              ].map((b) => (
                <motion.button key={b.label} whileTap={{ scale: 0.85 }} whileHover={{ y: -2 }} onClick={b.on} title={b.label}
                  className="inline-flex items-center gap-1 rounded-full border-2 border-[#121212] bg-white/90 px-2.5 py-0.5 text-xs font-extrabold"><b.icon className="size-3.5" /><span className="hidden sm:inline">{b.label}</span></motion.button>
              ))}
              <motion.button whileTap={{ scale: 0.9 }} whileHover={{ y: -2 }} onClick={() => (paid ? setShowFavs(!showFavs) : gate("insights"))}
                className="ml-auto inline-flex items-center gap-1 rounded-full border-2 border-[#121212] bg-[#121212] px-2.5 py-0.5 text-xs font-extrabold text-yellow">
                {paid ? <Crown className="size-3.5" /> : <Lock className="size-3.5" />}Pro insight
              </motion.button>
            </div>

            <AnimatePresence>
              {showFavs && paid && (
                <motion.p initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                  className="relative z-10 mt-3 overflow-hidden rounded-xl border-2 border-[#121212] bg-white/85 px-3 py-2 text-sm font-semibold" onPointerDown={(e) => e.stopPropagation()}>
                  <Sparkles className="mr-1 inline size-3.5 text-pink" />{insight}
                </motion.p>
              )}
            </AnimatePresence>

            <div className="relative z-10 mt-4 h-1.5 overflow-hidden rounded-full bg-white/40">
              <motion.div key={`${tag}-${pos}-${paused}`} className="h-full bg-[#121212]" initial={{ width: "0%" }} animate={{ width: paused ? "0%" : "100%" }}
                transition={{ duration: paused ? 0.2 : 12, ease: "linear" }} onAnimationComplete={() => { if (!paused) step(1); }} />
            </div>
            <AnimatePresence>{burst > 0 && <HeartBurst key={burst} id={burst} />}</AnimatePresence>
          </motion.div>
        </AnimatePresence>
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
