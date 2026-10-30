"use client";

import clsx from "clsx";
import { Loader2, Sparkles } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { api, toast } from "@/lib/api";

export type AssistAction = "expand" | "summarize" | "improve" | "continue" | "outline" | "explain" | "ideas";
export interface AssistResult { text?: string; items?: string[]; order?: number[]; reason?: string }

const LABELS: Record<AssistAction, [string, string]> = {
  expand: ["🪄", "Expand into a plan"],
  summarize: ["📝", "Summarise"],
  improve: ["✨", "Improve writing"],
  continue: ["➡️", "Continue writing"],
  outline: ["🗂️", "Make an outline"],
  explain: ["💡", "Explain simply"],
  ideas: ["🧠", "Brainstorm ideas"],
};

export async function assist(action: string, text: string, context = ""): Promise<AssistResult | null> {
  try {
    return await api.post<AssistResult>("/api/assist", { action, text, context });
  } catch (e) {
    toast({ title: "Azora AI couldn't help this time", body: (e as Error).message, tone: "crit" });
    return null;
  }
}

/** A small “✨ AI” dropdown. `getText` is read when an action is picked; `onResult` receives the AI text. */
export function AssistMenu({ actions, getText, onResult, className, compact, dark }: {
  actions: AssistAction[]; getText: () => string; onResult: (text: string, action: AssistAction) => void;
  className?: string; compact?: boolean; dark?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<AssistAction | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);
  const run = async (a: AssistAction) => {
    const text = getText().trim();
    if (!text) { toast({ title: "Write something first", body: "Azora AI needs a few words to work with.", tone: "accent" }); return; }
    setBusy(a); setOpen(false);
    const r = await assist(a, text);
    setBusy(null);
    if (r?.text) onResult(r.text, a);
  };
  return (
    <div ref={ref} className={clsx("relative", className)} onPointerDown={(e) => e.stopPropagation()}>
      <motion.button whileTap={{ scale: 0.9 }} whileHover={{ y: -1 }} onClick={() => setOpen((o) => !o)} disabled={!!busy}
        className={clsx("inline-flex items-center gap-1 rounded-lg border-2 font-bold",
          compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-1 text-[11px]",
          dark ? "border-[#121212] bg-white/80 text-[#121212]" : "border-edge bg-[linear-gradient(120deg,var(--violet),var(--pink))] text-white")}>
        {busy ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}{busy ? "Thinking…" : "AI"}
      </motion.button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -6, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.95 }}
            className="absolute right-0 top-full z-50 mt-1 w-48 overflow-hidden rounded-xl border-[2.5px] border-edge bg-surface text-ink shadow-[4px_4px_0_var(--shadow-c)]">
            <div className="border-b-2 border-edge bg-surface-2 px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-widest text-muted">Azora AI</div>
            {actions.map((a) => (
              <button key={a} onClick={() => run(a)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs font-semibold hover:bg-yellow hover:text-[#121212]">
                <span>{LABELS[a][0]}</span>{LABELS[a][1]}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
