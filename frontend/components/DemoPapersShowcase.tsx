"use client";

import clsx from "clsx";
import { BookOpen, Download, ExternalLink, FileCheck2, ShieldCheck, Sparkles, Wand2, X } from "lucide-react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { API, api, toast } from "@/lib/api";
import type { DocumentInfo } from "@/lib/types";
import { Button, Card } from "./ui";

export interface DemoPaper {
  slug: string;
  acronym: string;
  title: string;
  authors: string;
  affiliation: string;
  venue_style: string;
  pages: number;
  words: number;
  n_references: number;
  filename: string;
  summary: string;
  highlights: string[];
  topic_seed: string;
  angle_seed: string;
  document_id?: string;
  pdf_url: string;
  download_url: string;
}

const FALLBACK_PAPERS: DemoPaper[] = [
  {
    slug: "aditi",
    acronym: "ADITI",
    title: "ADITI: Adaptive Drift-aware Intervals for Time-series Inference",
    authors: "Ayush Upadhyay",
    affiliation: "Vellore Institute of Technology (VIT), Chennai",
    venue_style: "IEEE Monograph · Online Conformal Prediction",
    pages: 21,
    words: 12949,
    n_references: 25,
    filename: "ADITI_Drift_Aware_Conformal_Intervals.pdf",
    summary:
      "Distribution-free online conformal intervals combining dual-EMA volatility scale normalization with multi-timescale quantile tracking, complete with finite-sample long-run coverage proofs, O(1) per-step complexity, 12 tables, and explicit failure-mode bounds.",
    highlights: [
      "Propositions 1–3 + formal proofs",
      "Algorithm 1 · O(1) time & space",
      "12 tables incl. notation & ablations",
      "Explicit failure-mode analysis",
    ],
    topic_seed: "Adaptive conformal prediction intervals under non-stationary concept drift in time series",
    angle_seed:
      "Combine volatility-normalized residual scoring with multi-timescale online quantile tracking and prove finite-sample coverage bounds alongside failure-mode conditions.",
    pdf_url: "/api/demo-papers/aditi/pdf",
    download_url: "/api/demo-papers/aditi/pdf?download=1",
  },
  {
    slug: "aliza",
    acronym: "ALIZA",
    title: "ALIZA: Autonomous Learning Intelligence for Zero-trust Agents",
    authors: "Ayush Upadhyay, Aliza Bano, and Kumaran K",
    affiliation: "Vellore Institute of Technology (VIT), Chennai",
    venue_style: "IEEE Security Architecture · Zero-Trust LLM Agents",
    pages: 20,
    words: 13374,
    n_references: 31,
    filename: "ALIZA_Zero_Trust_Agents_20pp.pdf",
    summary:
      "Zero-trust reference monitor for tool-using LLM agents featuring task-scoped capability synthesis, multi-signal behavioral risk scoring, and cryptographic hash-chained audit logging against indirect prompt injection and confused-deputy privilege escalation.",
    highlights: [
      "Formal threat model & safety invariants",
      "Hash-chain tamper-evidence theorem",
      "13 tables + capability lattice design",
      "Honest trust-creep boundary analysis",
    ],
    topic_seed: "Zero-trust capability attenuation and behavioral anomaly detection for tool-using LLM agents",
    angle_seed:
      "Enforce task-scoped least-privilege capability tokens at an external deterministic reference monitor with cryptographic hash-chained audit logs.",
    pdf_url: "/api/demo-papers/aliza/pdf",
    download_url: "/api/demo-papers/aliza/pdf?download=1",
  },
  {
    slug: "cast",
    acronym: "CAST",
    title: "Chiral Amplification Self-Training: An Exact Asymmetric-Catalysis Theory of Agreement-Filtered Pseudo-Labeling",
    authors: "Ayush Upadhyay and Shivam Goel",
    affiliation: "Vellore Institute of Technology (VIT)",
    venue_style: "IEEE Access · Statistical Learning Theory",
    pages: 19,
    words: 14779,
    n_references: 57,
    filename: "CAST_IEEE_Access_Paper.pdf",
    summary:
      "Exact dynamical theory mapping Soai asymmetric autocatalysis onto multi-view agreement-filtered pseudo-labeling via a scalar chiral excess order parameter, deriving pitchfork bifurcation thresholds, Lyapunov convergence rates, and finite-pool Kramers escape bounds.",
    highlights: [
      "Exact bifurcation & Lyapunov theorems",
      "57 verified ML & chemistry references",
      "IEEE Access two-column monograph",
      "Stochastic drift-diffusion & ablations",
    ],
    topic_seed: "Theoretical dynamics of agreement-filtered pseudo-labeling and confirmation bias in semi-supervised learning",
    angle_seed:
      "Formulate multi-view pseudo-label confirmation bias as a nonlinear dynamical system with exact fixed-point stability and finite-sample variance bounds.",
    pdf_url: "/api/demo-papers/cast/pdf",
    download_url: "/api/demo-papers/cast/pdf?download=1",
  },
];

