"use client";

import clsx from "clsx";
import { BookMarked, ChevronDown, ClipboardCheck, Database, ExternalLink, Lightbulb, PenLine, Plus, Scale, Search, Trash2, Users, Wand2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api, toast } from "@/lib/api";
import { RichMarkdown } from "../notes/RichMarkdown";
import { Button, Card } from "../ui";
import { Skeleton } from "../ui/States";

export interface StudioPlan {
  plan_id: string; status: string; paper_id?: string; topic: string; paper_type: string; paper_type_label: string; type_reason?: string;
  title: string; research_question: string; contributions: string[]; method_name?: string; method_summary?: string;
  hypotheses?: string[]; themes?: string[]; thesis?: string;
  sections: { key: string; heading: string; brief: string }[];
  dossier: string; experts: string[];
  conflicts: { topic: string; a: { position: string; refs: number[] }; b: { position: string; refs: number[] }; explanations: string }[];
  novelty?: { verdict: string; explanation: string; repositioning?: string; closest: { title: string; year?: number; similarity: number }[] } | null;
  style?: { venue?: string; abstract_words_median?: number; references_median?: number } | null;
  candidates?: number; snowballed?: number; queries?: string[];
  public_data?: { name: string; rows: number; columns: string[]; sources: { title: string; url?: string; licence?: string }[]; questions: string[]; rationale: string } | null;
  references: { n: number; title: string; year?: number; venue?: string; cited_by?: number; url?: string }[];
}

const VERDICT: Record<string, [string, string]> = {
  novel: ["Looks novel", "bg-lime"],
  incremental: ["Close prior work found: repositioned to credit it", "bg-yellow"],
  already_exists: ["Very similar work exists: repositioned to credit it", "bg-orange"],
  unchecked: ["Novelty check skipped", "bg-surface-2"],
};

function Fold({ title, icon, children, open = false, badge }: { title: string; icon: React.ReactNode; children: React.ReactNode; open?: boolean; badge?: string }) {
  return (
    <details open={open} className="group rounded-2xl border-[2.5px] border-edge bg-surface">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 font-display font-extrabold">
        {icon}<span className="flex-1">{title}</span>
        {badge && <span className="rounded-full border-2 border-edge bg-surface-2 px-2 text-[11px]">{badge}</span>}
        <ChevronDown className="size-4 transition group-open:rotate-180" />
      </summary>
      <div className="border-t-2 border-edge px-4 py-3">{children}</div>
    </details>
  );
}

