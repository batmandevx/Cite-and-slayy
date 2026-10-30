"use client";

import { History, Loader2, MessageSquareText, Send, Undo2, Wand2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { api, jobEvents, toast } from "@/lib/api";
import type { Job, JobEvent } from "@/lib/types";
import { Card } from "../ui";

const CHIPS = [
  "Make the Proposed Method more detailed with another equation",
  "Add a table comparing the main related approaches",
  "Shorten the abstract to about 150 words",
  "Make the tone more formal and concise",
  "Add a Threats to Validity subsection",
  "Strengthen the introduction's motivation",
];

/** "Tell us what to change": plain-language revisions applied by the agents, with undo and a change history. */
export function ReviseChat({ paperId, history, revisable, onChanged }: {
  paperId: string; history: { at: string; instruction: string }[]; revisable: boolean; onChanged: () => void;
}) {
  const [text, setText] = useState("");
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<{ agent: string; text: string; state: string }[]>([]);
  const es = useRef<EventSource | null>(null);
  useEffect(() => () => es.current?.close(), []);

  const send = async (instruction: string) => {
    if (!instruction.trim() || running) return;
    setRunning(true); setSteps([]);
    try {
      const { job_id } = await api.post<{ job_id: string }>(`/api/paper-studio/${paperId}/revise`, { instruction });
      const src = jobEvents(job_id);
      es.current = src;
      src.onmessage = (m) => {
        const ev = JSON.parse(m.data) as JobEvent;
        try { const d = JSON.parse(ev.message); if (d.agent) setSteps((s) => [...s.filter((x) => x.agent !== d.agent), d]); } catch { /* lifecycle */ }
      };
      src.addEventListener("end", (m) => {
        const job = JSON.parse((m as MessageEvent).data) as Job;
        src.close(); setRunning(false);
        if (job.status === "done") { setText(""); onChanged(); toast({ title: "Paper revised ✨", tone: "good" }); }
        else toast({ title: "Revision failed", body: job.error ?? undefined, tone: "crit" });
      });
    } catch (e) {
      setRunning(false);
      toast({ title: "Couldn't start the revision", body: (e as Error).message, tone: "crit" });
    }
  };
  const undo = async () => {
    try { await api.post(`/api/paper-studio/${paperId}/undo`); onChanged(); toast({ title: "Last change undone", tone: "accent" }); }
    catch (e) { toast({ title: "Nothing to undo", body: (e as Error).message, tone: "crit" }); }
  };

  if (!revisable) return null;
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-3 border-b-[2.5px] border-edge bg-[linear-gradient(120deg,var(--violet),var(--pink))] px-5 py-3.5 text-white">
        <MessageSquareText className="size-6" />
        <div className="flex-1"><div className="font-display text-lg font-extrabold">Want changes? Just say it.</div>
          <div className="text-xs opacity-85">The agents rewrite only the parts that need it, then re-check citations, numbers and equations.</div></div>
        {history.length > 0 && <button onClick={undo} disabled={running} className="inline-flex items-center gap-1 rounded-lg border-2 border-white/60 px-2 py-1 text-xs font-bold"><Undo2 className="size-3.5" />Undo</button>}
      </div>
      <div className="space-y-3 p-4">
        <form onSubmit={(e) => { e.preventDefault(); send(text); }} className="flex gap-2">
          <input value={text} onChange={(e) => setText(e.target.value)} disabled={running}
            placeholder="e.g. “Add a section on ethical considerations” or “use simpler language in the introduction”"
            className="min-w-0 flex-1 rounded-xl border-[2.5px] border-edge bg-surface px-3.5 py-2.5 text-sm shadow-[3px_3px_0_var(--shadow-c)] outline-none" />
          <motion.button whileTap={{ scale: 0.92 }} disabled={running || !text.trim()} className="btn-brut grid place-items-center rounded-xl bg-pink px-4 text-[#121212] disabled:opacity-50">
            {running ? <Loader2 className="size-5 animate-spin" /> : <Send className="size-5" />}
          </motion.button>
        </form>
        <div className="flex flex-wrap gap-1.5">
          {CHIPS.map((c) => (
            <motion.button key={c} whileHover={{ y: -2 }} disabled={running} onClick={() => send(c)}
              className="inline-flex items-center gap-1 rounded-full border-2 border-edge bg-surface px-2.5 py-0.5 text-[11px] font-bold disabled:opacity-50"><Wand2 className="size-3" />{c}</motion.button>
          ))}
        </div>
        <AnimatePresence>
          {running && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="space-y-1 rounded-xl border-2 border-dashed border-line p-3 text-xs">
              {steps.length === 0 && <div className="flex items-center gap-2"><Loader2 className="size-3.5 animate-spin" />Reading your paper…</div>}
              {steps.map((s) => (
                <motion.div key={s.agent} initial={{ x: -10, opacity: 0 }} animate={{ x: 0, opacity: 1 }} className="flex items-center gap-2">
                  {s.state === "done" ? "✅" : <Loader2 className="size-3.5 animate-spin" />}<span>{s.text}</span>
                </motion.div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
        {history.length > 0 && (
          <div className="text-xs text-muted">
            <div className="mb-1 flex items-center gap-1 font-bold"><History className="size-3.5" />Changes so far</div>
            {history.slice().reverse().map((h) => <div key={h.at} className="truncate">• {h.instruction} <span className="opacity-60">({new Date(h.at).toLocaleString()})</span></div>)}
          </div>
        )}
      </div>
    </Card>
  );
}
