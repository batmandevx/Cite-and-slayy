"use client";

import clsx from "clsx";
import { AlertTriangle, BookOpenCheck, CalendarClock, Clock3, ExternalLink, Landmark, Loader2, MapPin, Radio, Search, ShieldCheck, Unlock } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, toast } from "@/lib/api";
import { Button, Card } from "../ui";

interface Venue {
  id: string;
  name: string;
  type: string;
  publisher?: string | null;
  homepage?: string | null;
  openalex_url: string;
  is_oa?: boolean | null;
  in_doaj?: boolean | null;
  apc_usd?: number | null;
  h_index?: number | null;
  mean_citedness_2yr?: number | null;
  similar_papers: number;
  fit: number;
  examples: { title: string; year?: number; url?: string }[];
  papers_last_12m?: number;
  activity?: string;
  caution?: string;
  doaj?: { weeks_to_publication?: number | null; apc?: { amount?: number | null; currency?: string | null } | null; waiver?: boolean | null; review?: string | null } | null;
}

interface Call {
  acronym: string; name: string; url: string; start?: string | null; end?: string | null; where?: string | null;
  deadline: string; later_deadline?: string | null; days_left: number; publisher_backed: boolean; kind: string;
}

type Result = { venues: Venue[]; calls?: Call[]; checked_at?: string; searched?: number; since?: string; note?: string };

const fmt = (iso?: string | null) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "");

