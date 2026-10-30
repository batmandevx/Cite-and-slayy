"use client";

import clsx from "clsx";
import { Crown, Lock, Sparkles } from "lucide-react";
import { motion } from "motion/react";
import { usePaid } from "../auth/AuthProvider";

/** Tiny "PRO" chip shown on locked buttons. */
export function ProChip({ className }: { className?: string }) {
  return (
    <span className={clsx("inline-flex items-center gap-0.5 rounded-full border border-edge bg-yellow px-1.5 text-[9px] font-extrabold uppercase leading-4 text-[#121212]", className)}>
      <Lock className="size-2.5" />Pro
    </span>
  );
}

/** Wraps an action: paid users run it, free users see the upgrade screen for `feature`. */
export function useLocked(feature: string) {
  const { paid, gate } = usePaid();
  return { locked: !paid, run: (fn: () => unknown) => { if (gate(feature)) fn(); } };
}

/** Full-width unlock panel (e.g. over a faded paper preview). */
export function UnlockPanel({ feature, title, perks, className }: { feature: string; title: string; perks: string[]; className?: string }) {
  const { gate } = usePaid();
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      className={clsx("relative overflow-hidden rounded-2xl border-[2.5px] border-edge bg-surface p-6 text-center shadow-[5px_5px_0_var(--shadow-c)]", className)}>
      <motion.div className="pointer-events-none absolute -right-10 -top-10 size-40 rounded-full bg-pink/30 blur-2xl" animate={{ scale: [1, 1.2, 1] }} transition={{ repeat: Infinity, duration: 5 }} />
      <motion.div className="pointer-events-none absolute -bottom-12 -left-10 size-40 rounded-full bg-yellow/40 blur-2xl" animate={{ scale: [1.1, 1, 1.1] }} transition={{ repeat: Infinity, duration: 6 }} />
      <div className="relative">
        <div className="mx-auto grid size-12 place-items-center rounded-2xl border-2 border-edge bg-yellow text-[#121212] shadow-[3px_3px_0_var(--shadow-c)]"><Crown className="size-6" /></div>
        <h3 className="mt-3 font-display text-2xl font-extrabold">{title}</h3>
        <ul className="mx-auto mt-3 max-w-md space-y-1.5 text-left text-sm">
          {perks.map((p) => <li key={p} className="flex items-start gap-2"><Sparkles className="mt-0.5 size-4 shrink-0 text-pink" />{p}</li>)}
        </ul>
        <motion.button whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }} onClick={() => gate(feature)}
          className="btn-brut mt-5 inline-flex items-center gap-2 rounded-2xl bg-[linear-gradient(120deg,var(--pink),var(--yellow))] px-6 py-3 font-display text-base font-extrabold text-[#121212]">
          <Lock className="size-4" />Unlock with Pro · from ₹6,999/mo
        </motion.button>
        <p className="mt-2 text-[11px] text-muted">Or get one finished paper with the ₹9,999 Paper Pack. Cancel any time.</p>
      </div>
    </motion.div>
  );
}

/** A whole tool behind the paywall: free users see a live, blurred preview with the pitch on top. */
export function LockedTab({ feature, title, perks, children }: { feature: string; title: string; perks: string[]; children: React.ReactNode }) {
  const { paid } = usePaid();
  if (paid) return <>{children}</>;
  return (
    <div className="relative">
      <div aria-hidden className="pointer-events-none max-h-[640px] select-none overflow-hidden opacity-60 blur-[3px] [mask-image:linear-gradient(to_bottom,black_30%,transparent)]">
        {children}
      </div>
      <div className="absolute inset-x-0 top-10 z-10 px-4">
        <UnlockPanel feature={feature} title={title} perks={perks} className="mx-auto max-w-xl" />
      </div>
    </div>
  );
}
