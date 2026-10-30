"use client";

import clsx from "clsx";
import { BookOpenCheck, ExternalLink, Landmark, Search, Unlock } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { api, toast } from "@/lib/api";
import { Button, Card } from "../ui";

interface Venue {
  id: string; name: string; type: string; publisher?: string | null; homepage?: string | null; openalex_url: string;
  is_oa?: boolean | null; in_doaj?: boolean | null; apc_usd?: number | null; h_index?: number | null; mean_citedness_2yr?: number | null;
  similar_papers: number; fit: number; examples: { title: string; year?: number; url?: string }[];
}

export function VenueFinder({ title: t0 = "", abstract: a0 = "", auto = false }: { title?: string; abstract?: string; auto?: boolean }) {
  const [title, setTitle] = useState(t0);
  const [abstract, setAbstract] = useState(a0);
  const [kind, setKind] = useState<"any" | "journal" | "conference">("any");
  const [oa, setOa] = useState(false);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ venues: Venue[]; searched?: number; since?: string; note?: string } | null>(null);
  const run = async () => {
    if (title.trim().length < 5) { toast({ title: "Add your paper's title first", tone: "accent" }); return; }
    setBusy(true);
    try { setRes(await api.post("/api/venues/find", { title, abstract, kind, oa_only: oa })); }
    catch (e) { toast({ title: "Venue search failed", body: (e as Error).message, tone: "crit" }); }
    finally { setBusy(false); }
  };
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b-[2.5px] border-edge bg-blue px-5 py-4 text-white">
        <Landmark className="size-7" />
        <div className="flex-1">
          <div className="font-display text-xl font-extrabold">Find the right journal or conference</div>
          <div className="text-xs opacity-85">Ranked by where the most similar recent papers were published (OpenAlex, last 6 years)</div>
        </div>
      </div>
      <div className="space-y-3 p-5">
        {!auto && (
          <>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Paper title"
              className="w-full rounded-xl border-[2.5px] border-edge bg-surface px-3.5 py-2.5 text-sm font-bold outline-none" />
            <textarea value={abstract} onChange={(e) => setAbstract(e.target.value)} rows={3} placeholder="Abstract (optional, improves matching)"
              className="w-full resize-none rounded-xl border-[2.5px] border-edge bg-surface px-3.5 py-2.5 text-sm outline-none" />
          </>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {(["any", "journal", "conference"] as const).map((k) => (
            <button key={k} onClick={() => setKind(k)} className={clsx("rounded-full border-2 border-edge px-3 py-0.5 text-xs font-bold capitalize", kind === k ? "bg-yellow text-[#121212]" : "bg-surface")}>{k === "any" ? "All venues" : `${k}s`}</button>
          ))}
          <label className="ml-1 inline-flex items-center gap-1.5 text-xs font-bold"><input type="checkbox" checked={oa} onChange={(e) => setOa(e.target.checked)} className="accent-[var(--pink)]" />Open access only</label>
          <Button variant="blue" className="ml-auto !py-1.5 text-xs" loading={busy} onClick={run}><Search className="size-3.5" />Find venues</Button>
        </div>
        {res?.note && <p className="text-xs text-muted">{res.note}</p>}
        <div className="grid gap-3 md:grid-cols-2">
          <AnimatePresence>
            {res?.venues.map((v, i) => (
              <motion.div key={v.id} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                className="rounded-2xl border-[2.5px] border-edge bg-surface p-3.5 shadow-[3px_3px_0_var(--shadow-c)]">
                <div className="flex items-start gap-2">
                  <div className="relative grid size-11 shrink-0 place-items-center rounded-full border-2 border-edge font-display text-sm font-extrabold"
                    style={{ background: `conic-gradient(var(--good) ${v.fit * 3.6}deg, var(--surface-3) 0)` }}>
                    <span className="grid size-8 place-items-center rounded-full bg-surface">{v.fit}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <a href={v.homepage || v.openalex_url} target="_blank" rel="noreferrer" className="font-display font-extrabold leading-tight hover:underline">{v.name}<ExternalLink className="ml-1 inline size-3 opacity-50" /></a>
                    <div className="text-[11px] text-muted">{v.publisher || "—"}</div>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1 text-[10px] font-extrabold uppercase">
                  <span className="rounded-full border-2 border-edge bg-surface-2 px-1.5">{v.type}</span>
                  {v.is_oa && <span className="inline-flex items-center gap-0.5 rounded-full border-2 border-edge bg-lime px-1.5 text-[#121212]"><Unlock className="size-2.5" />Open access</span>}
                  {v.in_doaj && <span className="inline-flex items-center gap-0.5 rounded-full border-2 border-edge bg-mint px-1.5 text-[#121212]"><BookOpenCheck className="size-2.5" />DOAJ</span>}
                  {v.apc_usd != null && <span className="rounded-full border-2 border-edge bg-surface-2 px-1.5">APC ${v.apc_usd.toLocaleString()}</span>}
                  {v.h_index != null && <span className="rounded-full border-2 border-edge bg-surface-2 px-1.5">h-index {v.h_index}</span>}
                  {v.mean_citedness_2yr != null && <span className="rounded-full border-2 border-edge bg-surface-2 px-1.5" title="OpenAlex 2-year mean citedness (not the official Impact Factor)">2y cites {v.mean_citedness_2yr}</span>}
                </div>
                <div className="mt-2 text-[11px] text-ink-2"><b>{v.similar_papers}</b> similar recent paper{v.similar_papers === 1 ? "" : "s"} here, e.g.</div>
                {v.examples.slice(0, 2).map((x) => (
                  <a key={x.title} href={x.url} target="_blank" rel="noreferrer" className="block truncate text-[11px] text-muted hover:underline">“{x.title}” ({x.year})</a>
                ))}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {v.homepage && <a href={v.homepage} target="_blank" rel="noreferrer" className="rounded-lg border-2 border-edge bg-surface-2 px-2 py-0.5 text-[10px] font-extrabold hover:bg-yellow hover:text-[#121212]">{v.type === "journal" ? "Author guidelines ↗" : "Website ↗"}</a>}
                  <a href={`http://www.wikicfp.com/cfp/servlet/tool.search?q=${encodeURIComponent(v.name)}&year=t`} target="_blank" rel="noreferrer"
                    className="rounded-lg border-2 border-edge bg-surface-2 px-2 py-0.5 text-[10px] font-extrabold hover:bg-pink hover:text-[#121212]">Call for papers ↗</a>
                  {v.type !== "journal" && <a href="https://cmt3.research.microsoft.com/" target="_blank" rel="noreferrer"
                    className="rounded-lg border-2 border-edge bg-surface-2 px-2 py-0.5 text-[10px] font-extrabold hover:bg-blue hover:text-white">Microsoft CMT ↗</a>}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
        {res && res.venues.length > 0 && <p className="text-[11px] text-muted">Fit = similarity-weighted share of matching papers. Always check the venue&apos;s scope, deadlines and author guidelines; check unfamiliar journals with Think. Check. Submit.</p>}
      </div>
    </Card>
  );
}
