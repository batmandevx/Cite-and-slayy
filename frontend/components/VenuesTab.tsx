"use client";

import { BookOpen, ExternalLink, FileText, Send, Sparkles } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { DemoPaper } from "./DemoPapersShowcase";
import { VenueFinder } from "./studio/VenueFinder";
import { Card } from "./ui";

const SYSTEMS = [
  { name: "Microsoft CMT", url: "https://cmt3.research.microsoft.com/", what: "Conference Management Toolkit: many CS & engineering conferences take submissions here. Log in, find your conference, submit.", color: "bg-blue text-white", e: "🏛️" },
  { name: "OpenReview", url: "https://openreview.net/", what: "Open peer review used by ICLR, NeurIPS, ICML workshops and more. Browse active calls and public reviews.", color: "bg-lime text-[#121212]", e: "🔓" },
  { name: "EasyChair", url: "https://easychair.org/", what: "Submission system and calls-for-papers directory for thousands of conferences.", color: "bg-yellow text-[#121212]", e: "🪑" },
  { name: "WikiCFP", url: "http://www.wikicfp.com/cfp/", what: "Search calls for papers and upcoming submission deadlines by topic.", color: "bg-pink text-[#121212]", e: "📅" },
  { name: "Think. Check. Submit.", url: "https://thinkchecksubmit.org/", what: "Checklist to separate trusted peer-reviewed journals from predatory ones before submitting.", color: "bg-orange text-[#121212]", e: "✅" },
  { name: "DOAJ", url: "https://doaj.org/", what: "Directory of vetted, quality open-access journals worldwide.", color: "bg-mint text-[#121212]", e: "📖" },
];

const QUICK_TOPICS = [
  { label: "Conformal prediction under drift", title: "Adaptive conformal prediction intervals under non-stationary time-series drift", abstract: "Distribution-free online uncertainty quantification for streaming time series under regime shifts and heteroscedastic volatility." },
  { label: "Zero-trust LLM agents", title: "Zero-trust capability attenuation and anomaly detection for tool-using LLM agents", abstract: "Reference monitor enforcing least-privilege task-scoped capabilities and hash-chained audit logs against indirect prompt injection." },
  { label: "Federated medical imaging", title: "Privacy-preserving federated learning for multi-center medical image segmentation", abstract: "Differential privacy and domain-adaptive aggregation across heterogeneous hospital CT and MRI cohorts." },
  { label: "Graph RAG for science", title: "Citation-grounded graph retrieval-augmented generation for scientific reasoning", abstract: "Knowledge-graph retrieval and claim verification to reduce hallucinations in scholarly question answering." },
];

export function VenuesTab() {
  const [papers, setPapers] = useState<{ paper_id: string; title: string }[]>([]);
  const [demos, setDemos] = useState<DemoPaper[]>([]);
  const [pick, setPick] = useState<{ title: string; abstract: string; key: string } | null>(null);

  useEffect(() => {
    api.get<typeof papers>("/api/paper-studio").then(setPapers).catch(() => {});
    api.get<DemoPaper[]>("/api/demo-papers").then(setDemos).catch(() => {});
  }, []);

  const pickPaper = async (id: string) => {
    const p = await api.get<{ title: string; markdown: string }>(`/api/paper-studio/${id}`);
    const m = p.markdown.match(/# Abstract\s+([\s\S]*?)(?=\n# |\n\*\*Keywords)/);
    setPick((old) => ({
      title: p.title,
      abstract: (m?.[1] ?? "").trim().slice(0, 2500),
      key: `${id}-${(old ? Number(old.key.split("-").pop()) || 0 : 0) + 1}`,
    }));
  };

  const pickQuick = (title: string, abstract: string, tag: string) => {
    setPick((old) => ({
      title,
      abstract,
      key: `${tag}-${(old ? Number(old.key.split("-").pop()) || 0 : 0) + 1}`,
    }));
  };

  return (
    <div className="space-y-6">
      <div className="card card-pop relative overflow-hidden bg-blue p-6 text-white md:p-8">
        <motion.div className="pointer-events-none absolute -right-6 -top-8 text-[150px] opacity-20" animate={{ y: [0, -10, 0] }} transition={{ repeat: Infinity, duration: 4 }}>🎯</motion.div>
        <div className="relative max-w-2xl">
          <span className="sticker bg-yellow text-[#121212]">Publish assistance</span>
          <h2 className="mt-3 font-display text-4xl font-extrabold">Find the right journal or conference</h2>
          <p className="mt-1 opacity-90">
            We analyze where the most semantically similar peer-reviewed papers were published over the last 6 years on OpenAlex
            and rank matching journals &amp; conferences with open-access, DOAJ, APC fee, 2-year citedness, and h-index metrics.
          </p>
        </div>
      </div>

      <Card className="space-y-3 p-4">
        {papers.length > 0 && (
          <div>
            <div className="mb-1.5 flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-muted">
              <FileText className="size-3.5" /> Match a paper you wrote in Paper Studio
            </div>
            <div className="flex flex-wrap gap-2">
              {papers.slice(0, 6).map((p) => (
                <motion.button key={p.paper_id} whileHover={{ y: -2 }} onClick={() => pickPaper(p.paper_id)}
                  className="btn-brut max-w-xs truncate rounded-xl bg-surface px-3 py-1.5 text-left text-xs font-bold">
                  {p.title}
                </motion.button>
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="mb-1.5 flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-muted">
            <Sparkles className="size-3.5" /> Or test instantly with a demo paper or topic
          </div>
          <div className="flex flex-wrap gap-2">
            {demos.map((d) => (
              <motion.button key={d.slug} whileHover={{ y: -2 }} onClick={() => pickQuick(d.title, d.summary, d.slug)}
                className="btn-brut inline-flex items-center gap-1.5 rounded-xl bg-lime px-3 py-1.5 text-xs font-extrabold text-[#121212]">
                <BookOpen className="size-3.5" /> {d.acronym} ({d.pages} pp.)
              </motion.button>
            ))}
            {QUICK_TOPICS.map((q) => (
              <motion.button key={q.label} whileHover={{ y: -2 }} onClick={() => pickQuick(q.title, q.abstract, q.label)}
                className="btn-brut rounded-xl bg-surface-2 px-3 py-1.5 text-xs font-bold">
                {q.label}
              </motion.button>
            ))}
          </div>
        </div>
      </Card>

      <VenueFinder bare key={pick?.key ?? "blank"} title={pick?.title ?? ""} abstract={pick?.abstract ?? ""} />

      <div>
        <div className="mb-3 flex items-center gap-2 font-display text-xl font-extrabold"><Send className="size-5" />Submit &amp; check venues</div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SYSTEMS.map((x, i) => (
            <motion.a key={x.name} href={x.url} target="_blank" rel="noreferrer" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }} whileHover={{ y: -5, rotate: i % 2 ? 0.8 : -0.8 }} className="card group flex gap-3 p-4">
              <span className={`grid size-11 shrink-0 place-items-center rounded-xl border-2 border-edge text-xl ${x.color}`}>{x.e}</span>
              <span className="min-w-0">
                <span className="flex items-center gap-1 font-display font-extrabold">{x.name}<ExternalLink className="size-3 opacity-50" /></span>
                <span className="block text-xs text-ink-2">{x.what}</span>
              </span>
            </motion.a>
          ))}
        </div>
      </div>
    </div>
  );
}