const ACCENTS = ["bg-lime", "bg-yellow", "bg-pink"] as const;

function useDemoPapers() {
  const [papers, setPapers] = useState<DemoPaper[]>(FALLBACK_PAPERS);
  useEffect(() => {
    api.get<DemoPaper[]>("/api/demo-papers").then((rows) => {
      if (Array.isArray(rows) && rows.length > 0) setPapers(rows);
    }).catch(() => {});
  }, []);
  return papers;
}

function PdfPreviewModal({ paper, onClose }: { paper: DemoPaper | null; onClose: () => void }) {
  useEffect(() => {
    if (!paper) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paper, onClose]);

  const pdfHref = paper ? `${API}${paper.pdf_url}` : "";
  const dlHref = paper ? `${API}${paper.download_url}` : "";

  return (
    <AnimatePresence>
      {paper && (
        <motion.div
          className="fixed inset-0 z-50 grid place-items-center p-3 sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={paper.title}
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            className="card relative flex h-[90vh] w-full max-w-5xl flex-col overflow-hidden !bg-surface"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 border-b-[2.5px] border-edge bg-surface-2 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-[11px] font-extrabold uppercase tracking-wider text-muted">
                  <span className="rounded-full border-2 border-edge bg-yellow px-2 py-0.5 text-[#121212]">{paper.acronym}</span>
                  <span>{paper.pages} pages · {paper.words.toLocaleString()} words · {paper.n_references} references</span>
                </div>
                <div className="mt-0.5 truncate font-display text-base font-extrabold">{paper.title}</div>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={pdfHref}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-brut inline-flex items-center gap-1.5 rounded-xl bg-surface px-3 py-1.5 font-display text-xs font-extrabold"
                >
                  <ExternalLink className="size-3.5" /> New tab
                </a>
                <a
                  href={dlHref}
                  className="btn-brut inline-flex items-center gap-1.5 rounded-xl bg-lime px-3 py-1.5 font-display text-xs font-extrabold text-[#121212]"
                >
                  <Download className="size-3.5" /> Download PDF
                </a>
                <button
                  onClick={onClose}
                  aria-label="Close PDF preview"
                  className="btn-brut grid size-8 place-items-center rounded-xl bg-surface"
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>
            <iframe src={pdfHref} title={paper.title} className="min-h-0 w-full flex-1 bg-white" />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function LandingDemoPapers() {
  const papers = useDemoPapers();
  const [preview, setPreview] = useState<DemoPaper | null>(null);

  return (
    <section id="demos" className="mx-auto max-w-[1240px] scroll-mt-24 px-5 py-16">
      <div className="mb-10 text-center">
        <div className="sticker mx-auto mb-4 -rotate-1 bg-lime text-[#121212]">
          <BookOpen className="size-4" /> Benchmark demo papers
        </div>
        <h2 className="font-display text-4xl font-extrabold md:text-5xl">
          Read full <span className="gradient-text">20-page research monographs</span>
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-ink-2">
          Explore three complete IEEE-style exemplar papers bundled with Cite &amp; Slayy — complete with formal notation tables,
          theorems &amp; proofs, algorithms, ablation matrices, and verified bibliographies. Read the PDFs or audit them live in CiteGuard.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {papers.map((p, i) => (
          <motion.div
            key={p.slug}
            whileHover={{ y: -5 }}
            className="card card-pop flex h-full flex-col justify-between p-6"
          >
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className={clsx("sticker text-xs text-[#121212]", ACCENTS[i % ACCENTS.length])}>
                  {p.acronym} · {p.pages} pp.
                </span>
                <span className="rounded-full border-2 border-edge bg-surface-2 px-2.5 py-0.5 font-mono text-[11px] font-bold">
                  {p.words.toLocaleString()} words · {p.n_references} refs
                </span>
              </div>
              <div className="mt-3 text-[11px] font-extrabold uppercase tracking-wider text-muted">{p.venue_style}</div>
              <h3 className="mt-1 font-display text-xl font-extrabold leading-snug">{p.title}</h3>
              <p className="mt-1 text-xs font-semibold text-ink-2">
                {p.authors} · <span className="text-muted">{p.affiliation}</span>
              </p>
              <p className="mt-3 text-sm leading-relaxed text-ink-2">{p.summary}</p>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {p.highlights.map((h) => (
                  <span
                    key={h}
                    className="inline-flex items-center gap-1 rounded-lg border-[1.8px] border-edge bg-surface-2 px-2 py-0.5 text-[11px] font-bold"
                  >
                    <FileCheck2 className="size-3 text-good" /> {h}
                  </span>
                ))}
              </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-2 border-t-2 border-dashed border-line pt-4">
              <button
                onClick={() => setPreview(p)}
                className="btn-brut inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-yellow px-3.5 py-2 font-display text-xs font-extrabold text-[#121212]"
              >
                <BookOpen className="size-3.5" /> Read PDF
              </button>
              <a
                href={`${API}${p.download_url}`}
                className="btn-brut inline-flex items-center justify-center gap-1 rounded-xl bg-surface px-3 py-2 font-display text-xs font-extrabold"
                title="Download PDF"
              >
                <Download className="size-3.5" />
              </a>
              <Link
                href={p.document_id ? `/app?tab=audit&doc=${p.document_id}` : "/app?tab=audit"}
                className="btn-brut inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-blue px-3.5 py-2 font-display text-xs font-extrabold text-white"
              >
                <ShieldCheck className="size-3.5" /> Audit paper
              </Link>
            </div>
          </motion.div>
        ))}
      </div>

      <PdfPreviewModal paper={preview} onClose={() => setPreview(null)} />
    </section>
  );
}

export function StudioDemoPapers({
  onUseSeed,
  onAuditDoc,
}: {
  onUseSeed: (doc: { id: string; name: string }, topic: string, angle: string) => void;
  onAuditDoc: (docId: string) => void;
}) {
  const papers = useDemoPapers();
  const [preview, setPreview] = useState<DemoPaper | null>(null);
  const [busySlug, setBusySlug] = useState<string | null>(null);

  const importAndUse = async (p: DemoPaper, mode: "seed" | "audit") => {
    setBusySlug(`${p.slug}:${mode}`);
    try {
      const info = await api.post<DocumentInfo>(`/api/demo-papers/${p.slug}/import`, {});
      if (mode === "seed") {
        onUseSeed({ id: info.document_id, name: `${p.acronym} (${p.pages} pp.)` }, p.topic_seed, p.angle_seed);
        toast({
          title: `${p.acronym} loaded as study seed`,
          body: "Topic, technical angle, and verified seed references are ready.",
          tone: "good",
        });
      } else {
        onAuditDoc(info.document_id);
      }
    } catch (e) {
      toast({ title: "Couldn't load demo paper", body: (e as Error).message, tone: "crit" });
    } finally {
      setBusySlug(null);
    }
  };

  return (
    <Card className="p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="sticker bg-lime text-xs text-[#121212]">
            <Sparkles className="size-3.5" /> Exemplar monographs
          </span>
          <span className="font-display text-lg font-extrabold">Featured 20-page demo research papers</span>
        </div>
        <span className="text-xs text-muted">
          Read the benchmark PDFs, use one as a study seed, or audit its references in CiteGuard
        </span>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        {papers.map((p, i) => (
          <div key={p.slug} className="flex flex-col justify-between rounded-2xl border-[2.5px] border-edge bg-surface-2/65 p-4">
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className={clsx("rounded-full border-2 border-edge px-2.5 py-0.5 font-display text-xs font-extrabold text-[#121212]", ACCENTS[i % ACCENTS.length])}>
                  {p.acronym}
                </span>
                <span className="font-mono text-[11px] text-muted">
                  {p.pages} pp · {p.words.toLocaleString()}w · {p.n_references} refs
                </span>
              </div>
              <div className="mt-2 line-clamp-2 font-display text-sm font-extrabold leading-snug">{p.title}</div>
              <div className="mt-0.5 text-[11px] text-muted">{p.authors} · {p.venue_style.split("·")[0].trim()}</div>
              <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-ink-2">{p.summary}</p>
              <div className="mt-2.5 flex flex-wrap gap-1">
                {p.highlights.slice(0, 3).map((h) => (
                  <span key={h} className="rounded-md border border-edge/40 bg-surface px-1.5 py-0.5 text-[10px] font-semibold">
                    {h}
                  </span>
                ))}
              </div>
            </div>

            <div className="mt-3.5 flex flex-wrap gap-1.5 pt-2">
              <Button variant="ghost" className="!px-2.5 !py-1 text-xs" onClick={() => setPreview(p)}>
                <BookOpen className="size-3.5" /> Read PDF
              </Button>
              <Button
                variant="lime"
                className="!px-2.5 !py-1 text-xs"
                loading={busySlug === `${p.slug}:seed`}
                onClick={() => importAndUse(p, "seed")}
              >
                <Wand2 className="size-3.5" /> Seed + Topic
              </Button>
              <Button
                variant="blue"
                className="!px-2.5 !py-1 text-xs"
                loading={busySlug === `${p.slug}:audit`}
                onClick={() => importAndUse(p, "audit")}
              >
                <ShieldCheck className="size-3.5" /> Audit
              </Button>
            </div>
          </div>
        ))}
      </div>

      <PdfPreviewModal paper={preview} onClose={() => setPreview(null)} />
    </Card>
  );
}

