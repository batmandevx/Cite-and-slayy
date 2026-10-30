"use client";

import { ExternalLink, FileText, Send } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { VenueFinder } from "./studio/VenueFinder";
import { Card } from "./ui";

const SYSTEMS = [
  { name: "Microsoft CMT", url: "https://cmt3.research.microsoft.com/", what: "Conference Management Toolkit: many CS & engineering conferences take submissions here. Log in, find your conference, submit.", color: "bg-blue text-white", e: "🏛️" },
  { name: "OpenReview", url: "https://openreview.net/", what: "Open peer review used by ICLR, NeurIPS workshops and more. See venues and public reviews.", color: "bg-lime text-[#121212]", e: "🔓" },
  { name: "EasyChair", url: "https://easychair.org/", what: "Submission system and calls-for-papers list for thousands of conferences.", color: "bg-yellow text-[#121212]", e: "🪑" },
  { name: "WikiCFP", url: "http://www.wikicfp.com/cfp/", what: "Search calls for papers and deadlines by topic.", color: "bg-pink text-[#121212]", e: "📅" },
  { name: "Think. Check. Submit.", url: "https://thinkchecksubmit.org/", what: "Checklist to tell trusted journals from predatory ones before you submit.", color: "bg-orange text-[#121212]", e: "✅" },
  { name: "DOAJ", url: "https://doaj.org/", what: "Directory of quality open-access journals.", color: "bg-mint text-[#121212]", e: "📖" },
];

export function VenuesTab() {
  const [papers, setPapers] = useState<{ paper_id: string; title: string }[]>([]);
  const [pick, setPick] = useState<{ title: string; abstract: string; key: string } | null>(null);
  useEffect(() => { api.get<typeof papers>("/api/paper-studio").then(setPapers).catch(() => {}); }, []);
  const usePaper = async (id: string) => {
    const p = await api.get<{ title: string; markdown: string }>(`/api/paper-studio/${id}`);
    const m = p.markdown.match(/# Abstract\s+([\s\S]*?)(?=\n# |\n\*\*Keywords)/);
    setPick({ title: p.title, abstract: (m?.[1] ?? "").trim().slice(0, 2500), key: id + Date.now() });
  };
  return (
    <div className="space-y-6">
      <div className="card card-pop relative overflow-hidden bg-blue p-6 text-white md:p-8">
        <motion.div className="pointer-events-none absolute -right-6 -top-8 text-[150px] opacity-20" animate={{ y: [0, -10, 0] }} transition={{ repeat: Infinity, duration: 4 }}>🎯</motion.div>
        <div className="relative max-w-2xl">
          <span className="sticker bg-yellow text-[#121212]">Publish assistance</span>
          <h2 className="mt-3 font-display text-4xl font-extrabold">Find the right journal or conference</h2>
          <p className="mt-1 opacity-90">We look at where the most similar recent papers were published and rank those venues for your paper,
            with open-access, DOAJ, APC fee and h-index info. Then submit through the venue&apos;s system.</p>
        </div>
      </div>

      {papers.length > 0 && (
        <Card className="p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-extrabold"><FileText className="size-4" />Match a paper you wrote here</div>
          <div className="flex flex-wrap gap-2">
            {papers.slice(0, 6).map((p) => (
              <motion.button key={p.paper_id} whileHover={{ y: -2 }} onClick={() => usePaper(p.paper_id)}
                className="btn-brut max-w-xs truncate rounded-xl bg-surface px-3 py-1.5 text-left text-xs font-bold">{p.title}</motion.button>
            ))}
          </div>
        </Card>
      )}

      <VenueFinder key={pick?.key ?? "blank"} title={pick?.title ?? ""} abstract={pick?.abstract ?? ""} />

      <div>
        <div className="mb-3 flex items-center gap-2 font-display text-xl font-extrabold"><Send className="size-5" />Submit & check venues</div>
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
