"use client";

import clsx from "clsx";
import { ExternalLink, X } from "lucide-react";
import { useEffect, useRef } from "react";

export interface ProvenanceEntry { sentence: string; label: string; rationale: string; quote: string; source?: string }
export interface CiteTarget { nums: number[]; x: number; y: number; paragraph: string }
interface Ref { n: number; title: string; year?: number; url?: string; venue?: string }

const LABEL: Record<string, [string, string]> = {
  supported: ["Supported by the abstract", "bg-good-soft text-good-ink"],
  unclear: ["Abstract alone can't confirm it", "bg-warn-soft text-warn-ink"],
  unsupported: ["Flagged and rewritten", "bg-crit-soft text-crit-ink"],
  revised: ["Sentence edited after the check", "bg-surface-2 text-ink-2"],
  not_assessed: ["Not checked", "bg-surface-2 text-ink-2"],
};

// Compare rendered text with stored Markdown: drop citation markers, Markdown symbols, list numbers and inline math.
const norm = (t: string) => t.replace(/\$[^$]*\$/g, " ").replace(/\[[\d,\s–-]+\]/g, "").replace(/^\s*(?:\d+[.)]|[-*+])\s+/, "")
  .replace(/[*_`#>]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim().toLowerCase();

/** Shows where a citation comes from: the reference, the check verdict for this sentence, and the closest abstract passage. */
export function CitationPopover({ target, refs, provenance, onClose }: {
  target: CiteTarget; refs: Ref[]; provenance: Record<string, ProvenanceEntry[]>; onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) onClose(); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const t = window.setTimeout(() => document.addEventListener("mousedown", away), 0);
    document.addEventListener("keydown", esc);
    return () => { window.clearTimeout(t); document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [onClose]);
  const para = norm(target.paragraph);
  const left = Math.min(Math.max(12, target.x - 180), (typeof window !== "undefined" ? window.innerWidth : 1200) - 392);
  return (
    <div ref={box} role="dialog" aria-label="Citation source" style={{ left, top: target.y + 14 }}
      className="card fixed z-[70] max-h-[60vh] w-[min(380px,calc(100vw-24px))] overflow-y-auto bg-surface p-4 text-left text-sm text-ink">
      <button onClick={onClose} aria-label="Close" className="absolute right-2 top-2 p-1 opacity-60 hover:opacity-100"><X className="size-4" /></button>
      <div className="space-y-4 pr-4">
        {target.nums.map((n) => {
          const ref = refs.find((r) => r.n === n);
          const all = provenance[String(n)] ?? [];
          const here = all.filter((e) => para.includes(norm(e.sentence).slice(0, 60)));
          const shown = (here.length ? here : all).slice(0, 2);
          return (
            <div key={n}>
              <div className="font-display font-extrabold">[{n}] {ref ? ref.title : "Reference"}</div>
              {ref && (
                <div className="text-xs text-muted">{[ref.venue, ref.year].filter(Boolean).join(" · ")}
                  {ref.url && <a href={ref.url} target="_blank" rel="noreferrer" className="ml-1 inline-flex items-center gap-0.5 font-bold text-pink hover:underline">open<ExternalLink className="size-3" /></a>}
                </div>
              )}
              {shown.length ? shown.map((e, i) => {
                const [lbl, cls] = LABEL[e.label] ?? LABEL.not_assessed;
                return (
                  <div key={i} className="mt-2 rounded-xl border-2 border-edge p-2.5">
                    <span className={clsx("inline-block rounded-full px-2 py-0.5 text-[11px] font-bold", cls)}>{lbl}</span>
                    {!here.length && <p className="mt-1 text-[11px] text-muted">Elsewhere in the paper: “{e.sentence.slice(0, 160)}{e.sentence.length > 160 ? "…" : ""}”</p>}
                    {e.quote && <p className="mt-1.5 text-xs"><span className="font-bold">{e.source === "full text" ? "Matching passage from the paper's full text:" : "Closest passage in the abstract:"}</span> <i>“{e.quote}”</i></p>}
                    {e.rationale && <p className="mt-1 text-[11px] text-muted">{e.rationale}</p>}
                  </div>
                );
              }) : <p className="mt-1 text-xs text-muted">No sentence-level check stored for this citation.</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
