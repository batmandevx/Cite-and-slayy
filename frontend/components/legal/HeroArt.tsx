"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

/** Floating stickers and blobs behind a policy page's title. */
export function HeroArt({ icon }: { icon: ReactNode }) {
  const reduce = useReducedMotion();
  const float = (d: number) => (reduce ? {} : { animate: { y: [0, -10, 0], rotate: [0, d, 0] }, transition: { repeat: Infinity, duration: 5 + Math.abs(d) / 3, ease: "easeInOut" as const } });
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute -right-16 -top-16 size-64 rounded-full bg-yellow opacity-50 blur-3xl" />
      <div className="absolute -bottom-20 left-1/3 size-56 rounded-full bg-pink opacity-30 blur-3xl" />
      <motion.div {...float(8)} className="absolute right-8 top-8 hidden size-24 place-items-center rounded-3xl border-[3px] border-edge bg-surface text-[#121212] shadow-[5px_5px_0_var(--shadow-c)] md:grid">
        {icon}
      </motion.div>
      <motion.div {...float(-12)} className="absolute bottom-8 right-36 hidden size-10 rounded-full border-[3px] border-edge bg-mint md:block" />
      <motion.div {...float(15)} className="absolute right-4 top-40 hidden size-8 rotate-12 rounded-lg border-[3px] border-edge bg-orange md:block" />
    </div>
  );
}
