"use client";

import clsx from "clsx";
import { Heart, Trophy, Volume2, VolumeX } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { isMuted, setMuted, sfx } from "@/lib/sfx";

export type Phase = "idle" | "play" | "over";

/** Shared chrome for the 3D games: HUD, start / game-over overlay, best score. */
export function GameFrame({ title, emoji, how, phase, score, best, lives, extra, onStart, children, height = 480 }: {
  title: string; emoji: string; how: ReactNode; phase: Phase; score: number; best: number; lives?: number; extra?: ReactNode;
  onStart: () => void; children: ReactNode; height?: number;
}) {
  const [muted, setM] = useState(isMuted);
  const prev = useRef(phase);
  useEffect(() => {
    if (prev.current === "play" && phase === "over") sfx("over");
    prev.current = phase;
  }, [phase]);
  return (
    <div className="relative overflow-hidden rounded-2xl border-[2.5px] border-edge bg-[#120d1f] shadow-[5px_5px_0_var(--shadow-c)] select-none" style={{ height }}>
      {children}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-3 p-3 text-white">
        <motion.span key={score} initial={{ scale: 1.4 }} animate={{ scale: 1 }} className="rounded-xl border-2 border-white/30 bg-black/40 px-3 py-1 font-display text-lg font-extrabold tabular-nums backdrop-blur">
          ⭐ {score}
        </motion.span>
        {typeof lives === "number" && (
          <span className="flex gap-0.5 rounded-xl border-2 border-white/30 bg-black/40 px-2 py-1.5 backdrop-blur">
            {Array.from({ length: 3 }, (_, i) => <Heart key={i} className={clsx("size-4", i < lives ? "fill-[#ff4fa3] text-[#ff4fa3]" : "text-white/30")} />)}
          </span>
        )}
        {extra}
        <span className="ml-auto inline-flex items-center gap-1 rounded-xl border-2 border-white/30 bg-black/40 px-2.5 py-1 text-sm font-bold backdrop-blur"><Trophy className="size-4 text-[#ffd23f]" />{best}</span>
        <button onClick={() => { setMuted(!muted); setM(!muted); }} title={muted ? "Sound on" : "Mute"}
          className="pointer-events-auto rounded-xl border-2 border-white/30 bg-black/40 p-1.5 backdrop-blur">{muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}</button>
      </div>
      <AnimatePresence>
        {phase !== "play" && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 grid place-items-center bg-[#120d1f]/70 p-6 text-center text-white backdrop-blur-sm">
            <motion.div initial={{ scale: 0.8, y: 20 }} animate={{ scale: 1, y: 0 }} transition={{ type: "spring", stiffness: 200 }}>
              <motion.div className="text-6xl" animate={{ rotate: [0, -10, 10, 0], y: [0, -6, 0] }} transition={{ repeat: Infinity, duration: 2.4 }}>
                {phase === "over" ? (score >= best && score > 0 ? "🏆" : "💥") : emoji}
              </motion.div>
              <div className="mt-2 font-display text-3xl font-extrabold">{phase === "over" ? `Score ${score}` : title}</div>
              <div className="mx-auto mt-2 max-w-sm text-sm text-white/75">
                {phase === "over" ? (score >= best && score > 0 ? "New personal best!" : `Best: ${best}. One more go?`) : how}
              </div>
              <button onClick={() => { sfx("start"); onStart(); }} className="btn-brut mt-5 rounded-2xl bg-[#ff4fa3] px-6 py-3 font-display text-lg font-extrabold text-[#121212]">
                {phase === "over" ? "Play again" : "Start"}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
