"use client";

import { motion, useReducedMotion } from "motion/react";
import { useMemo } from "react";

const COLORS = ["#3987e5", "#1baf7a", "#fab219", "#eb6834", "#e87ba4", "#ffffff"];

/** A one-shot burst. Only rendered for a genuine "Submit" verdict. */
export function Confetti({ count = 70 }: { count?: number }) {
  const reduced = useReducedMotion();
  const bits = useMemo(() => Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2 + (i % 3) * 0.4;
    const d = 160 + ((i * 37) % 220);
    return { x: Math.cos(a) * d, y: Math.sin(a) * d * 0.7 - 120, r: (i * 53) % 360, c: COLORS[i % COLORS.length],
             w: 6 + (i % 4) * 2, delay: (i % 10) * 0.012 };
  }), [count]);
  if (reduced) return null;
  return (
    <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 z-20">
      {bits.map((b, i) => (
        <motion.span key={i} className="absolute rounded-[2px]" style={{ width: b.w, height: b.w * 0.45, background: b.c }}
          initial={{ x: 0, y: 0, opacity: 1, rotate: 0, scale: 0.6 }}
          animate={{ x: b.x, y: [0, b.y, b.y + 260], opacity: [1, 1, 0], rotate: b.r * 3, scale: 1 }}
          transition={{ duration: 1.8, delay: b.delay, ease: [0.2, 0.8, 0.4, 1] }} />
      ))}
    </div>
  );
}
