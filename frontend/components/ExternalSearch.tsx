"use client";

import { ExternalLink } from "lucide-react";
import { toast } from "@/lib/api";

/** One-click "continue this search in…" links to trusted research tools (opens their official sites in a new tab). */
const TOOLS: { name: string; url: (q: string) => string; copy?: boolean; hint: string; color: string }[] = [
  { name: "Semantic Scholar", url: (q) => `https://www.semanticscholar.org/search?q=${encodeURIComponent(q)}`, hint: "Paper search with citation graphs", color: "bg-yellow" },
  { name: "Consensus", url: (q) => `https://consensus.app/results/?q=${encodeURIComponent(q)}`, hint: "Answers from peer-reviewed papers", color: "bg-mint" },
  { name: "Elicit", url: (q) => `https://elicit.com/?q=${encodeURIComponent(q)}`, hint: "AI literature review and data extraction", color: "bg-lime" },
  { name: "ResearchRabbit", url: () => "https://app.researchrabbit.ai/", copy: true, hint: "Citation-network discovery (paste your query)", color: "bg-pink" },
  { name: "Litmaps", url: () => "https://app.litmaps.com/", copy: true, hint: "Visual literature maps (paste your query)", color: "bg-orange" },
];

export function ExternalSearch({ query, className }: { query: string; className?: string }) {
  const q = query.trim();
  if (!q) return null;
  return (
    <div className={className}>
      <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-muted">Continue “{q.length > 48 ? `${q.slice(0, 48)}…` : q}” in</div>
      <div className="flex flex-wrap gap-1.5">
        {TOOLS.map((t) => (
          <a key={t.name} href={t.url(q)} target="_blank" rel="noopener noreferrer" title={t.hint}
            onClick={() => {
              if (!t.copy) return;
              navigator.clipboard?.writeText(q).then(() => toast({ title: `Query copied for ${t.name}`, body: "Paste it into its search box.", tone: "accent" })).catch(() => {});
            }}
            className={`inline-flex items-center gap-1 rounded-full border-2 border-edge px-2.5 py-0.5 text-xs font-bold text-[#121212] transition hover:-translate-y-0.5 ${t.color}`}>
            {t.name} <ExternalLink className="size-3" />
          </a>
        ))}
      </div>
    </div>
  );
}
