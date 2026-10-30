"use client";

import { Check, FileText } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";

/** Illustration of the Paper Studio flow: agents fill a paper page section by section, then it's ready to export. */
const STEPS = [
  { agent: "🔭 Scout", text: "Finding & vetting real papers", sec: "References", lines: 3 },
  { agent: "📐 Architect", text: "Designing your method", sec: "Introduction", lines: 4 },
  { agent: "🧮 Method writer", text: "Equations + architecture", sec: "Proposed Method", lines: 3, eq: true },
  { agent: "📊 Analyst", text: "Charts from real data", sec: "Results", lines: 2, chart: true },
  { agent: "🛡️ Verifier", text: "Checking every citation", sec: "Discussion", lines: 3 },
];

export function PaperBuilder() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN((x) => (x + 1) % (STEPS.length + 3)), 1300);
    return () => clearInterval(t);
  }, []);
  const done = n >= STEPS.length;
  const cur = STEPS[Math.min(n, STEPS.length - 1)];
  return (
    <div className="relative">
      <div className="card relative mx-auto max-w-[460px] rotate-1 overflow-hidden bg-white p-0 text-[#121212]">
        <div className="flex items-center gap-2 border-b-[2.5px] border-[#121212] bg-[#fff5e6] px-4 py-2.5">
          <span className="size-3 rounded-full border-2 border-[#121212] bg-[#ff4fa3]" /><span className="size-3 rounded-full border-2 border-[#121212] bg-[#ffd23f]" />
          <span className="size-3 rounded-full border-2 border-[#121212] bg-[#c6f24e]" />
          <span className="ml-2 font-display text-xs font-extrabold">your-paper.tex · IEEE</span>
          <span className="ml-auto font-mono text-[11px] font-bold">{done ? "100%" : `${Math.round((n / STEPS.length) * 100)}%`}</span>
        </div>
        <div className="h-1.5 bg-[#eee]"><motion.div className="h-full bg-[linear-gradient(90deg,#ff4fa3,#ffd23f,#c6f24e)]" animate={{ width: done ? "100%" : `${(n / STEPS.length) * 100}%` }} /></div>
        <div className="space-y-3 px-6 py-5 font-serif">
          <div className="text-center text-[17px] font-bold leading-snug">Adaptive Spatio-Temporal Graph Learning for Traffic Forecasting</div>
          <div className="text-center text-[11px] italic text-[#666]">You · Your University</div>
          {STEPS.map((s, i) => (
            <AnimatePresence key={s.sec}>
              {i < Math.max(n, done ? STEPS.length : 0) + (done ? 0 : 1) && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                  <div className="text-[11px] font-bold uppercase tracking-wider">{s.sec}</div>
                  {s.eq && i < n && <div className="my-1 text-center font-serif text-sm italic">ℒ(θ) = ½ Σ ‖ŷᵢ − yᵢ‖² + λ‖θ‖²</div>}
                  {s.chart && i < n && (
                    <div className="my-1 flex h-10 items-end gap-1 px-6">
                      {[3, 5, 4, 7, 9, 12, 16].map((h, k) => (
                        <motion.span key={k} className="flex-1 rounded-t bg-[#2a6fdb]" initial={{ height: 0 }} animate={{ height: h * 2.4 }} transition={{ delay: k * 0.05 }} />
                      ))}
                    </div>
                  )}
                  {Array.from({ length: s.lines }, (_, k) => (
                    <motion.div key={k} className="mt-1 h-1.5 rounded bg-[#ddd]" initial={{ width: 0 }}
                      animate={{ width: i === n && !done ? `${55 + ((k * 37) % 40)}%` : `${80 + ((k * 13) % 20)}%` }} transition={{ duration: 0.9, delay: k * 0.12 }} />
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          ))}
        </div>
      </div>
      <AnimatePresence mode="wait">
        {!done ? (
          <motion.div key={cur.agent} initial={{ opacity: 0, x: -20, scale: 0.9 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, x: 20 }}
            className="sticker absolute -left-4 top-24 z-10 bg-yellow text-[#121212] shadow-[4px_4px_0_#121212]">
            <span>{cur.agent}</span><span className="font-semibold opacity-75">· {cur.text}</span>
            <span className="typing-dots ml-1"><i /><i /><i /></span>
          </motion.div>
        ) : (
          <motion.div key="done" initial={{ scale: 0, rotate: -10 }} animate={{ scale: 1, rotate: -4 }} exit={{ scale: 0 }}
            className="absolute -right-3 top-20 z-10 flex flex-col gap-1.5">
            {["LaTeX", "PDF", "Word"].map((f, i) => (
              <motion.span key={f} initial={{ x: 30, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: i * 0.12 }}
                className="sticker bg-lime text-[#121212]"><FileText className="size-4" />{f} ready</motion.span>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
      <motion.div className="sticker absolute -bottom-4 right-8 z-10 bg-pink text-[#121212]" animate={{ y: [0, -6, 0] }} transition={{ repeat: Infinity, duration: 3 }}>
        <Check className="size-4" strokeWidth={3} />Every reference real & linked
      </motion.div>
    </div>
  );
}
