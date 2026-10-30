"use client";

import clsx from "clsx";
import { AlertTriangle, CheckCircle2, Circle, ClipboardCopy, Download, ExternalLink, FileSignature, Loader2, PackageCheck, Users } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { api, toast } from "@/lib/api";
import { download, exportPaper } from "@/lib/paperExport";
import { Button, Card } from "../ui";

export interface Kit {
  venue: string; venue_type: string; cover_letter: string; significance: string; data_availability: string; conflicts: string;
  funding: string; ai_disclosure: string; highlights: string[]; keywords: string[];
  checklist: { item: string; status: "pass" | "warn" | "todo"; detail: string }[];
  reviewers: { name: string; paper: string; year?: number; url?: string }[]; response_template: string;
}

const TABS = [
  { id: "letter", label: "Cover letter", e: "✉️" },
  { id: "statements", label: "Declarations", e: "📜" },
  { id: "checklist", label: "Checklist", e: "✅" },
  { id: "reviewers", label: "Reviewers", e: "👥" },
  { id: "response", label: "Response template", e: "💬" },
] as const;

function kitMarkdown(k: Kit, letter: string) {
  return [
    "# Cover Letter", letter,
    "# Highlights", k.highlights.map((h) => `- ${h}`).join("\n"),
    "# Keywords", k.keywords.join(", "),
    "# Significance Statement", k.significance,
    "# Data Availability", k.data_availability,
    "# Conflict of Interest", k.conflicts,
    "# Funding", k.funding,
    "# Use of AI Tools", k.ai_disclosure,
    "# Pre-submission Checklist", k.checklist.map((c) => `- [${c.status === "pass" ? "x" : " "}] **${c.item}:** ${c.detail}`).join("\n"),
    "# Suggested Reviewer Candidates", k.reviewers.map((r) => `- ${r.name}, author of “${r.paper}” (${r.year ?? "n.d."})`).join("\n"),
    k.response_template,
  ].join("\n\n");
}

