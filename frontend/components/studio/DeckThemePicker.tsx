"use client";

import clsx from "clsx";
import { Check, ChevronDown, Download, ExternalLink, LayoutTemplate, Loader2, Palette, Search, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "@/lib/api";
import { DECK_THEMES, type DeckTheme } from "@/lib/deck";
import { toast } from "@/lib/api";

interface Tpl { slug: string; title: string; category: string; category_name: string; slide_count: number; url: string; pptx_url: string; cover: string; tags: string[] }
interface Catalog { items: Tpl[]; total: number; categories: Record<string, string>; credit: string; license_url: string }

/** Built-in slide themes for the generated deck, plus a gallery of free CC BY templates. */
/** `value` is a built-in theme id or a palette taken from a catalog design. */
export function DeckThemePicker({ value, onChange }: { value: string | DeckTheme; onChange: (t: string | DeckTheme) => void }) {
  const current = typeof value === "object" ? value : DECK_THEMES.find((x) => x.id === value) ?? DECK_THEMES[0];
  const [open, setOpen] = useState(false);
  const [gallery, setGallery] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const toggle = (e: React.MouseEvent<HTMLButtonElement>) => {
    // the menu is rendered at the document root (fixed), so cards with overflow-hidden can't clip it
    const r = e.currentTarget.getBoundingClientRect();
    setPos({ top: r.bottom + 8, left: Math.max(8, Math.min(r.left, window.innerWidth - 348)) });
    setOpen(!open);
  };
  return (
    <div className="relative">
      <button type="button" onClick={toggle} title="Slide theme" aria-expanded={open}
        className="btn-brut inline-flex h-full items-center gap-1 rounded-l-none rounded-r-xl border-l-0 bg-lime px-2 text-[#121212]">
        <span className="flex -space-x-1">{[current.ink, current.accent, current.amber].map((c, i) => <span key={i} className="size-3 rounded-full border border-edge" style={{ background: `#${c}` }} />)}</span>
        <ChevronDown className="size-3.5" />
      </button>
      {typeof document !== "undefined" && createPortal(<AnimatePresence>
        {open && pos && (
          <>
            <div className="fixed inset-0 z-[65]" onClick={() => setOpen(false)} />
            <motion.div initial={{ opacity: 0, y: -6, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6 }}
              style={{ top: pos.top, left: pos.left }}
              className="fixed z-[66] max-h-[70vh] w-[340px] overflow-y-auto rounded-2xl border-[2.5px] border-edge bg-surface p-3 shadow-[5px_5px_0_var(--shadow-c)]">
              <div className="mb-2 font-display text-sm font-extrabold">Slide theme</div>
              <div className="grid grid-cols-2 gap-2">
                {DECK_THEMES.map((t) => (
                  <button key={t.id} type="button" onClick={() => { onChange(t.id); setOpen(false); }}
                    className={clsx("relative overflow-hidden rounded-xl border-2 text-left transition hover:-translate-y-0.5", current.id === t.id ? "border-edge shadow-[3px_3px_0_var(--shadow-c)]" : "border-line")}>
                    <div className="flex h-12 items-end gap-1 p-2" style={{ background: `#${t.ink}` }}>
                      <span className="h-1.5 w-8 rounded-full" style={{ background: `#${t.accent}` }} />
                      <span className="h-1.5 w-4 rounded-full" style={{ background: `#${t.amber}` }} />
                      <span className="h-1.5 w-3 rounded-full" style={{ background: `#${t.teal}` }} />
                    </div>
                    <div className="bg-white px-2 py-1.5 text-[#121212]">
                      <div className="text-xs font-extrabold" style={{ fontFamily: t.head }}>{t.name}</div>
                      <div className="truncate text-[10px] text-[#555]">{t.blurb}</div>
                    </div>
                    {current.id === t.id && <Check className="absolute right-1.5 top-1.5 size-4 rounded-full bg-white p-0.5 text-[#121212]" />}
                  </button>
                ))}
              </div>
              {typeof value === "object" && (
                <div className="mt-2 flex items-center gap-2 rounded-xl border-2 border-edge bg-surface-2 px-2 py-1.5 text-[11px]">
                  <Palette className="size-4 text-pink" /><span className="min-w-0 flex-1 truncate"><b>Design colours:</b> {value.name}</span><Check className="size-3.5" />
                </div>
              )}
              <button type="button" onClick={() => { setGallery(true); setOpen(false); }}
                className="mt-3 flex w-full items-center gap-2 rounded-xl border-2 border-dashed border-edge px-3 py-2 text-left text-xs font-bold hover:bg-surface-2">
                <LayoutTemplate className="size-4 text-pink" /><span className="flex-1">Browse 530+ free designer templates</span><ExternalLink className="size-3.5" />
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>, document.body)}
      <AnimatePresence>{gallery && <TemplateGallery onClose={() => setGallery(false)} onUse={(t) => { onChange(t); setGallery(false); }} />}</AnimatePresence>
    </div>
  );
}

function TemplateGallery({ onClose, onUse }: { onClose: () => void; onUse: (t: DeckTheme) => void }) {
  const [using, setUsing] = useState<string | null>(null);
  const use = async (slug: string) => {
    setUsing(slug);
    try { const t = await api.get<DeckTheme>(`/api/deck-templates/${slug}/palette`); onUse(t); toast({ title: "Slide colours applied", body: `Your next deck uses the palette of “${t.name}”.`, tone: "good" }); }
    catch (e) { toast({ title: "Couldn't use that design", body: (e as Error).message, tone: "crit" }); }
    finally { setUsing(null); }
  };
  const [cat, setCat] = useState("thesis-defense");
  const [q, setQ] = useState("");
  const [data, setData] = useState<Catalog | null>(null);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      api.get<Catalog>(`/api/deck-templates?category=${encodeURIComponent(cat)}&q=${encodeURIComponent(q)}&limit=60`).then((d) => alive && setData(d)).catch(() => alive && setData(null));
    }, 200);
    return () => { alive = false; clearTimeout(t); };
  }, [cat, q]);
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}
      className="fixed inset-0 z-[70] grid place-items-center bg-black/50 p-4 backdrop-blur-sm">
      <motion.div initial={{ y: 30, scale: 0.96 }} animate={{ y: 0, scale: 1 }} exit={{ y: 30, scale: 0.96 }} onClick={(e) => e.stopPropagation()}
        className="card flex max-h-[88vh] w-full max-w-6xl flex-col overflow-hidden">
        <div className="flex shrink-0 flex-wrap items-center gap-3 border-b-[2.5px] border-edge bg-surface-2 px-5 py-3">
          <LayoutTemplate className="size-6 text-pink" />
          <div className="flex-1">
            <div className="font-display text-xl font-extrabold">Presentation templates</div>
            <div className="text-xs text-muted">Pick a design and your generated deck uses its colours. Its .pptx files are picture slides, so download one for inspiration or cover art. {data?.total ?? "…"} templates in this category.</div>
          </div>
          <label className="flex items-center gap-2 rounded-xl border-2 border-edge bg-surface px-2.5 py-1.5">
            <Search className="size-4 text-muted" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search templates" className="w-40 bg-transparent text-sm outline-none" />
          </label>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-surface" aria-label="Close"><X className="size-5" /></button>
        </div>
        <div className="flex shrink-0 gap-1.5 overflow-x-auto border-b-2 border-dashed border-line px-5 py-2.5">
          {Object.entries(data?.categories ?? { "thesis-defense": "Thesis & Academic" }).map(([k, v]) => (
            <button key={k} onClick={() => setCat(k)} className={clsx("shrink-0 whitespace-nowrap rounded-full border-2 px-3 py-1 text-xs font-bold", cat === k ? "border-edge bg-yellow text-[#121212]" : "border-line hover:border-edge")}>{v}</button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid grid-cols-1 content-start gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
          {data === null ? Array.from({ length: 6 }, (_, i) => <div key={i} className="shimmer aspect-video rounded-xl" />) : data.items.length === 0 ? (
            <p className="col-span-full py-10 text-center text-sm text-muted">No templates match.</p>
          ) : data.items.map((t, i) => (
            <motion.div key={t.slug} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 12) * 0.03 }}
              className="group overflow-hidden rounded-xl border-2 border-edge bg-surface shadow-[3px_3px_0_var(--shadow-c)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={t.cover} alt={t.title} loading="lazy" className="aspect-video w-full border-b-2 border-edge object-cover transition group-hover:scale-[1.02]" />
              <div className="p-3">
                <div className="line-clamp-2 text-sm font-bold">{t.title}</div>
                <div className="mt-1 flex flex-wrap gap-1">{t.tags.slice(0, 3).map((g) => <span key={g} className="rounded-full bg-surface-2 px-1.5 text-[10px] font-semibold">{g}</span>)}</div>
                <div className="mt-2 flex gap-1.5">
                  <button type="button" onClick={() => use(t.slug)} disabled={!!using} className="inline-flex items-center gap-1 rounded-lg border-2 border-edge bg-pink px-2 py-0.5 text-xs font-bold text-[#121212] disabled:opacity-50">
                    {using === t.slug ? <Loader2 className="size-3.5 animate-spin" /> : <Palette className="size-3.5" />}Use colours</button>
                  <a href={t.pptx_url} className="inline-flex items-center gap-1 rounded-lg border-2 border-edge bg-lime px-2 py-0.5 text-xs font-bold text-[#121212]"><Download className="size-3.5" />.pptx</a>
                  <a href={t.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border-2 border-edge px-2 py-0.5 text-xs font-bold"><ExternalLink className="size-3.5" />Preview</a>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
        </div>
        <div className="shrink-0 border-t-2 border-dashed border-line px-5 py-2 text-[11px] text-muted">
          {data?.credit ?? "Templates by ppttemplate.ai (CC BY 4.0)"} · <a className="underline" href={data?.license_url ?? "https://creativecommons.org/licenses/by/4.0/"} target="_blank" rel="noreferrer">license</a>. Credit the source if you share a deck built on one publicly.
        </div>
      </motion.div>
    </motion.div>
  );
}
