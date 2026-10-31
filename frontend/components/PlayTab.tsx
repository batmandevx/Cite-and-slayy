"use client";

import { usePaid } from "./auth/AuthProvider";
import { ProChip } from "./billing/ProLock";

import clsx from "clsx";
import { Brain, ExternalLink, Gamepad2, Heart, Orbit, Plane, Rocket, RotateCcw, Shield, Shuffle, Sparkles, Target, Trophy } from "lucide-react";
import { MeteorShield } from "./games3d/MeteorShield";
import { TiltMaze } from "./games3d/TiltMaze";
import { BubblePop } from "./games3d/BubblePop";
import { NeonRunner } from "./games3d/NeonRunner";
import { RingFlyer } from "./games3d/RingFlyer";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, usePersistent } from "@/lib/api";
import { sfx } from "@/lib/sfx";
import { Confetti } from "./Confetti";
import { Button, Card } from "./ui";

// ---------------- Tortured Phrase Quiz ----------------
interface Q { tortured: string; answer: string; choices: string[]; source: string }

function TorturedQuiz() {
  const [qs, setQs] = useState<Q[] | null>(null);
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [best, setBest] = usePersistent("bestQuiz", 0);
  const load = useCallback(() => {
    setQs(null); setI(0); setPicked(null); setScore(0); setStreak(0);
    api.get<Q[]>("/api/games/tortured?n=8").then(setQs).catch(() => setQs([]));
  }, []);
  useEffect(() => { api.get<Q[]>("/api/games/tortured?n=8").then(setQs).catch(() => setQs([])); }, []);

  if (!qs) return <div className="shimmer h-72 rounded-2xl" />;
  if (!qs.length) return <p className="py-10 text-center text-sm text-muted">Couldn&apos;t load questions from the backend.</p>;
  const done = i >= qs.length;
  const q = qs[Math.min(i, qs.length - 1)];
  const choose = (c: string) => {
    if (picked) return;
    setPicked(c);
    const ok = c === q.answer;
    sfx(ok ? "right" : "wrong");
    if (ok) { setScore((s) => s + 1); setStreak((s) => s + 1); } else setStreak(0);
    setTimeout(() => {
      setPicked(null);
      setI((n) => n + 1);
      if (i + 1 >= qs.length) setBest((b) => Math.max(b, score + (ok ? 1 : 0)));
    }, 1400);
  };

  if (done) {
    const perfect = score === qs.length;
    return (
      <div className="relative py-8 text-center">
        {score >= qs.length * 0.75 && <Confetti />}
        <motion.div initial={{ scale: 0, rotate: -20 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring" }} className="text-7xl">{perfect ? "🏆" : score >= qs.length / 2 ? "🎉" : "🧐"}</motion.div>
        <div className="mt-3 font-display text-4xl font-extrabold">{score} / {qs.length}</div>
        <p className="mt-1 text-ink-2">{perfect ? "Flawless. Paper mills fear you." : score >= qs.length / 2 ? "Sharp eye! You'd catch most paper-mill text." : "Tricky, right? That's why CiteGuard checks for them automatically."}</p>
        <Button variant="primary" className="mt-5" onClick={load}><RotateCcw className="size-4" />Play again</Button>
      </div>
    );
  }
  return (
    <div>
      <div className="mb-4 flex items-center gap-3 text-sm font-bold">
        <span>Question {i + 1}/{qs.length}</span>
        <div className="h-3 flex-1 overflow-hidden rounded-full border-2 border-edge bg-surface-2">
          <motion.div className="h-full bg-pink" animate={{ width: `${(i / qs.length) * 100}%` }} />
        </div>
        <span>⭐ {score}</span>
        {streak >= 2 && <motion.span key={streak} initial={{ scale: 1.6 }} animate={{ scale: 1 }} className="rounded-full border-2 border-edge bg-orange px-2 text-[#121212]">🔥 {streak}</motion.span>}
        <span className="text-muted">Best {best}</span>
      </div>
      <AnimatePresence mode="wait">
        <motion.div key={i} initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }}>
          <p className="text-xs font-bold uppercase tracking-widest text-muted">This “tortured phrase” was found in real published papers. What did the author mean?</p>
          <motion.div animate={picked && picked !== q.answer ? { x: [0, -10, 10, -6, 6, 0] } : {}} transition={{ duration: 0.4 }}
            className="my-4 rounded-2xl border-[2.5px] border-edge bg-yellow px-5 py-6 text-center font-display text-3xl font-extrabold text-[#121212] shadow-[5px_5px_0_var(--shadow-c)]">
            “{q.tortured}”
          </motion.div>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {q.choices.map((c) => {
              const state = !picked ? "idle" : c === q.answer ? "right" : c === picked ? "wrong" : "dim";
              return (
                <motion.button key={c} whileHover={!picked ? { y: -3 } : {}} whileTap={!picked ? { scale: 0.96 } : {}} onClick={() => choose(c)}
                  className={clsx("btn-brut rounded-xl px-4 py-3 text-left font-display font-bold",
                    state === "idle" && "bg-surface", state === "right" && "bg-good text-white", state === "wrong" && "bg-crit text-white", state === "dim" && "bg-surface opacity-40")}>
                  {c}
                </motion.button>
              );
            })}
          </div>
          {picked && (
            <motion.a initial={{ opacity: 0 }} animate={{ opacity: 1 }} href={q.source} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs text-ink-2 hover:underline">
              <ExternalLink className="size-3" />Source for this phrase
            </motion.a>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

// ---------------- Memory Match ----------------
const PAIRS: [string, string][] = [
  ["BERT", "Bidirectional Encoder Representations from Transformers"],
  ["GAN", "Generative Adversarial Network"],
  ["RAG", "Retrieval-Augmented Generation"],
  ["LoRA", "Low-Rank Adaptation"],
  ["DOI", "Digital Object Identifier"],
  ["ORCID", "Open Researcher and Contributor ID"],
  ["CNN", "Convolutional Neural Network"],
  ["LSTM", "Long Short-Term Memory"],
  ["RLHF", "Reinforcement Learning from Human Feedback"],
  ["PRISMA", "Preferred Reporting Items for Systematic Reviews and Meta-Analyses"],
  ["ANOVA", "Analysis of Variance"],
  ["IMRaD", "Introduction, Methods, Results and Discussion"],
];
interface MCard { id: number; pair: number; text: string; acro: boolean }

function deal(): MCard[] {
  const chosen = [...PAIRS.keys()].sort(() => Math.random() - 0.5).slice(0, 6);
  const cards = chosen.flatMap((p, k) => [
    { id: k * 2, pair: p, text: PAIRS[p][0], acro: true },
    { id: k * 2 + 1, pair: p, text: PAIRS[p][1], acro: false },
  ]);
  return cards.sort(() => Math.random() - 0.5);
}

function MemoryMatch() {
  const [cards, setCards] = useState<MCard[]>(deal);
  const [open, setOpen] = useState<number[]>([]);
  const [matched, setMatched] = useState<Set<number>>(new Set());
  const [moves, setMoves] = useState(0);
  const [best, setBest] = usePersistent<number | null>("bestMemory", null);
  const won = matched.size === 6;

  const flip = (c: MCard) => {
    if (open.length === 2 || open.includes(c.id) || matched.has(c.pair)) return;
    const next = [...open, c.id];
    setOpen(next);
    sfx("flip");
    if (next.length === 2) {
      setMoves((m) => m + 1);
      const [a, b] = next.map((id) => cards.find((x) => x.id === id)!);
      if (a.pair === b.pair) {
        setTimeout(() => {
          sfx("coin");
          setMatched((s) => {
            const n = new Set(s).add(a.pair);
            if (n.size === 6) setBest((bst) => (bst === null ? moves + 1 : Math.min(bst, moves + 1)));
            return n;
          });
          setOpen([]);
        }, 450);
      } else setTimeout(() => setOpen([]), 1000);
    }
  };
  const reset = () => { setCards(deal()); setOpen([]); setMatched(new Set()); setMoves(0); };

  return (
    <div className="relative">
      {won && <Confetti />}
      <div className="mb-4 flex items-center gap-3 text-sm font-bold">
        <span>Match each acronym to its meaning</span>
        <span className="ml-auto">Moves {moves}</span>
        <span className="text-muted">Best {best ?? "–"}</span>
        <Button className="!py-1 text-xs" onClick={reset}><Shuffle className="size-3.5" />Shuffle</Button>
      </div>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4" style={{ perspective: 900 }}>
        {cards.map((c) => {
          const up = open.includes(c.id) || matched.has(c.pair);
          return (
            <motion.button key={c.id} onClick={() => flip(c)} className="relative h-28" style={{ transformStyle: "preserve-3d" }}
              animate={{ rotateY: up ? 180 : 0, scale: matched.has(c.pair) ? 0.94 : 1 }} transition={{ type: "spring", stiffness: 220, damping: 20 }}
              whileHover={!up ? { y: -4 } : {}}>
              <span className="absolute inset-0 grid place-items-center rounded-xl border-[2.5px] border-edge bg-pink font-display text-3xl font-extrabold text-[#121212] shadow-[4px_4px_0_var(--shadow-c)] [backface-visibility:hidden]">?</span>
              <span className={clsx("absolute inset-0 grid place-items-center rounded-xl border-[2.5px] border-edge p-2 text-center shadow-[4px_4px_0_var(--shadow-c)] [backface-visibility:hidden] [transform:rotateY(180deg)]",
                matched.has(c.pair) ? "bg-lime text-[#121212]" : "bg-surface",
                c.acro ? "font-display text-2xl font-extrabold" : "text-[11px] font-bold leading-tight")}>
                {c.text}
              </span>
            </motion.button>
          );
        })}
      </div>
      {won && <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="mt-5 text-center font-display text-2xl font-extrabold">Cleared in {moves} moves! 🧠</motion.div>}
    </div>
  );
}

// ---------------- Catch the Retraction ----------------
const BAD = ["RETRACTED", "Fake DOI", "Tortured phrase", "Not found", "Paper mill", "Wrong year"];
const GOOD = ["Verified ✓", "DOI ✓", "Supported", "Peer-reviewed", "Open data", "Replicated"];
interface Drop { id: number; x: number; y: number; v: number; bad: boolean; label: string; rot: number }
const H = 420;

function CatchRetraction() {
  const [drops, setDrops] = useState<Drop[]>([]);
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(3);
  const [phase, setPhase] = useState<"idle" | "play" | "over">("idle");
  const [pops, setPops] = useState<{ id: number; x: number; y: number; text: string; good: boolean }[]>([]);
  const [best, setBest] = usePersistent("bestCatch", 0);
  const st = useRef({ last: 0, spawn: 0, id: 0, score: 0, lives: 3, drops: [] as Drop[] });

  const start = () => {
    st.current = { last: 0, spawn: 0, id: 0, score: 0, lives: 3, drops: [] };
    setDrops([]); setScore(0); setLives(3); setPops([]); setPhase("play");
  };

  useEffect(() => {
    if (phase !== "play") return;
    let raf = 0;
    const tick = (t: number) => {
      const s = st.current;
      const dt = s.last ? Math.min(0.05, (t - s.last) / 1000) : 0;
      s.last = t; s.spawn -= dt;
      const speedUp = 1 + s.score * 0.04;
      let next = s.drops.map((d) => ({ ...d, y: d.y + d.v * speedUp * dt }));
      const missed = next.filter((d) => d.y > H && d.bad).length;
      next = next.filter((d) => d.y <= H);
      if (s.spawn <= 0) {
        s.spawn = Math.max(0.45, 1.1 - s.score * 0.025);
        const bad = Math.random() < 0.55;
        next.push({ id: s.id++, x: 4 + Math.random() * 74, y: -50, v: 70 + Math.random() * 50, bad,
          label: (bad ? BAD : GOOD)[Math.floor(Math.random() * 6)], rot: Math.random() * 16 - 8 });
      }
      s.drops = next;
      setDrops(next);
      if (missed) {
        s.lives -= missed; setLives(s.lives);
        if (s.lives <= 0) { setPhase("over"); setBest((b) => Math.max(b, s.score)); return; }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase, setBest]);

  const hit = (d: Drop) => {
    if (phase !== "play") return;
    const s = st.current;
    if (!s.drops.some((x) => x.id === d.id)) return;
    s.drops = s.drops.filter((x) => x.id !== d.id);
    setDrops(s.drops);
    const pop = { id: d.id, x: d.x, y: d.y, text: d.bad ? "+1" : "−❤", good: d.bad };
    setPops((p) => [...p.slice(-6), pop]);
    setTimeout(() => setPops((p) => p.filter((x) => x.id !== pop.id)), 700);
    if (d.bad) { s.score += 1; setScore(s.score); sfx("pop", Math.min(1, s.score / 20)); }
    else {
      sfx("hit");
      s.lives -= 1; setLives(s.lives);
      if (s.lives <= 0) { setPhase("over"); setBest((b) => Math.max(b, s.score)); }
    }
  };

  return (
    <div>
      <div className="mb-3 flex items-center gap-3 text-sm font-bold">
        <span>Zap the bad references. Let the good ones fall.</span>
        <span className="ml-auto">⭐ {score}</span>
        <span className="flex">{Array.from({ length: 3 }, (_, k) => <Heart key={k} className={clsx("size-4", k < lives ? "fill-crit text-crit" : "text-line")} />)}</span>
        <span className="text-muted">Best {best}</span>
      </div>
      <div className="relative overflow-hidden rounded-2xl border-[2.5px] border-edge bg-[radial-gradient(circle_at_50%_0%,var(--surface-2),var(--surface))] shadow-[5px_5px_0_var(--shadow-c)] select-none" style={{ height: H }}>
        {drops.map((d) => (
          <button key={d.id} onPointerDown={() => hit(d)} style={{ left: `${d.x}%`, top: d.y, transform: `rotate(${d.rot}deg)` }}
            className={clsx("absolute rounded-lg border-[2.5px] border-[#121212] px-2.5 py-1.5 font-display text-xs font-extrabold text-[#121212] shadow-[3px_3px_0_#121212]",
              d.bad ? "bg-crit text-white" : "bg-lime")}>
            📄 {d.label}
          </button>
        ))}
        <AnimatePresence>
          {pops.map((p) => (
            <motion.span key={p.id} initial={{ opacity: 1, y: 0, scale: 0.6 }} animate={{ opacity: 0, y: -50, scale: 1.4 }} exit={{ opacity: 0 }}
              style={{ left: `${p.x}%`, top: p.y }} className={clsx("pointer-events-none absolute font-display text-xl font-extrabold", p.good ? "text-good" : "text-crit")}>{p.text}</motion.span>
          ))}
        </AnimatePresence>
        {phase !== "play" && (
          <div className="absolute inset-0 grid place-items-center bg-bg/70 backdrop-blur-sm">
            <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="text-center">
              <div className="text-6xl">{phase === "over" ? "💥" : "🎯"}</div>
              <div className="mt-2 font-display text-3xl font-extrabold">{phase === "over" ? `Score: ${score}` : "Catch the Retraction"}</div>
              <p className="mx-auto mt-1 max-w-xs text-sm text-ink-2">
                {phase === "over" ? (score >= best && score > 0 ? "New personal best! 🏆" : "Bad refs slipped through. Try again?") : "Click red cards (retracted, fake, tortured) before they land. Clicking a green card costs a life."}
              </p>
              <Button variant="primary" className="mt-4" onClick={start}>{phase === "over" ? "Play again" : "Start"}</Button>
            </motion.div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------- shell ----------------
const GAMES = [
  { id: "runner", name: "Neon Runner", desc: "3D: dodge, jump, grab gems", icon: Rocket, color: "bg-pink", three: true },
  { id: "rings", name: "Ring Flyer", desc: "3D: fly a jet through glowing rings", icon: Plane, color: "bg-blue", three: true },
  { id: "bubbles", name: "Bubble Pop", desc: "3D: pop bubbles, dodge bombs", icon: Sparkles, color: "bg-mint", three: true },
  { id: "meteor", name: "Meteor Shield", desc: "3D: guard the planet from meteors", icon: Shield, color: "bg-orange", three: true },
  { id: "maze", name: "Tilt Maze", desc: "3D: tilt the board, roll to the goal", icon: Orbit, color: "bg-violet", three: true },
  { id: "quiz", name: "Tortured Phrase Quiz", desc: "Decode paper-mill gibberish", icon: Brain, color: "bg-yellow", three: false },
  { id: "memory", name: "Acronym Memory", desc: "Flip and match research acronyms", icon: Gamepad2, color: "bg-violet", three: false },
  { id: "catch", name: "Catch the Retraction", desc: "Zap the bad references", icon: Target, color: "bg-lime", three: false },
] as const;
type GameId = (typeof GAMES)[number]["id"];

const FREE_GAMES = new Set<string>(["runner", "quiz"]);

export function PlayTab() {
  const { paid, gate } = usePaid();
  const [pick, setGame] = usePersistent<GameId>("playGame", "runner");
  const game: GameId = paid || FREE_GAMES.has(pick) ? pick : "runner";
  const [bq] = usePersistent("bestQuiz", 0);
  const [bm] = usePersistent<number | null>("bestMemory", null);
  const [bc] = usePersistent("bestCatch", 0);
  const [br] = usePersistent("best3dRunner", 0);
  const [bf] = usePersistent("best3dRings", 0);
  const [bb] = usePersistent("best3dBubbles", 0);
  const [bms] = usePersistent("best3dMeteor", 0);
  const [bmz] = usePersistent("best3dMaze", 0);
  const g = GAMES.find((x) => x.id === game) ?? GAMES[0];
  const tile = (x: (typeof GAMES)[number], i: number) => (
    <motion.button key={x.id} onClick={() => { if (paid || FREE_GAMES.has(x.id) || gate("arcade")) setGame(x.id); }} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
      whileHover={{ y: -5, rotate: i % 2 ? 1 : -1 }} whileTap={{ scale: 0.97 }}
      className={clsx("btn-brut flex items-center gap-3 rounded-2xl p-3.5 text-left", g.id === x.id ? `${x.color} ${x.color === "bg-blue" || x.color === "bg-violet" ? "text-white" : "text-[#121212]"}` : "bg-surface")}>
      <span className={clsx("grid size-11 shrink-0 place-items-center rounded-xl border-[2.5px] border-edge bg-surface text-ink", g.id === x.id && "wobble")}><x.icon className="size-5" /></span>
      <span className="min-w-0"><span className="flex items-center gap-1.5 font-display text-base font-extrabold leading-tight">{x.name}{!paid && !FREE_GAMES.has(x.id) && <ProChip />}</span><span className="block truncate text-xs font-semibold opacity-75">{x.desc}</span></span>
    </motion.button>
  );
  return (
    <div className="space-y-5">
      <Card pop className="relative overflow-hidden p-5">
        <div className="pointer-events-none absolute -right-8 -top-10 size-48 rounded-full bg-pink/30 blur-2xl" />
        <div className="relative flex flex-wrap items-center gap-3">
          <motion.span className="text-4xl" animate={{ rotate: [0, -12, 12, 0] }} transition={{ repeat: Infinity, duration: 2.5 }}>🎮</motion.span>
          <div className="flex-1">
            <div className="font-display text-2xl font-extrabold">Arcade</div>
            <div className="text-sm text-ink-2">Take a break while your paper is being written. We&apos;ll ping you the moment it&apos;s ready.</div>
          </div>
        </div>
      </Card>
      <div>
        <div className="mb-2 font-display text-xs font-extrabold uppercase tracking-widest text-muted">3D arcade</div>
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">{GAMES.filter((x) => x.three).map(tile)}</div>
        <div className="mb-2 mt-4 font-display text-xs font-extrabold uppercase tracking-widest text-muted">Research games</div>
        <div className="grid gap-3 md:grid-cols-3">{GAMES.filter((x) => !x.three).map((x, i) => tile(x, i + 5))}</div>
      </div>
      <div className="grid gap-5 lg:grid-cols-[1fr_240px]">
        <Card className="p-4 sm:p-5">
          <AnimatePresence mode="wait">
            <motion.div key={g.id} initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }}>
              <h3 className="mb-3 flex items-center gap-2 font-display text-2xl font-extrabold"><g.icon className="size-6" />{g.name}</h3>
              {g.id === "runner" && <NeonRunner />}
              {g.id === "rings" && <RingFlyer />}
              {g.id === "bubbles" && <BubblePop />}
              {g.id === "meteor" && <MeteorShield />}
              {g.id === "maze" && <TiltMaze />}
              {g.id === "quiz" && <TorturedQuiz />}
              {g.id === "memory" && <MemoryMatch />}
              {g.id === "catch" && <CatchRetraction />}
            </motion.div>
          </AnimatePresence>
        </Card>
        <Card className="h-fit p-5">
          <div className="mb-3 flex items-center gap-2 font-display text-lg font-extrabold"><Trophy className="size-5 text-warn" />Your records</div>
          {[["Neon Runner", br], ["Ring Flyer", bf], ["Bubble Pop", bb], ["Meteor Shield", bms], ["Tilt Maze", bmz], ["Quiz best", `${bq} / 8`], ["Memory fewest moves", bm ?? "–"], ["Catch best", bc]].map(([k, v]) => (
            <div key={k as string} className="flex items-center justify-between border-b-2 border-dashed border-line py-2 text-sm last:border-0">
              <span className="text-ink-2">{k}</span><span className="font-display text-lg font-extrabold">{v}</span>
            </div>
          ))}
          <p className="mt-3 text-xs text-muted">Every tortured phrase in the quiz comes from our curated, sourced list, the same one CiteGuard uses.</p>
        </Card>
      </div>
    </div>
  );
}