export function SubmissionKit({ paperId, title, template, author, affiliation, initial, venue }: {
  paperId: string; title: string; template: string; author: string; affiliation: string; initial?: Kit | null;
  venue?: { name: string; type: string } | null;
}) {
  const [kit, setKit] = useState<Kit | null>(initial ?? null);
  const [name, setName] = useState(initial?.venue ?? venue?.name ?? "");
  const [type, setType] = useState(initial?.venue_type ?? (venue?.type === "conference" ? "conference" : "journal"));
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("letter");
  const [letter, setLetter] = useState(initial?.cover_letter ?? "");
  useEffect(() => {
    if (!venue) return;
    const id = setTimeout(() => { setName(venue.name); setType(venue.type === "conference" ? "conference" : "journal"); }, 0);
    return () => clearTimeout(id);
  }, [venue]);

  const build = async () => {
    setBusy(true);
    try {
      const k = await api.post<Kit>(`/api/paper-studio/${paperId}/kit`, { venue: name, venue_type: type, author, affiliation });
      setKit(k); setLetter(k.cover_letter); setTab("letter");
      toast({ title: "Submission kit ready 📦", tone: "good" });
    } catch (e) {
      toast({ title: "Couldn't build the kit", body: (e as Error).message, tone: "crit" });
    } finally { setBusy(false); }
  };
  const pass = kit ? kit.checklist.filter((c) => c.status === "pass").length : 0;
  const ready = kit ? Math.round((pass / Math.max(1, kit.checklist.filter((c) => c.status !== "todo").length)) * 100) : 0;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b-[2.5px] border-edge bg-[linear-gradient(120deg,var(--yellow),var(--orange))] px-5 py-4 text-[#121212]">
        <motion.span animate={{ rotate: [0, -8, 8, 0] }} transition={{ repeat: Infinity, duration: 3 }}><PackageCheck className="size-8" /></motion.span>
        <div className="flex-1">
          <div className="font-display text-xl font-extrabold">Submission kit</div>
          <div className="text-xs font-semibold opacity-80">Cover letter, declarations, highlights, a pre-submission checklist and reviewer candidates for your target venue</div>
        </div>
      </div>
      <div className="space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Target venue, e.g. “IEEE Access” (or pick one above)"
            className="min-w-56 flex-1 rounded-xl border-[2.5px] border-edge bg-surface px-3.5 py-2.5 text-sm font-bold outline-none" />
          <div className="flex rounded-xl border-[2.5px] border-edge bg-surface p-0.5 text-xs font-extrabold">
            {(["journal", "conference"] as const).map((t) => (
              <button key={t} onClick={() => setType(t)} className={clsx("relative rounded-lg px-3 py-1.5 capitalize")}>
                {type === t && <motion.span layoutId="kit-type" className="absolute inset-0 rounded-lg bg-ink" />}
                <span className={clsx("relative", type === t && "text-bg")}>{t}</span>
              </button>
            ))}
          </div>
          <Button variant="primary" loading={busy} onClick={build}><FileSignature className="size-4" />{kit ? "Rebuild kit" : "Build my kit"}</Button>
        </div>

        {busy && !kit && <div className="flex items-center gap-2 text-sm text-muted"><Loader2 className="size-4 animate-spin" />Writing your cover letter and checking the manuscript…</div>}

        {kit && (
          <>
            <div className="flex flex-wrap items-center gap-1.5 border-b-2 border-dashed border-line pb-2">
              {TABS.map((t) => (
                <button key={t.id} onClick={() => setTab(t.id)} className="relative rounded-xl px-3 py-1.5 text-xs font-extrabold">
                  {tab === t.id && <motion.span layoutId="kit-tab" className="absolute inset-0 rounded-xl border-2 border-edge bg-yellow" transition={{ type: "spring", stiffness: 400, damping: 30 }} />}
                  <span className={clsx("relative", tab === t.id && "text-[#121212]")}>{t.e} {t.label}</span>
                </button>
              ))}
              <div className="ml-auto flex gap-1.5">
                <Button className="!px-2.5 !py-1 text-xs" onClick={() => exportPaper("docx", { title: `Submission kit · ${title}`, markdown: kitMarkdown(kit, letter), template, author, affiliation })}>
                  <Download className="size-3.5" />Word</Button>
                <Button className="!px-2.5 !py-1 text-xs" onClick={() => download(new Blob([kitMarkdown(kit, letter)], { type: "text/markdown" }), "submission-kit.md")}>
                  <Download className="size-3.5" />.md</Button>
              </div>
            </div>
            <AnimatePresence mode="wait">
              <motion.div key={tab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
                {tab === "letter" && (
                  <div>
                    <textarea value={letter} onChange={(e) => setLetter(e.target.value)} rows={16}
                      className="w-full rounded-2xl border-[2.5px] border-edge bg-white p-5 font-serif text-[15px] leading-relaxed text-[#111] outline-none" />
                    <div className="mt-2 flex items-center gap-2 text-xs text-muted">
                      <Button className="!px-2.5 !py-1 text-xs" onClick={() => { navigator.clipboard.writeText(letter); toast({ title: "Cover letter copied", tone: "good" }); }}>
                        <ClipboardCopy className="size-3.5" />Copy</Button>
                      Fill in anything in [brackets] before sending.
                    </div>
                  </div>
                )}
                {tab === "statements" && (
                  <div className="grid gap-3 md:grid-cols-2">
                    {([["Significance statement", kit.significance], ["Data availability", kit.data_availability], ["Conflict of interest", kit.conflicts],
                      ["Funding", kit.funding], ["Use of AI tools", kit.ai_disclosure], ["Highlights", kit.highlights.map((h) => `• ${h}`).join("\n")]] as const).map(([k, v], i) => (
                      <motion.div key={k} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.05 }}
                        className="rounded-2xl border-2 border-edge bg-surface p-4">
                        <div className="flex items-center justify-between font-display text-sm font-extrabold">{k}
                          <button onClick={() => { navigator.clipboard.writeText(v); toast({ title: `${k} copied`, tone: "good" }); }} className="opacity-50 hover:opacity-100"><ClipboardCopy className="size-3.5" /></button>
                        </div>
                        <p className="mt-1 whitespace-pre-line text-sm text-ink-2">{v}</p>
                      </motion.div>
                    ))}
                  </div>
                )}
                {tab === "checklist" && (
                  <div className="grid gap-4 md:grid-cols-[180px_1fr]">
                    <div className="grid place-items-center">
                      <div className="relative size-36">
                        <svg viewBox="0 0 120 120" className="size-36 -rotate-90">
                          <circle cx="60" cy="60" r="50" fill="none" stroke="var(--surface-3)" strokeWidth="12" />
                          <motion.circle cx="60" cy="60" r="50" fill="none" stroke={ready >= 80 ? "var(--good)" : "var(--orange)"} strokeWidth="12" strokeLinecap="round"
                            strokeDasharray={314} initial={{ strokeDashoffset: 314 }} animate={{ strokeDashoffset: 314 * (1 - ready / 100) }} transition={{ duration: 1.2 }} />
                        </svg>
                        <div className="absolute inset-0 grid place-items-center text-center"><div><div className="font-display text-3xl font-extrabold">{ready}%</div><div className="text-[10px] font-bold uppercase text-muted">ready</div></div></div>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      {kit.checklist.map((c, i) => (
                        <motion.div key={c.item} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}
                          className={clsx("flex gap-2.5 rounded-xl border-2 px-3 py-2 text-sm", c.status === "pass" ? "border-good/50 bg-good-soft" : c.status === "warn" ? "border-warn/60 bg-warn-soft" : "border-line bg-surface")}>
                          {c.status === "pass" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-good" /> : c.status === "warn" ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" /> : <Circle className="mt-0.5 size-4 shrink-0 text-muted" />}
                          <div><b>{c.item}.</b> <span className="text-ink-2">{c.detail}</span></div>
                        </motion.div>
                      ))}
                    </div>
                  </div>
                )}
                {tab === "reviewers" && (
                  <div>
                    <p className="mb-2 flex items-center gap-1.5 text-xs text-muted"><Users className="size-3.5" />Authors of works your paper cites. Check conflicts of interest and the venue&apos;s rules before suggesting anyone.</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {kit.reviewers.map((r, i) => (
                        <motion.a key={r.name} href={r.url} target="_blank" rel="noreferrer" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                          className="flex items-center gap-3 rounded-xl border-2 border-edge bg-surface p-3 hover:bg-surface-2">
                          <span className="grid size-9 shrink-0 place-items-center rounded-full border-2 border-edge bg-violet font-display font-extrabold text-white">{r.name[0]}</span>
                          <span className="min-w-0"><span className="block font-bold">{r.name}</span><span className="block truncate text-xs text-muted">{r.paper} ({r.year})</span></span>
                          <ExternalLink className="ml-auto size-3.5 shrink-0 opacity-50" />
                        </motion.a>
                      ))}
                    </div>
                  </div>
                )}
                {tab === "response" && (
                  <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap rounded-2xl border-2 border-edge bg-surface-2 p-4 text-xs">{kit.response_template}</pre>
                )}
              </motion.div>
            </AnimatePresence>
          </>
        )}
      </div>
    </Card>
  );
}
