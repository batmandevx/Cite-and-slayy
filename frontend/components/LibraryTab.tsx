"use client";

import clsx from "clsx";
import { BookOpen, Download, ExternalLink, Flame, Lightbulb, Search, Sparkles, Zap } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { api, toast } from "@/lib/api";
import { ExternalSearch } from "./ExternalSearch";
import { Button, Card, Callout } from "./ui";

interface LibPaper {
  id: string; title: string; year?: number; date?: string; venue?: string | null; cited_by?: number;
  authors: string[]; abstract: string; read_url?: string | null; pdf_url?: string | null; is_oa: boolean;
}
interface Book { title: string; authors: string[]; year?: number; read_url: string; openlibrary_url: string; cover?: string | null; download_url?: string | null; source?: string }
interface Idea { title: string; pitch: string; method: string; evidence: { title: string; url?: string | null }[] }

type Col = "trending" | "latest" | "books";


const QUICK = ["large language models", "retrieval augmented generation", "diffusion models", "graph neural networks", "federated learning", "climate machine learning"];

function PaperCard({ p, i }: { p: LibPaper; i: number }) {
  return (
    <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: (i % 24) * 0.03 }}
      whileHover={{ y: -4, rotate: i % 2 ? 0.4 : -0.4 }}
      className="card flex flex-col p-4">
      <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[11px] font-bold">
        {p.venue && <span className="max-w-[60%] truncate rounded-full border-2 border-edge bg-surface-2 px-2">{p.venue}</span>}
        {p.date && <span className="text-muted">{p.date}</span>}
        {typeof p.cited_by === "number" && p.cited_by > 0 && (
          <span className="ml-auto inline-flex items-center gap-0.5 rounded-full border-2 border-edge bg-orange px-2 text-[#121212]"><Flame className="size-3" />{p.cited_by.toLocaleString()}</span>
        )}
      </div>
      <a href={p.read_url ?? undefined} target="_blank" rel="noreferrer" className="font-display text-[15px] font-extrabold leading-snug hover:underline">{p.title}</a>
      <div className="mt-1 text-xs text-muted">{p.authors.join(", ")}{p.authors.length >= 3 && " et al."}</div>
      <p className="mt-2 line-clamp-3 text-[13px] text-ink-2">{p.abstract}</p>
      <div className="mt-auto flex gap-2 pt-3">
        {p.read_url && <a href={p.read_url} target="_blank" rel="noreferrer" className="btn-brut inline-flex items-center gap-1 rounded-lg bg-surface px-2.5 py-1 text-xs font-bold"><BookOpen className="size-3.5" />Read</a>}
        {p.pdf_url ? (
          <a href={p.pdf_url} target="_blank" rel="noreferrer" className="btn-brut inline-flex items-center gap-1 rounded-lg bg-lime px-2.5 py-1 text-xs font-bold text-[#121212]"><Download className="size-3.5" />Free PDF</a>
        ) : (
          <span className="inline-flex items-center rounded-lg border-2 border-dashed border-line px-2.5 py-1 text-[11px] text-muted" title="No legal open-access copy found. Try Unpaywall or your library.">No open PDF</span>
        )}
      </div>
    </motion.div>
  );
}

