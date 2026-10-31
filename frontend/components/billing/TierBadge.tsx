"use client";

import clsx from "clsx";
import { Crown, Gem, Package, Sparkles, Zap } from "lucide-react";
import { motion } from "motion/react";

export type Tier = "founder" | "max" | "pro" | "pack" | "free";

const LOOK: Record<Tier, { label: string; icon: typeof Crown; cls: string; shine: boolean }> = {
  founder: { label: "Founder", icon: Crown, cls: "bg-[linear-gradient(110deg,#8a6a1f,#f6d36b,#fff2bf,#e3b341,#8a6a1f)] text-[#2a1d05]", shine: true },
  max: { label: "Max", icon: Gem, cls: "bg-[linear-gradient(110deg,#7b5cff,#ff5fa2,#4fe3ff,#7b5cff)] text-white", shine: true },
  pro: { label: "Pro", icon: Zap, cls: "bg-pink text-[#121212]", shine: false },
  pack: { label: "Paper Pack", icon: Package, cls: "bg-orange text-[#121212]", shine: false },
  free: { label: "Free", icon: Sparkles, cls: "bg-surface-2 text-ink-2", shine: false },
};

/** Membership badge: animated gold for founders, holographic for Max, solid for Pro / Pack, plain for Free. */
export function TierBadge({ tier, size = "sm", className }: { tier: Tier; size?: "xs" | "sm" | "md"; className?: string }) {
  const l = LOOK[tier] ?? LOOK.free;
  return (
    <motion.span
      className={clsx("relative inline-flex items-center gap-1 overflow-hidden rounded-full border-2 border-edge font-extrabold uppercase tracking-wider", l.cls,
        size === "xs" ? "px-1.5 text-[9px] leading-4" : size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-3 py-1 text-xs", className)}
      style={l.shine ? { backgroundSize: "250% 100%" } : undefined}
      animate={l.shine ? { backgroundPosition: ["0% 50%", "100% 50%", "0% 50%"] } : undefined}
      transition={l.shine ? { repeat: Infinity, duration: 5, ease: "linear" } : undefined}>
      <l.icon className={size === "md" ? "size-3.5" : "size-3"} />{l.label}
      {l.shine && (
        <motion.span aria-hidden className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/3 skew-x-[-20deg] bg-white/50"
          animate={{ x: ["0%", "450%"] }} transition={{ repeat: Infinity, duration: 2.8, ease: "easeInOut", repeatDelay: 1.2 }} />
      )}
    </motion.span>
  );
}