function CallsForPapers({ calls }: { calls: Call[] }) {
  if (!calls.length) return null;
  return (
    <div className="rounded-2xl border-[2.5px] border-edge bg-surface-2 p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <CalendarClock className="size-5" />
        <div className="font-display text-lg font-extrabold">Open calls for papers</div>
        <span className="rounded-full border-2 border-edge bg-pink px-2 py-0.5 text-[10px] font-extrabold uppercase text-[#121212]">Live</span>
        <span className="text-[11px] text-muted">Upcoming deadlines for related conferences, soonest first</span>
      </div>
      <div className="mt-3 grid gap-2.5 md:grid-cols-2">
        {calls.map((c, i) => {
          const urgent = c.days_left <= 7, soon = c.days_left <= 30;
          return (
            <motion.a key={c.url} href={c.url} target="_blank" rel="noreferrer" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
              className="group flex gap-3 rounded-xl border-2 border-edge bg-surface p-3 transition hover:-translate-y-0.5 hover:shadow-[3px_3px_0_var(--shadow-c)]">
              <div className={clsx("grid w-16 shrink-0 place-items-center rounded-xl border-2 border-edge py-1.5 text-center text-[#121212]",
                urgent ? "bg-pink" : soon ? "bg-yellow" : "bg-lime")}>
                <div className="font-display text-2xl font-extrabold leading-none">{c.days_left}</div>
                <div className="text-[9px] font-extrabold uppercase">{c.days_left === 1 ? "day left" : "days left"}</div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-display font-extrabold leading-tight group-hover:underline">{c.acronym}</span>
                  {c.publisher_backed
                    ? <span className="inline-flex items-center gap-0.5 rounded-full border-2 border-edge bg-mint px-1.5 text-[9px] font-extrabold uppercase text-[#121212]"><ShieldCheck className="size-2.5" />Publisher-backed</span>
                    : <span className="rounded-full border-2 border-edge bg-surface-2 px-1.5 text-[9px] font-extrabold uppercase text-muted" title="Listings come from WikiCFP and are not vetted">Unvetted listing</span>}
                  {c.kind === "journal call" && <span className="rounded-full border-2 border-edge bg-surface-2 px-1.5 text-[9px] font-extrabold uppercase">Journal call</span>}
                </div>
                <div className="line-clamp-2 text-xs text-ink-2">{c.name}</div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] font-semibold text-muted">
                  <span className="inline-flex items-center gap-1"><Clock3 className="size-3" />Deadline {fmt(c.deadline)}{c.later_deadline ? ` · then ${fmt(c.later_deadline)}` : ""}</span>
                  {c.start && <span className="inline-flex items-center gap-1"><CalendarClock className="size-3" />{fmt(c.start)}{c.end ? ` – ${fmt(c.end)}` : ""}</span>}
                  {c.where && <span className="inline-flex items-center gap-1"><MapPin className="size-3" />{c.where}</span>}
                </div>
              </div>
            </motion.a>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] text-muted">From WikiCFP, refreshed every few hours. Check the organiser and where proceedings are indexed before submitting.</p>
    </div>
  );
}

export function VenueFinder({
  title: t0 = "",
  abstract: a0 = "",
  auto = false,
  bare = false,
  onPick,
}: {
  title?: string;
  abstract?: string;
  auto?: boolean;
  bare?: boolean;
  onPick?: (v: { name: string; type: string }) => void;
}) {
  const [title, setTitle] = useState(t0);
  const [abstract, setAbstract] = useState(a0);
  const [kind, setKind] = useState<"any" | "journal" | "conference">("any");
  const [oa, setOa] = useState(false);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Result | null>(null);
  const didAutoRef = useRef<string>("");

  const searchVenues = useCallback(
    async (qTitle: string, qAbstract: string, qKind: "any" | "journal" | "conference", qOa: boolean, silent = false) => {
      if (qTitle.trim().length < 3) {
        if (!silent) toast({ title: "Enter a paper title or topic first", tone: "accent" });
        return;
      }
      setBusy(true);
      try {
        const data = await api.post<Result>("/api/venues/find", {
          title: qTitle.trim(),
          abstract: qAbstract.trim(),
          kind: qKind,
          oa_only: qOa,
        });
        setRes(data);
      } catch (e) {
        toast({ title: "Venue search failed", body: (e as Error).message, tone: "crit" });
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const [prevProps, setPrevProps] = useState({ t0, a0 });
  if (prevProps.t0 !== t0 || prevProps.a0 !== a0) {
    setPrevProps({ t0, a0 });
    setTitle(t0);
    setAbstract(a0);
  }

  // Auto-search when mounted/updated with a pre-filled title (Paper Studio or quick-pick chips)
  useEffect(() => {
    const sig = `${t0.trim()}||${a0.trim().slice(0, 120)}`;
    if (t0.trim().length < 3 || (!auto && !bare) || didAutoRef.current === sig) return;
    didAutoRef.current = sig;
    const timer = window.setTimeout(() => {
      void searchVenues(t0, a0, kind, oa, true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [t0, a0, auto, bare, kind, oa, searchVenues]);

  const changeKind = (nextKind: "any" | "journal" | "conference") => {
    setKind(nextKind);
    if (title.trim().length >= 3) {
      void searchVenues(title, abstract, nextKind, oa, true);
    }
  };

  const changeOa = (nextOa: boolean) => {
    setOa(nextOa);
    if (title.trim().length >= 3) {
      void searchVenues(title, abstract, kind, nextOa, true);
    }
  };

  return (
    <Card className="overflow-hidden">
      {!bare && (
        <div className="flex flex-wrap items-center gap-3 border-b-[2.5px] border-edge bg-blue px-5 py-4 text-white">
          <Landmark className="size-7" />
          <div className="flex-1">
            <div className="font-display text-xl font-extrabold">Find the right journal or conference</div>
            <div className="text-xs opacity-85">Live: where similar papers are being published now, journal activity and open calls for papers (OpenAlex · DOAJ · WikiCFP)</div>
          </div>
        </div>
      )}
      <div className="space-y-3 p-5">
        {!auto && (
          <>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && searchVenues(title, abstract, kind, oa)}
              placeholder="Paper title or research topic (e.g. “Adaptive conformal prediction for time-series drift”)"
              className="w-full rounded-xl border-[2.5px] border-edge bg-surface px-3.5 py-2.5 text-sm font-bold outline-none"
            />
            <textarea
              value={abstract}
              onChange={(e) => setAbstract(e.target.value)}
              rows={3}
              placeholder="Abstract or 2–3 sentences describing your contribution (optional, sharpens semantic matching)"
              className="w-full resize-none rounded-xl border-[2.5px] border-edge bg-surface px-3.5 py-2.5 text-sm outline-none"
            />
          </>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {(["any", "journal", "conference"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => changeKind(k)}
              className={clsx(
                "rounded-full border-2 border-edge px-3 py-0.5 text-xs font-bold capitalize transition-colors",
                kind === k ? "bg-yellow text-[#121212]" : "bg-surface hover:bg-surface-2",
              )}
            >
              {k === "any" ? "All venues" : `${k}s`}
            </button>
          ))}
          <label className="ml-1 inline-flex cursor-pointer items-center gap-1.5 text-xs font-bold">
            <input type="checkbox" checked={oa} onChange={(e) => changeOa(e.target.checked)} className="accent-[var(--pink)]" />
            Open access only
          </label>
          <Button variant="blue" className="ml-auto !py-1.5 text-xs" loading={busy} onClick={() => searchVenues(title, abstract, kind, oa)}>
            <Search className="size-3.5" />
            {res ? "Refresh matches" : "Find venues"}
          </Button>
        </div>

        {busy && !res?.venues.length && (
          <div className="flex items-center gap-2.5 rounded-2xl border-2 border-dashed border-edge bg-surface-2 px-4 py-6 text-sm font-semibold text-ink-2">
            <Loader2 className="size-4 animate-spin text-blue" />
            Scanning recent peer-reviewed works, live journal activity and open calls for papers…
          </div>
        )}

        {res?.note && (
          <p className="text-xs text-muted">
            {res.checked_at && (
              <span className="mr-1.5 inline-flex items-center gap-1 rounded-full border-2 border-edge bg-lime px-1.5 py-px text-[10px] font-extrabold uppercase text-[#121212]">
                <Radio className="size-2.5 animate-pulse" /> Live · {new Date(res.checked_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
            {res.searched ? `Matched across ${res.searched} recent works since ${res.since} · ` : ""}
            {res.note}
          </p>
        )}

        {res?.calls && res.calls.length > 0 && kind === "conference" && <CallsForPapers calls={res.calls} />}

        <div className="grid gap-3 md:grid-cols-2">
          <AnimatePresence>
            {res?.venues.map((v, i) => (
              <motion.div
                key={v.id}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                className="rounded-2xl border-[2.5px] border-edge bg-surface p-3.5 shadow-[3px_3px_0_var(--shadow-c)]"
              >
                <div className="flex items-start gap-2">
                  <div
                    className="relative grid size-11 shrink-0 place-items-center rounded-full border-2 border-edge font-display text-sm font-extrabold"
                    style={{ background: `conic-gradient(var(--good) ${v.fit * 3.6}deg, var(--surface-3) 0)` }}
                  >
                    <span className="grid size-8 place-items-center rounded-full bg-surface">{v.fit}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <a href={v.homepage || v.openalex_url} target="_blank" rel="noreferrer" className="font-display font-extrabold leading-tight hover:underline">
                      {v.name}
                      <ExternalLink className="ml-1 inline size-3 opacity-50" />
                    </a>
                    <div className="text-[11px] text-muted">{v.publisher || "Independent / Society Publisher"}</div>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1 text-[10px] font-extrabold uppercase">
                  <span className="rounded-full border-2 border-edge bg-surface-2 px-1.5">{v.type}</span>
                  {v.is_oa && (
                    <span className="inline-flex items-center gap-0.5 rounded-full border-2 border-edge bg-lime px-1.5 text-[#121212]">
                      <Unlock className="size-2.5" />
                      Open access
                    </span>
                  )}
                  {v.in_doaj && (
                    <span className="inline-flex items-center gap-0.5 rounded-full border-2 border-edge bg-mint px-1.5 text-[#121212]">
                      <BookOpenCheck className="size-2.5" />
                      DOAJ
                    </span>
                  )}
                  {v.apc_usd != null && !v.doaj?.apc?.currency && <span className="rounded-full border-2 border-edge bg-surface-2 px-1.5">APC ${v.apc_usd.toLocaleString()}</span>}
                  {v.h_index != null && <span className="rounded-full border-2 border-edge bg-surface-2 px-1.5">h-index {v.h_index}</span>}
                  {v.papers_last_12m != null && (
                    <span className={clsx("inline-flex items-center gap-0.5 rounded-full border-2 border-edge px-1.5",
                      v.papers_last_12m >= 30 ? "bg-yellow text-[#121212]" : "bg-surface-2")} title="Papers published in the last 12 months (OpenAlex)">
                      <Radio className="size-2.5" />{v.papers_last_12m.toLocaleString()} papers / 12 mo
                    </span>
                  )}
                  {v.doaj?.weeks_to_publication != null && (
                    <span className="rounded-full border-2 border-edge bg-mint px-1.5 text-[#121212]" title="Typical weeks from submission to publication (DOAJ)">
                      ~{v.doaj.weeks_to_publication} wks to publish
                    </span>
                  )}
                  {v.doaj?.apc?.amount != null && v.doaj.apc.currency && (
                    <span className="rounded-full border-2 border-edge bg-surface-2 px-1.5" title="Current article processing charge (DOAJ)">
                      APC {v.doaj.apc.currency} {v.doaj.apc.amount.toLocaleString()}{v.doaj.waiver ? " · waivers" : ""}
                    </span>
                  )}
                  {v.mean_citedness_2yr != null && (
                    <span
                      className="rounded-full border-2 border-edge bg-surface-2 px-1.5"
                      title="OpenAlex 2-year mean citedness (not the official Clarivate Impact Factor)"
                    >
                      2y cites {v.mean_citedness_2yr}
                    </span>
                  )}
                </div>
                {v.caution && (
                  <div className="mt-2 flex items-start gap-1.5 rounded-lg border-2 border-edge bg-warn-soft px-2 py-1 text-[11px] font-semibold text-warn-ink">
                    <AlertTriangle className="mt-px size-3.5 shrink-0" />{v.caution}
                  </div>
                )}
                {v.similar_papers > 0 && (
                  <div className="mt-2 text-[11px] text-ink-2">
                    <b>{v.similar_papers}</b> similar recent paper{v.similar_papers === 1 ? "" : "s"} here, e.g.
                  </div>
                )}
                {v.examples.slice(0, 2).map((x, idx) => (
                  <a key={`${x.title}-${idx}`} href={x.url} target="_blank" rel="noreferrer" className="block truncate text-[11px] text-muted hover:underline">
                    “{x.title}” ({x.year})
                  </a>
                ))}
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {v.homepage && (
                    <a
                      href={v.homepage}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg border-2 border-edge bg-surface-2 px-2 py-0.5 text-[10px] font-extrabold hover:bg-yellow hover:text-[#121212]"
                    >
                      {v.type === "journal" ? "Author guidelines ↗" : "Website ↗"}
                    </a>
                  )}
                  <a
                    href={`http://www.wikicfp.com/cfp/servlet/tool.search?q=${encodeURIComponent(v.name)}&year=t`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border-2 border-edge bg-surface-2 px-2 py-0.5 text-[10px] font-extrabold hover:bg-pink hover:text-[#121212]"
                  >
                    Call for papers ↗
                  </a>
                  {onPick && (
                    <button
                      type="button"
                      onClick={() => onPick({ name: v.name, type: v.type })}
                      className="rounded-lg border-2 border-edge bg-yellow px-2 py-0.5 text-[10px] font-extrabold text-[#121212] hover:-translate-y-0.5"
                    >
                      📦 Use for kit
                    </button>
                  )}
                  {v.type !== "journal" && (
                    <a
                      href="https://cmt3.research.microsoft.com/"
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg border-2 border-edge bg-surface-2 px-2 py-0.5 text-[10px] font-extrabold hover:bg-blue hover:text-white"
                    >
                      Microsoft CMT ↗
                    </a>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
        {res?.calls && res.calls.length > 0 && kind !== "conference" && <CallsForPapers calls={res.calls} />}

        {res && res.venues.length > 0 && (
          <p className="text-[11px] text-muted">
            Fit = similarity-weighted share of matching peer-reviewed works. Always check the venue&apos;s scope, deadlines, and author guidelines; verify unfamiliar journals with Think. Check. Submit.
          </p>
        )}
      </div>
    </Card>
  );
}