/** Co-pilot checkpoint: review and edit the research plan before the (expensive) writing starts. */
export function PlanReview({ planId, onWrite, onDiscard }: { planId: string; onWrite: (jobId: string) => void; onDiscard: () => void }) {
  const [plan, setPlan] = useState<StudioPlan | null>(null);
  const [title, setTitle] = useState("");
  const [rq, setRq] = useState("");
  const [contribs, setContribs] = useState<string[]>([]);
  const [briefs, setBriefs] = useState<Record<string, string>>({});
  const [excluded, setExcluded] = useState<number[]>([]);
  const [instructions, setInstructions] = useState("");
  const [useData, setUseData] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<StudioPlan>(`/api/paper-studio/plans/${planId}`).then((p) => {
      setPlan(p); setTitle(p.title); setRq(p.research_question); setContribs(p.contributions);
      setBriefs(Object.fromEntries(p.sections.map((s) => [s.key, s.brief])));
    }).catch((e) => { toast({ title: "Couldn't open the plan", body: (e as Error).message, tone: "crit" }); onDiscard(); });
  }, [planId, onDiscard]);

  if (!plan) return <Card className="space-y-3 p-6"><Skeleton className="h-8 w-2/3" /><Skeleton className="h-4 w-full" /><Skeleton className="h-40 w-full" /></Card>;

  const write = async () => {
    setBusy(true);
    try {
      const changed = Object.fromEntries(Object.entries(briefs).filter(([k, v]) => v !== plan.sections.find((s) => s.key === k)?.brief));
      const { job_id } = await api.post<{ job_id: string }>(`/api/paper-studio/plans/${planId}/write`, {
        title: title !== plan.title ? title : "", research_question: rq !== plan.research_question ? rq : "",
        contributions: contribs.join("\n") !== plan.contributions.join("\n") ? contribs.filter((c) => c.trim()) : [],
        briefs: changed, exclude_refs: excluded, instructions, use_public_data: useData,
      });
      onWrite(job_id);
    } catch (e) {
      toast({ title: "Couldn't start writing", body: (e as Error).message, tone: "crit" });
    } finally { setBusy(false); }
  };

  const [vLabel, vColor] = VERDICT[plan.novelty?.verdict ?? "unchecked"] ?? VERDICT.unchecked;
  const field = "w-full rounded-xl border-2 border-edge bg-surface px-3 py-2 outline-none focus:shadow-[3px_3px_0_var(--shadow-c)]";

  return (
    <Card pop className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b-[2.5px] border-edge bg-yellow px-5 py-4 text-[#121212]">
        <ClipboardCheck className="size-7" />
        <div className="min-w-0 flex-1">
          <div className="font-display text-xs font-extrabold uppercase tracking-widest opacity-70">Step 2 of 3 · Review the plan</div>
          <div className="font-display text-xl font-extrabold leading-tight">Your research team has a plan. Check it before they write.</div>
        </div>
        <Button variant="ghost" onClick={onDiscard}><X className="size-4" />Discard</Button>
      </div>

      <div className="grid gap-5 p-5 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2 text-xs font-bold">
            <span className="rounded-full border-2 border-edge bg-lime px-2.5 py-0.5 text-[#121212]">{plan.paper_type_label}</span>
            <span className="rounded-full border-2 border-edge bg-surface-2 px-2.5 py-0.5">{plan.references.length} references from {plan.candidates ?? "?"} candidates</span>
            {!!plan.snowballed && <span className="rounded-full border-2 border-edge bg-surface-2 px-2.5 py-0.5">{plan.snowballed} found by citation chaining</span>}
            {plan.style?.venue && <span className="rounded-full border-2 border-edge bg-mint px-2.5 py-0.5 text-[#121212]">Styled for {plan.style.venue}</span>}
          </div>
          {plan.type_reason && <p className="text-xs text-muted">Why this type: {plan.type_reason}</p>}

          <label className="block text-xs font-extrabold uppercase tracking-wider text-muted">Title
            <textarea value={title} onChange={(e) => setTitle(e.target.value)} rows={2} className={clsx(field, "mt-1 resize-y font-display text-lg font-extrabold normal-case leading-snug tracking-normal text-ink")} />
          </label>
          <label className="block text-xs font-extrabold uppercase tracking-wider text-muted">Research question
            <textarea value={rq} onChange={(e) => setRq(e.target.value)} rows={2} className={clsx(field, "mt-1 resize-y text-sm normal-case tracking-normal text-ink")} />
          </label>
          {(plan.thesis || plan.method_summary) && (
            <div className="max-h-72 overflow-y-auto rounded-xl border-2 border-dashed border-line p-3 text-sm text-ink-2">
              {plan.thesis && <p><b>Thesis:</b> {plan.thesis}</p>}
              {plan.method_name && <p><b>{plan.paper_type === "method" ? "Method" : "Design"}:</b> {plan.method_name}</p>}
              {plan.method_summary && <p className="mt-1">{plan.method_summary}</p>}
              {!!plan.hypotheses?.length && <ul className="mt-2 list-disc pl-5">{plan.hypotheses.map((h) => <li key={h}>{h}</li>)}</ul>}
              {!!plan.themes?.length && <p className="mt-2"><b>{plan.paper_type === "position" ? "Claims" : "Themes"}:</b> {plan.themes.join(" · ")}</p>}
            </div>
          )}
          <div>
            <div className="mb-1 text-xs font-extrabold uppercase tracking-wider text-muted">Contributions</div>
            <div className="space-y-2">
              {contribs.map((c, i) => (
                <div key={i} className="flex gap-2">
                  <span className="mt-2 font-display font-extrabold">{i + 1}.</span>
                  <textarea value={c} rows={2} onChange={(e) => setContribs(contribs.map((x, k) => (k === i ? e.target.value : x)))} className={clsx(field, "resize-y text-sm")} />
                  <button onClick={() => setContribs(contribs.filter((_, k) => k !== i))} aria-label="Remove contribution" className="self-start p-1.5 opacity-60 hover:opacity-100"><Trash2 className="size-4" /></button>
                </div>
              ))}
              {contribs.length < 6 && <button onClick={() => setContribs([...contribs, ""])} className="inline-flex items-center gap-1 text-xs font-bold text-pink"><Plus className="size-3.5" />Add a contribution</button>}
            </div>
          </div>

          <Fold title="What each section will say" icon={<PenLine className="size-4" />} badge={`${plan.sections.length} sections`}>
            <div className="space-y-3">
              {plan.sections.map((s) => (
                <label key={s.key} className="block text-sm font-extrabold">{s.heading}
                  <textarea value={briefs[s.key] ?? ""} rows={3} onChange={(e) => setBriefs({ ...briefs, [s.key]: e.target.value })} className={clsx(field, "mt-1 resize-y text-xs font-normal")} />
                </label>
              ))}
            </div>
          </Fold>
          <label className="block text-xs font-extrabold uppercase tracking-wider text-muted">Anything else the writers should know? (optional)
            <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={2} placeholder="e.g. focus on low-income countries; avoid jargon in the introduction; my supervisor prefers British spelling"
              className={clsx(field, "mt-1 resize-y text-sm font-normal normal-case tracking-normal text-ink")} />
          </label>
        </div>

        <div className="space-y-3">
          {plan.public_data ? (
            <div className={clsx("rounded-2xl border-[2.5px] border-edge p-4", useData ? "bg-blue text-white" : "bg-surface-2")}>
              <div className="flex items-center gap-2 font-display font-extrabold"><Database className="size-4" />Real open data found</div>
              <ul className="mt-1.5 space-y-1 text-sm">
                {plan.public_data.sources.map((x) => (
                  <li key={x.title}>• {x.url ? <a href={x.url} target="_blank" rel="noreferrer" className="underline">{x.title}</a> : x.title}{x.licence ? ` (${x.licence})` : ""}</li>
                ))}
              </ul>
              <p className="mt-1.5 text-xs opacity-90">{plan.public_data.rows.toLocaleString()} rows · the experiment agent will write and run the analysis code and report the real results, tables and charts.</p>
              <ul className="mt-1.5 list-disc pl-5 text-xs opacity-90">{plan.public_data.questions.map((q) => <li key={q}>{q}</li>)}</ul>
              <label className="mt-2 flex items-center gap-2 text-xs font-bold">
                <input type="checkbox" checked={useData} onChange={(e) => setUseData(e.target.checked)} className="size-4 accent-[var(--lime)]" />Analyse this data in my paper
              </label>
            </div>
          ) : (
            <div className="rounded-2xl border-[2.5px] border-dashed border-edge p-4 text-sm text-ink-2">
              <div className="flex items-center gap-2 font-display font-extrabold text-ink"><Database className="size-4" />No open dataset fits closely</div>
              <p className="mt-1 text-xs">The paper will design a study rather than report results. Upload your own CSV next time to get real results.</p>
            </div>
          )}
          <div className={clsx("rounded-2xl border-[2.5px] border-edge p-4 text-[#121212]", vColor)}>
            <div className="flex items-center gap-2 font-display font-extrabold"><Search className="size-4" />Novelty check: {vLabel}</div>
            {plan.novelty?.explanation && <p className="mt-1 text-sm">{plan.novelty.explanation}</p>}
            {!!plan.novelty?.closest?.length && (
              <ul className="mt-2 space-y-1 text-xs">{plan.novelty.closest.map((c) => <li key={c.title}>• {c.title} ({c.year})</li>)}</ul>
            )}
          </div>
          <Fold title="Expert roundtable" icon={<Users className="size-4" />} badge={`${plan.experts.length} experts`}>
            <ul className="list-disc space-y-1 pl-5 text-sm">{plan.experts.map((e) => <li key={e} className="capitalize">{e}</li>)}</ul>
            <p className="mt-2 text-xs text-muted">Each expert questioned the literature from their own angle; their notes fed the dossier.</p>
          </Fold>
          <Fold title="Where the evidence disagrees" icon={<Scale className="size-4" />} badge={String(plan.conflicts.length)} open={plan.conflicts.length > 0}>
            {plan.conflicts.length ? (
              <ul className="space-y-3 text-sm">
                {plan.conflicts.map((c) => (
                  <li key={c.topic}>
                    <div className="font-bold">{c.topic}</div>
                    <div className="mt-1 text-ink-2">{c.a.position} <span className="font-mono text-xs">[{c.a.refs.join(", ")}]</span></div>
                    <div className="text-ink-2"><i>vs.</i> {c.b.position} <span className="font-mono text-xs">[{c.b.refs.join(", ")}]</span></div>
                    <div className="mt-1 text-xs text-muted">{c.explanations}</div>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted">No clear disagreements were found in these sources.</p>}
          </Fold>
          <Fold title="Research dossier" icon={<Lightbulb className="size-4" />} badge={`${plan.dossier.split(/\s+/).length.toLocaleString()} words`}>
            <div className="max-h-[50vh] overflow-y-auto text-sm"><RichMarkdown>{plan.dossier}</RichMarkdown></div>
          </Fold>
          <Fold title="References" icon={<BookMarked className="size-4" />} badge={`${plan.references.length - excluded.length} used`}>
            <p className="mb-2 text-xs text-muted">Untick a paper to keep it out of your paper.</p>
            <ol className="max-h-[45vh] space-y-1.5 overflow-y-auto text-xs">
              {plan.references.map((r) => (
                <li key={r.n} className={clsx("flex items-start gap-2", excluded.includes(r.n) && "opacity-45 line-through")}>
                  <input type="checkbox" checked={!excluded.includes(r.n)} aria-label={`Use reference ${r.n}`} className="mt-0.5 size-4 accent-[var(--pink)]"
                    onChange={(e) => setExcluded(e.target.checked ? excluded.filter((x) => x !== r.n) : [...excluded, r.n])} />
                  <span className="font-bold">[{r.n}]</span>
                  <a href={r.url} target="_blank" rel="noreferrer" className="hover:underline">{r.title} <span className="text-muted">({r.year}{r.cited_by ? ` · cited ${r.cited_by.toLocaleString()}×` : ""})</span><ExternalLink className="ml-0.5 inline size-3 opacity-50" /></a>
                </li>
              ))}
            </ol>
          </Fold>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3 border-t-[2.5px] border-edge bg-surface-2 px-5 py-4">
        <span className="mr-auto text-xs text-muted">Writing takes about 8-12 minutes. This paper already counts toward your monthly papers.</span>
        <Button variant="primary" className="!py-3 text-lg" loading={busy} onClick={write} disabled={!title.trim() || !rq.trim()}><Wand2 className="size-5" />Write the paper</Button>
      </div>
    </Card>
  );
}
