"use client";

import clsx from "clsx";
import { CheckCircle2, Info, OctagonX, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import type { ToastMsg } from "@/lib/api";

interface Item extends ToastMsg { id: number }

export function Toaster() {
  const [items, setItems] = useState<Item[]>([]);
  useEffect(() => {
    let n = 0;
    const onToast = (e: Event) => {
      const id = ++n;
      setItems((xs) => [...xs.slice(-3), { ...(e as CustomEvent<ToastMsg>).detail, id }]);
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 5200);
    };
    window.addEventListener("slayy:toast", onToast);
    return () => window.removeEventListener("slayy:toast", onToast);
  }, []);
  return (
    <div className="pointer-events-none fixed bottom-[88px] right-3 z-[60] sm:right-5 lg:bottom-5 flex w-[min(380px,calc(100vw-2.5rem))] flex-col gap-2" aria-live="polite">
      <AnimatePresence initial={false}>
        {items.map((t) => (
          <motion.div key={t.id} layout initial={{ opacity: 0, y: 20, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40, scale: 0.95 }} transition={{ type: "spring", stiffness: 380, damping: 30 }}
            className="card pointer-events-auto flex items-start gap-3 p-3.5 pr-2.5">
            <span className={clsx("mt-0.5 grid size-7 shrink-0 place-items-center rounded-full text-white",
              t.tone === "good" ? "bg-good" : t.tone === "crit" ? "bg-crit" : "bg-accent")}>
              {t.tone === "good" ? <CheckCircle2 className="size-4" /> : t.tone === "crit" ? <OctagonX className="size-4" /> : <Info className="size-4" />}
            </span>
            <div className="min-w-0 flex-1 text-sm">
              <div className="font-semibold">{t.title}</div>
              {t.body && <div className="mt-0.5 line-clamp-3 text-ink-2">{t.body}</div>}
            </div>
            <button aria-label="Dismiss" onClick={() => setItems((xs) => xs.filter((x) => x.id !== t.id))} className="rounded p-1 text-muted hover:text-ink">
              <X className="size-3.5" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