export function LibraryTab() {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("large language models");
  const [col, setCol] = useState<Col>("trending");
  const [data, setData] = useState<Record<string, LibPaper[] | Book[]>>({});
  const [pages, setPages] = useState<Record<string, number>>({});
  const [more, setMore] = useState(false);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const key = `${col}|${query}`;
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [ideasBusy, setIdeasBusy] = useState(false);

  useEffect(() => {
    if (data[key]) return;
    api.get<LibPaper[] | Book[]>(`/api/library/${col}?query=${encodeURIComponent(col === "books" && query === "large language models" ? "artificial intelligence" : query)}`)
      .then((r) => setData((d) => ({ ...d, [key]: r })))
      .catch((e: Error) => { setErrs((x) => ({ ...x, [key]: e.message })); setData((d) => ({ ...d, [key]: [] })); });
  }, [col, query, key, data]);

  const qsFor = () => encodeURIComponent(col === "books" && query === "large language models" ? "artificial intelligence" : query);
  const loadMore = async () => {
    const next = (pages[key] ?? 1) + 1;
    setMore(true);
    try {
      const r = await api.get<(LibPaper | Book)[]>(`/api/library/${col}?query=${qsFor()}&page=${next}`);
      const seen = new Set((data[key] ?? []).map((x) => ("id" in x ? x.id : x.read_url)));
      const fresh = r.filter((x) => !seen.has("id" in x ? x.id : x.read_url));
      setData((d) => ({ ...d, [key]: [...(d[key] ?? []), ...fresh] as LibPaper[] | Book[] }));
      setPages((p) => ({ ...p, [key]: next }));
      if (!fresh.length) toast({ title: "That's everything for this search", tone: "accent" });
    } catch (e) {
      toast({ title: "Couldn't load more", body: (e as Error).message, tone: "crit" });
    } finally { setMore(false); }
  };

  const genIdeas = () => {
    setIdeasBusy(true); setIdeas(null);
    api.post<{ ideas: Idea[] }>("/api/library/ideas", { query })
      .then((r) => { setIdeas(r.ideas); if (!r.ideas.length) toast({ title: "No grounded ideas this time", body: "Try a more specific field.", tone: "accent" }); })
      .catch((e: Error) => toast({ title: "Couldn't generate ideas", body: e.message, tone: "crit" }))
      .finally(() => setIdeasBusy(false));
  };

  const cols = [
    { id: "trending", label: "Trending", sub: "most-cited, past 12 months · OpenAlex", icon: Flame, color: "bg-orange" },
    { id: "latest", label: "Latest", sub: "newest preprints · arXiv", icon: Zap, color: "bg-blue" },
    { id: "books", label: "Open books", sub: "public full text · Open Library", icon: BookOpen, color: "bg-violet" },
  ] as const;
  const items = data[key] ?? null;
  const err = errs[key];

  return (
    <div className="space-y-8">
      {/* search */}
      <Card pop className="relative overflow-hidden p-6">
        <div className="pointer-events-none absolute -right-10 -top-10 size-48 rounded-full bg-yellow opacity-60 blur-2xl" />
        <div className="relative">
          <h2 className="font-display text-3xl font-extrabold">The Library <span className="inline-block wobble">📚</span></h2>
          <p className="mt-1 text-sm text-ink-2">Real papers from OpenAlex and arXiv, and free books. Downloads only link to legal open-access copies.</p>
          <form onSubmit={(e) => { e.preventDefault(); if (q.trim()) { setQuery(q.trim()); setIdeas(null); } }} className="mt-4 flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a field, e.g. “protein folding”"
                className="w-full rounded-xl border-[2.5px] border-edge bg-surface py-2.5 pl-9 pr-3 text-sm shadow-[3px_3px_0_var(--shadow-c)] outline-none" />
            </div>
            <Button variant="primary" type="submit">Search</Button>
          </form>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {QUICK.map((t) => (
              <button key={t} onClick={() => { setQ(t); setQuery(t); setIdeas(null); }}
                className={clsx("rounded-full border-2 border-edge px-2.5 py-0.5 text-xs font-bold transition hover:-translate-y-0.5", query === t ? "bg-lime text-[#121212]" : "bg-surface")}>{t}</button>
            ))}
          </div>
          <ExternalSearch query={query} className="mt-4" />
        </div>
      </Card>

      {/* columns */}
      <section>
        <div className="mb-4 flex flex-wrap gap-2">
          {cols.map((c) => (
            <motion.button key={c.id} whileTap={{ scale: 0.95 }} onClick={() => setCol(c.id)}
              className={clsx("btn-brut flex items-center gap-2 rounded-2xl px-4 py-2 text-left", col === c.id ? `${c.color} ${c.id === "latest" ? "text-white" : "text-[#121212]"}` : "bg-surface")}>
              <c.icon className="size-5" />
              <span><span className="block font-display font-extrabold leading-tight">{c.label}</span><span className="block text-[10px] font-bold opacity-75">{c.sub}</span></span>
            </motion.button>
          ))}
          <span className="ml-auto self-center text-xs font-bold text-muted">Showing: “{query}”</span>
        </div>
        {err && <Callout tone="crit" title="Source unavailable">{err}. Nothing is shown rather than made up.</Callout>}
        {items === null ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <div key={i} className="shimmer h-56 rounded-2xl" />)}</div>
        ) : col === "books" ? (
          <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {(items as Book[]).map((b, i) => (
              <motion.a key={b.read_url} href={b.read_url} target="_blank" rel="noreferrer"
                initial={{ opacity: 0, y: 20, rotate: -3 }} animate={{ opacity: 1, y: 0, rotate: 0 }} transition={{ delay: (i % 24) * 0.03 }}
                whileHover={{ y: -8, rotate: i % 2 ? 2 : -2 }} className="group block">
                <div className="aspect-[2/3] overflow-hidden rounded-lg border-[2.5px] border-edge bg-violet shadow-[5px_5px_0_var(--shadow-c)]">
                  {b.cover ? <img src={b.cover} alt="" loading="lazy" className="size-full object-cover" /> : (
                    <div className="grid size-full place-items-center p-3 text-center font-display text-sm font-extrabold text-[#121212]">{b.title}</div>
                  )}
                </div>
                <div className="mt-2 line-clamp-2 text-sm font-bold leading-tight group-hover:underline">{b.title}</div>
                <div className="text-[11px] text-muted">{b.authors.join(", ")}{b.year ? ` · ${b.year}` : ""}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {b.source && <span className={clsx("rounded-full border border-edge px-1.5 text-[9px] font-extrabold uppercase", b.source === "Project Gutenberg" ? "bg-yellow text-[#121212]" : "bg-mint text-[#121212]")}>{b.source}</span>}
                  {b.download_url && <span onClick={(e) => { e.preventDefault(); window.open(b.download_url!, "_blank"); }}
                    className="rounded-full border border-edge bg-lime px-1.5 text-[9px] font-extrabold uppercase text-[#121212]">Download</span>}
                </div>
              </motion.a>
            ))}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {(items as LibPaper[]).map((p, i) => <PaperCard key={p.id} p={p} i={i} />)}
          </div>
        )}
        {items && items.length === 0 && !err && <p className="py-10 text-center text-sm text-muted">No results for “{query}”.</p>}
        {items && items.length > 0 && (
          <div className="mt-6 flex justify-center">
            <motion.button whileHover={{ y: -3 }} whileTap={{ scale: 0.95 }} onClick={loadMore} disabled={more}
              className="btn-brut inline-flex items-center gap-2 rounded-2xl bg-surface px-6 py-3 font-display font-extrabold disabled:opacity-60">
              {more ? "Loading…" : `Load more · ${items.length} shown`}
            </motion.button>
          </div>
        )}
      </section>

      {/* ideas */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b-[2.5px] border-edge bg-yellow px-5 py-4 text-[#121212]">
          <Lightbulb className="size-7 floaty" />
          <div className="flex-1">
            <div className="font-display text-xl font-extrabold">Research idea generator</div>
            <div className="text-xs font-semibold opacity-80">Ideas for “{query}”, grounded in real highly-cited recent papers. Each idea links its evidence.</div>
          </div>
          <Button variant="primary" loading={ideasBusy} onClick={genIdeas}><Sparkles className="size-4" />{ideas ? "Regenerate" : "Generate ideas"}</Button>
        </div>
        <div className="p-5">
          {ideasBusy && <div className="grid gap-4 md:grid-cols-2">{Array.from({ length: 4 }, (_, i) => <div key={i} className="shimmer h-40 rounded-2xl" />)}</div>}
          {!ideasBusy && !ideas && <p className="py-6 text-center text-sm text-muted">Press the button: the AI reads 15 recent highly-cited papers and pitches 4 starter projects.</p>}
          <div className="grid gap-4 md:grid-cols-2">
            <AnimatePresence>
              {ideas?.map((idea, i) => (
                <motion.div key={idea.title} initial={{ opacity: 0, scale: 0.9, rotate: i % 2 ? 2 : -2 }} animate={{ opacity: 1, scale: 1, rotate: 0 }} transition={{ delay: i * 0.1, type: "spring" }}
                  className={clsx("rounded-2xl border-[2.5px] border-edge p-4 shadow-[4px_4px_0_var(--shadow-c)]", ["bg-pink/25", "bg-lime/30", "bg-blue/15", "bg-orange/25"][i % 4])}>
                  <div className="font-display text-lg font-extrabold leading-tight">{idea.title}</div>
                  <p className="mt-1.5 text-sm">{idea.pitch}</p>
                  <div className="mt-2 rounded-lg border-2 border-dashed border-edge bg-surface/70 p-2 text-xs"><b>First experiment:</b> {idea.method}</div>
                  <div className="mt-2 space-y-0.5">
                    {idea.evidence.map((e) => (
                      <a key={e.title} href={e.url ?? undefined} target="_blank" rel="noreferrer" className="flex items-start gap-1 text-[11px] text-ink-2 hover:underline">
                        <ExternalLink className="mt-0.5 size-3 shrink-0" />{e.title}
                      </a>
                    ))}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      </Card>

    </div>
  );
}
