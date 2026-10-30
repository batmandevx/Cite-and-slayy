"use client";

import { ArrowDown, ClipboardCopy, Download, Sparkles, Wand2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { api, toast } from "@/lib/api";
import { download } from "@/lib/paperExport";
import { Button } from "./ui";

interface Fix {
  original: string; rewritten: string | null; citation: string; before: number; after: number | null; error?: string;
  source: { title: string; doi?: string | null; url?: string | null };
}
interface Result { paragraphs: Fix[]; phrases: { found: string; use: string; context: string }[]; note: string }

function Sim({ v, label }: { v: number | null; label: string }) {
  const pct = v == null ? 0 : Math.max(0, Math.min(1, v));
  return (
    <div className="flex items-center gap-2 text-[11px] font-bold">
      <span className="w-12 text-muted">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full border border-edge bg-surface-2">
        <motion.div className={pct > 0.8 ? "h-full bg-crit" : pct > 0.6 ? "h-full bg-orange" : "h-full bg-good"} initial={{ width: 0 }} animate={{ width: `${pct * 100}%` }} transition={{ duration: 0.8 }} />
      </div>
      <span className="w-9 tabular-nums">{v == null ? "—" : v.toFixed(2)}</span>
    </div>
  );
}

/** Rewrites possible-overlap paragraphs in original words with a citation to the source, and lists tortured-phrase fixes. */
export function OriginalityFixer({ auditId, count }: { auditId: string; count: number }) {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Result | null>(null);
  const run = async () => {
    setBusy(true);
    try { setRes(await api.post<Result>(`/api/citeguard/audits/${auditId}/fix`)); }
    catch (e) { toast({ title: "Couldn't run the fixer", body: (e as Error).message, tone: "crit" }); }
    finally { setBusy(false); }
  };
  const md = res ? [
    "# Originality fixes", res.note,
    ...res.paragraphs.filter((p) => p.rewritten).map((p, i) => `## Fix ${i + 1}\n\n**Original:**\n\n${p.original}\n\n**Suggested rewrite:**\n\n${p.rewritten}\n\nSource: ${p.source.title}`),
    ...(res.phrases.length ? ["## Tortured phrases", ...res.phrases.map((p) => `- “${p.found}” → **${p.use}**`)] : []),
  ].join("\n\n") : "";
  return (
    <div className="overflow-hidden rounded-2xl border-[2.5px] border-edge bg-surface shadow-[4px_4px_0_var(--shadow-c)]">
      <div className="flex flex-wrap items-center gap-3 bg-[linear-gradient(120deg,var(--violet),var(--pink))] px-4 py-3 text-white">
        <Wand2 className="size-6" />
        <div className="flex-1">
          <div className="font-display text-lg font-extrabold">Originality fixer</div>
          <div className="text-xs opacity-90">Rewrites each flagged passage in your own words and adds a citation to the source it resembles.</div>
        </div>
        <Button variant="lime" loading={busy} disabled={count === 0} onClick={run}><Sparkles className="size-4" />{res ? "Run again" : `Fix ${count} passage${count === 1 ? "" : "s"}`}</Button>
      </div>
      <AnimatePresence>
        {res && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="space-y-3 p-4">
            <div className="flex items-center justify-between text-xs text-muted">
              <span>{res.note}</span>
              <Button className="!px-2.5 !py-1 text-xs" onClick={() => download(new Blob([md], { type: "text/markdown" }), "originality-fixes.md")}><Download className="size-3.5" />Download</Button>
            </div>
            {res.paragraphs.map((p, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }}
                className="rounded-xl border-2 border-edge bg-surface-2 p-3">
                <div className="text-[10px] font-extrabold uppercase tracking-wider text-muted">Original</div>
                <p className="mt-0.5 text-sm text-ink-2 line-through decoration-crit/40">{p.original}</p>
                <div className="my-1.5 flex justify-center"><ArrowDown className="size-4 text-pink" /></div>
                {p.rewritten ? (
                  <>
                    <div className="flex items-center justify-between text-[10px] font-extrabold uppercase tracking-wider text-good-ink">Suggested rewrite
                      <button onClick={() => { navigator.clipboard.writeText(p.rewritten!); toast({ title: "Rewrite copied", tone: "good" }); }} className="inline-flex items-center gap-1 normal-case tracking-normal text-ink-2 hover:text-ink"><ClipboardCopy className="size-3.5" />Copy</button>
                    </div>
                    <p className="mt-0.5 rounded-lg border-2 border-good/40 bg-good-soft p-2 text-sm text-ink">{p.rewritten}</p>
                    <div className="mt-2 space-y-1">
                      <Sim v={p.before} label="Before" />
                      <Sim v={p.after} label="After" />
                    </div>
                    <div className="mt-1 text-[11px] text-muted">Shared wording with the closest sentence in “{p.source.title}”. Cites {p.citation}.</div>
                  </>
                ) : <p className="text-sm text-crit-ink">Couldn&apos;t rewrite this one: {p.error}</p>}
              </motion.div>
            ))}
            {res.phrases.length > 0 && (
              <div className="rounded-xl border-2 border-edge p-3">
                <div className="mb-1 font-display text-sm font-extrabold">Tortured phrases to replace</div>
                {res.phrases.map((p, i) => (
                  <div key={i} className="text-sm">“<span className="text-crit-ink">{p.found}</span>” → <b className="text-good-ink">{p.use}</b></div>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
