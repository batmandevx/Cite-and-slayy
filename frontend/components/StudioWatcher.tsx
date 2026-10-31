"use client";

import { Loader2, PartyPopper } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { api, toast } from "@/lib/api";
import type { Job } from "@/lib/types";

/** While a Paper Studio job runs and the user is elsewhere (e.g. playing a game), show its progress and announce completion. */
export function StudioWatcher({ active, onOpen }: { active: boolean; onOpen: () => void }) {
  const [job, setJob] = useState<Job | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (active) return;
    let stop = false;
    const poll = async () => {
      let id: string | null = null;
      try { id = JSON.parse(localStorage.getItem("slayy:studioJob") ?? "null"); } catch { id = null; }
      if (!id) { setJob(null); return; }
      try {
        const j = await api.get<Job>(`/api/jobs/${id}`);
        if (stop) return;
        setJob(j);
        if (j.status === "done") {
          setReady(true);
          toast({ title: "Your paper is ready 🎉", body: "Open Paper Studio to read and download it.", tone: "good" });
        } else if (j.status === "error") {
          toast({ title: "Paper generation failed", body: j.error ?? undefined, tone: "crit" });
          localStorage.removeItem("slayy:studioJob");
          setJob(null);
        }
      } catch {
        setJob(null);
      }
    };
    poll();
    const t = setInterval(() => { if (!ready) poll(); }, 4000);
    return () => { stop = true; clearInterval(t); };
  }, [active, ready]);
  const show = !active && job && (job.status === "running" || job.status === "queued" || ready);
  return (
    <AnimatePresence>
      {show && (
        <motion.button initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }}
          onClick={() => { setReady(false); onOpen(); }}
          className="btn-brut fixed bottom-[88px] left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full bg-ink px-4 py-2.5 text-sm font-bold text-bg lg:bottom-6">
          {ready ? <PartyPopper className="size-4 text-yellow" /> : <Loader2 className="size-4 animate-spin" />}
          {ready ? "Your paper is ready! Open it" : `Writing your paper… ${Math.round((job?.progress ?? 0) * 100)}%`}
          {!ready && <span className="h-1.5 w-20 overflow-hidden rounded-full bg-bg/30"><motion.span className="block h-full bg-lime" animate={{ width: `${(job?.progress ?? 0) * 100}%` }} /></span>}
        </motion.button>
      )}
    </AnimatePresence>
  );
}
