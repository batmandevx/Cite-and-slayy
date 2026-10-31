"use client";

import clsx from "clsx";
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  Copy,
  Crown,
  Download,
  ExternalLink,
  FileCheck2,
  FileText,
  KeyRound,
  Lock,
  Printer,
  ShieldAlert,
  Sparkles,
  Upload,
  Wand2,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, toast } from "@/lib/api";
import { useAuth } from "./auth/AuthProvider";
import type { DemoPaper } from "./DemoPapersShowcase";
import { Badge, Button, Card } from "./ui";

interface SentenceMatch {
  source_id: number;
  color: string;
  kind: "verbatim" | "paraphrase";
  similarity: number;
  ngram_overlap: number;
  matched_sentence: string;
  shared_phrases?: string[];
  cited?: boolean;
  source_title: string;
  source_venue?: string | null;
  source_year?: number | null;
  source_url: string;
}

interface AnnotatedSentence {
  id: string;
  paragraph_index: number;
  sentence_index: number;
  text: string;
  words: number;
  match: SentenceMatch | null;
  ai_score: number;
  ai_band: "high" | "moderate" | "low";
  ai_reasons: string[];
}

interface AnnotatedParagraph {
  index: number;
  kind: "prose" | "heading" | "block";
  raw: string;
  burstiness_cv: number | null;
  sentences: AnnotatedSentence[];
}

interface MatchedSource {
  id: number;
  color: string;
  title: string;
  authors: string[];
  year?: number | null;
  venue?: string | null;
  doi?: string | null;
  url: string;
  matched_words: number;
  occurrences: number;
  pct: number;
}

interface OriginalityReport {
  scan_id: string;
  document_id?: string | null;
  paper_id?: string | null;
  title: string;
  total_words: number;
  similarity_pct: number;
  verbatim_pct: number;
  paraphrase_pct: number;
  ai_pct: number;
  burstiness_cv: number;
  cliche_count: number;
  flagged_count: number;
  sources_checked: number;
  sources: MatchedSource[];
  paragraphs: AnnotatedParagraph[];
  clean_text: string;
  methodology: string;
  warnings?: string[];
  created_at?: string;
}

interface ReduceMetrics {
  similarity_pct: number;
  verbatim_pct: number;
  paraphrase_pct: number;
  ai_pct: number;
  burstiness_cv: number;
  cliche_count: number;
  flagged_count: number;
}

interface ReduceResponse {
  before_scan_id: string;
  after_scan_id: string;
  mode: "both" | "plagiarism" | "ai";
  paragraphs_rewritten: number;
  cleaned_text: string;
  before: ReduceMetrics;
  after: ReduceMetrics;
  changes: { paragraph_index: number; before: string; after: string; note: string }[];
  after_scan: OriginalityReport;
}

const SAMPLE_AI_PLAG_TEXT = `Adaptive Conformal Prediction in Streaming Systems

In the realm of real-time decision systems, uncertainty quantification plays a pivotal role in safeguarding downstream actions. Moreover, distribution-free conformal prediction delves into finite-sample coverage guarantees without parametric assumptions, highlighting its multifaceted appeal across safety-critical deployments. Notably, standard split conformal calibration assumes exchangeability between historical calibration residuals and future test observations, underscoring the fragility of fixed quantile thresholds under regime shifts.

Furthermore, online adaptive conformal inference updates miscoverage levels via gradient-like step sizes on the pinball loss, seamlessly tracking non-stationary covariate and concept drift. This framework meticulously balances interval tightness against empirical coverage stability, paving the way for trustworthy autonomous forecasting. However, abrupt volatility jumps still induce transient under-coverage windows before the adaptive threshold catches up, showcasing an intricate interplay between step-size responsiveness and post-shift variance.`;

interface LineFix { before: string; after: string; action: "rewrite" | "quote"; citation_added: boolean; overlap_before: number; overlap_after: number | null }

/** Highlights the exact runs of words a line shares with its matched source. */
function SharedText({ text, phrases }: { text: string; phrases: string[] }) {
  if (!phrases.length) return <>{text}</>;
  const esc = phrases.map((p) => p.split(" ").map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^A-Za-z0-9]+"));
  const re = new RegExp(`(${esc.join("|")})`, "gi");
  return <>{text.split(re).map((part, i) => (i % 2 ? <mark key={i} className="rounded bg-crit/25 px-0.5 text-ink">{part}</mark> : <span key={i}>{part}</span>))}</>;
}

/** Selected flagged line: what exactly overlaps, whether it's cited, and honest fixes. */
function LineFixPanel({ scanId, sent }: { scanId: string; sent: AnnotatedSentence }) {
  const [busy, setBusy] = useState<"rewrite" | "quote" | null>(null);
  const [fix, setFix] = useState<LineFix | null>(null);
  const m = sent.match!;
  const run = async (action: "rewrite" | "quote") => {
    setBusy(action);
    try { setFix(await api.post<LineFix>("/api/originality/fix-line", { scan_id: scanId, sentence_id: sent.id, action })); }
    catch (e) { toast({ title: "Couldn't fix this line", body: (e as Error).message, tone: "crit" }); }
    finally { setBusy(null); }
  };
  return (
    <div className="rounded-xl border-2 border-edge bg-surface p-3 text-xs">
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <span className="font-display text-[11px] font-extrabold uppercase tracking-wider text-muted">Selected line</span>
        <span className="rounded-full border border-edge px-1.5 text-[10px] font-extrabold" style={{ backgroundColor: `${m.color}30` }}>[{m.source_id}] {m.kind}</span>
        <span className={clsx("rounded-full border px-1.5 text-[10px] font-extrabold", m.cited ? "border-good bg-good/15 text-good" : "border-crit bg-crit/15 text-crit-ink")}>
          {m.cited ? "has a citation" : "no citation"}</span>
      </div>
      <p className="leading-relaxed text-ink"><SharedText text={sent.text} phrases={m.shared_phrases ?? []} /></p>
      {(m.shared_phrases?.length ?? 0) > 0 && <p className="mt-1 text-[10.5px] text-muted">Highlighted: word-for-word runs shared with the source.</p>}
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Button className="!px-2.5 !py-1 text-[11px]" loading={busy === "rewrite"} onClick={() => run("rewrite")}>Rewrite &amp; cite</Button>
        {m.kind === "verbatim" && <Button variant="ghost" className="!px-2.5 !py-1 text-[11px]" loading={busy === "quote"} onClick={() => run("quote")}>Quote &amp; cite</Button>}
      </div>
      {fix && (
        <div className="mt-2.5 space-y-1.5 rounded-lg border border-edge/40 bg-surface-2 p-2.5">
          <div className="text-[10.5px] font-bold uppercase text-muted">Suggested line ({fix.action === "rewrite" ? "own words" : "quoted"}{fix.citation_added ? ", citation added" : ""})</div>
          <p className="text-ink">{fix.after}</p>
          {fix.overlap_after !== null && <p className="text-[10.5px] text-good">Shared 4-word phrases with the source: {Math.round(fix.overlap_before * 100)}% → {Math.round(fix.overlap_after * 100)}%</p>}
          <button className="text-[11px] font-bold underline" onClick={() => { navigator.clipboard.writeText(fix.after); toast({ title: "Copied fixed line", tone: "good" }); }}>Copy</button>
        </div>
      )}
    </div>
  );
}

function GaugeRing({
  label,
  pct,
  sub,
  thresholds = [15, 30],
}: {
  label: string;
  pct: number;
  sub: string;
  thresholds?: [number, number];
}) {
  const color =
    pct < thresholds[0] ? "#16a34a" : pct < thresholds[1] ? "#ea580c" : "#e11d48";
  const badge =
    pct < thresholds[0] ? "Low risk" : pct < thresholds[1] ? "Moderate" : "High alert";
  return (
    <div className="flex items-center gap-3.5 rounded-2xl border-[2.5px] border-edge bg-surface p-3.5 shadow-[3px_3px_0_var(--shadow-c)]">
      <div
        className="grid size-16 shrink-0 place-items-center rounded-full border-[2.5px] border-edge font-display text-base font-extrabold"
        style={{ background: `conic-gradient(${color} ${Math.min(100, pct) * 3.6}deg, var(--surface-3) 0)` }}
      >
        <span className="grid size-12 place-items-center rounded-full bg-surface tabular-nums">
          {Math.round(pct)}%
        </span>
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-display text-sm font-extrabold">{label}</span>
          <span
            className="rounded-full border border-edge px-1.5 py-0.2 text-[10px] font-extrabold uppercase text-white"
            style={{ backgroundColor: color }}
          >
            {badge}
          </span>
        </div>
        <div className="mt-0.5 text-xs text-ink-2">{sub}</div>
      </div>
    </div>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function printTurnitinReceipt(rep: OriginalityReport) {
  const win = window.open("", "_blank");
  if (!win) {
    toast({ title: "Pop-up blocked", body: "Allow pop-ups to print the originality receipt.", tone: "accent" });
    return;
  }
  const parasHtml = rep.paragraphs
    .map((p) => {
      if (p.kind === "heading") {
        return `<h3 style="margin:18px 0 6px;font-size:13pt;font-weight:700;">${escapeHtml(p.raw.replace(/^#+\s*/, ""))}</h3>`;
      }
      if (p.kind !== "prose") {
        return `<pre style="font-size:9pt;background:#f5f5f5;padding:8px;border-radius:6px;">${escapeHtml(p.raw)}</pre>`;
      }
      const sents = p.sentences
        .map((s) => {
          let style = "";
          let sup = "";
          if (s.match) {
            style += `background:${s.match.color}22;border-bottom:2px solid ${s.match.color};padding:1px 2px;border-radius:3px;`;
            sup += `<sup style="background:${s.match.color};color:#fff;font-weight:700;padding:0 4px;border-radius:4px;font-size:7.5pt;margin-left:2px;">[${s.match.source_id}]</sup>`;
          } else if (s.ai_band !== "low") {
            const ac = s.ai_band === "high" ? "#7c3aed" : "#d97706";
            style += `background:${ac}18;border-bottom:1.5px dashed ${ac};padding:1px 2px;`;
            sup += `<sup style="color:${ac};font-weight:700;font-size:7.5pt;margin-left:2px;">[AI]</sup>`;
          }
          return `<span style="${style}">${escapeHtml(s.text)}${sup}</span>`;
        })
        .join(" ");
      return `<p style="margin:0 0 10px;line-height:1.58;text-align:justify;">${sents}</p>`;
    })
    .join("\n");

  const sourcesHtml = rep.sources.length
    ? rep.sources
        .map(
          (s) =>
            `<tr>
              <td style="padding:6px 8px;border-bottom:1px solid #ddd;font-weight:700;color:${s.color};">[${s.id}]</td>
              <td style="padding:6px 8px;border-bottom:1px solid #ddd;"><b>${escapeHtml(s.title)}</b><br/><span style="font-size:8.5pt;color:#555;">${escapeHtml(s.venue || "")} (${s.year || "n.d."}) · ${escapeHtml(s.url)}</span></td>
              <td style="padding:6px 8px;border-bottom:1px solid #ddd;text-align:right;font-weight:700;">${s.pct}% (${s.matched_words}w)</td>
            </tr>`,
        )
        .join("")
    : `<tr><td colspan="3" style="padding:10px;color:#555;">0 matched external scholarly sources above threshold.</td></tr>`;

  win.document.write(`<!doctype html><html><head><title>Originality & AI Report — ${escapeHtml(rep.title)}</title>
    <style>
      body { font-family: Georgia, "Times New Roman", serif; max-width: 820px; margin: 28px auto; color: #111; font-size: 10.5pt; padding: 0 20px; }
      .hdr { border: 2px solid #111; border-radius: 10px; padding: 16px 20px; background: #fafafa; margin-bottom: 20px; font-family: system-ui, sans-serif; }
      .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-top: 12px; }
      .kpi { border: 1.5px solid #222; border-radius: 8px; padding: 10px; background: #fff; }
      table { width: 100%; border-collapse: collapse; font-family: system-ui, sans-serif; font-size: 9.5pt; margin-bottom: 22px; }
    </style></head><body>
    <div class="hdr">
      <div style="font-size:9pt;text-transform:uppercase;letter-spacing:0.08em;color:#555;font-weight:700;">Cite &amp; Slayy · Originality &amp; Stylometric AI Receipt · ID ${escapeHtml(rep.scan_id)}</div>
      <h1 style="margin:6px 0 4px;font-size:16pt;">${escapeHtml(rep.title)}</h1>
      <div style="font-size:9pt;color:#444;">Words scanned: ${rep.total_words.toLocaleString()} · OpenAlex sources checked: ${rep.sources_checked} · Generated: ${new Date().toLocaleString()}</div>
      <div class="grid">
        <div class="kpi"><div style="font-size:8.5pt;color:#555;">Similarity Index</div><div style="font-size:18pt;font-weight:800;">${rep.similarity_pct}%</div><div style="font-size:8pt;">Verbatim ${rep.verbatim_pct}% · Paraphrase ${rep.paraphrase_pct}%</div></div>
        <div class="kpi"><div style="font-size:8.5pt;color:#555;">AI Stylometric Indicator</div><div style="font-size:18pt;font-weight:800;">${rep.ai_pct}%</div><div style="font-size:8pt;">Clichés: ${rep.cliche_count}</div></div>
        <div class="kpi"><div style="font-size:8.5pt;color:#555;">Burstiness (CV)</div><div style="font-size:18pt;font-weight:800;">${rep.burstiness_cv}</div><div style="font-size:8pt;">Human target &ge; 0.30</div></div>
        <div class="kpi"><div style="font-size:8.5pt;color:#555;">Flagged Lines</div><div style="font-size:18pt;font-weight:800;">${rep.flagged_count}</div><div style="font-size:8pt;">Matched sources: ${rep.sources.length}</div></div>
      </div>
    </div>
    <h2 style="font-family:system-ui,sans-serif;font-size:12pt;border-bottom:2px solid #111;padding-bottom:4px;">Primary Matched Scholarly Sources (OpenAlex)</h2>
    <table><tbody>${sourcesHtml}</tbody></table>
    <h2 style="font-family:system-ui,sans-serif;font-size:12pt;border-bottom:2px solid #111;padding-bottom:4px;">Annotated Manuscript</h2>
    ${parasHtml}
    <hr style="margin-top:24px;"/><p style="font-size:8.5pt;color:#555;font-family:system-ui,sans-serif;">${escapeHtml(rep.methodology)}</p>
    <script>window.onload = () => setTimeout(() => window.print(), 250);</script>
  </body></html>`);
  win.document.close();
}

export function TurnitinTab({
  initialPaperId,
  initialDocumentId,
  onOpenStudio,
}: {
  initialPaperId?: string | null;
  initialDocumentId?: string | null;
  onOpenStudio?: (paperId: string) => void;
}) {
  const { me, config, openUpgrade, refresh } = useAuth();
  const canUse = !config?.auth_required || Boolean(me?.is_paid || me?.is_owner);

  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [activePaperId, setActivePaperId] = useState<string | null>(initialPaperId ?? null);
  const [excludeRefs, setExcludeRefs] = useState(true);
  const [excludeQuotes, setExcludeQuotes] = useState(true);

  const [papers, setPapers] = useState<{ paper_id: string; title: string; words?: number }[]>([]);
  const [demos, setDemos] = useState<DemoPaper[]>([]);

  const [scanning, setScanning] = useState(false);
  const [reducing, setReducing] = useState(false);
  const [applyingStudio, setApplyingStudio] = useState(false);

  const [originalScan, setOriginalScan] = useState<OriginalityReport | null>(null);
  const [reducedResult, setReducedResult] = useState<ReduceResponse | null>(null);
  const [viewingVersion, setViewingVersion] = useState<"original" | "cleaned">("original");

  const [layer, setLayer] = useState<"all" | "similarity" | "ai">("all");
  const [filterSourceId, setFilterSourceId] = useState<number | null>(null);
  const [inspectorTab, setInspectorTab] = useState<"sources" | "ai" | "diff">("sources");
  const [selectedSentId, setSelectedSentId] = useState<string | null>(null);
  const [reduceMode, setReduceMode] = useState<"both" | "plagiarism" | "ai">("both");
  const [copied, setCopied] = useState(false);

  // Dev owner unlock helper when AUTH_REQUIRED=true
  const [ownerKeyOpen, setOwnerKeyOpen] = useState(false);
  const [ownerKey, setOwnerKey] = useState("");
  const [unlockingOwner, setUnlockingOwner] = useState(false);

  useEffect(() => {
    api.get<typeof papers>("/api/paper-studio").then(setPapers).catch(() => {});
    api.get<DemoPaper[]>("/api/demo-papers").then(setDemos).catch(() => {});
  }, []);

  const runScanPayload = useCallback(
    async (payload: {
      text?: string;
      title?: string;
      document_id?: string | null;
      paper_id?: string | null;
    }) => {
      setScanning(true);
      setReducedResult(null);
      setViewingVersion("original");
      setFilterSourceId(null);
      setSelectedSentId(null);
      try {
        const rep = await api.post<OriginalityReport>("/api/originality/scan", {
          text: payload.text ?? "",
          title: payload.title ?? "",
          document_id: payload.document_id ?? null,
          paper_id: payload.paper_id ?? null,
          exclude_references: excludeRefs,
          exclude_quotes: excludeQuotes,
        });
        setOriginalScan(rep);
        setTitle(rep.title);
        setText(rep.clean_text);
        setActivePaperId(rep.paper_id ?? payload.paper_id ?? null);
        setInspectorTab(rep.sources.length > 0 ? "sources" : "ai");
      } catch (e) {
        toast({ title: "Originality scan failed", body: (e as Error).message, tone: "crit" });
      } finally {
        setScanning(false);
      }
    },
    [excludeQuotes, excludeRefs],
  );

  // Auto-scan if deep-linked from Paper Studio or CiteGuard Audit
  useEffect(() => {
    if (!canUse) return;
    if (!initialPaperId && !initialDocumentId) return;
    const timer = window.setTimeout(() => {
      if (initialPaperId) {
        void runScanPayload({ paper_id: initialPaperId });
      } else if (initialDocumentId) {
        void runScanPayload({ document_id: initialDocumentId });
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [canUse, initialPaperId, initialDocumentId, runScanPayload]);

  const handleUploadFile = async (file: File) => {
    setScanning(true);
    try {
      const doc = await api.upload<{ document_id: string; title?: string }>("/api/documents", file);
      await runScanPayload({ document_id: doc.document_id, title: doc.title ?? file.name });
    } catch (e) {
      setScanning(false);
      toast({ title: "Upload failed", body: (e as Error).message, tone: "crit" });
    }
  };

  const handleScanDemo = async (slug: string) => {
    setScanning(true);
    try {
      const doc = await api.post<{ document_id: string; title: string }>(`/api/demo-papers/${slug}/import`);
      await runScanPayload({ document_id: doc.document_id, title: doc.title });
    } catch (e) {
      setScanning(false);
      toast({ title: "Couldn't load demo paper", body: (e as Error).message, tone: "crit" });
    }
  };

  const handleReduce = async () => {
    const baseScan = viewingVersion === "cleaned" && reducedResult ? reducedResult.after_scan : originalScan;
    if (!baseScan && text.trim().split(/\s+/).length < 20) {
      toast({ title: "Scan or paste at least 20 words first", tone: "accent" });
      return;
    }
    setReducing(true);
    try {
      const res = await api.post<ReduceResponse>("/api/originality/reduce", {
        scan_id: baseScan?.scan_id ?? null,
        text: baseScan ? "" : text,
        title,
        mode: reduceMode,
      });
      setReducedResult(res);
      setViewingVersion("cleaned");
      setInspectorTab("diff");
      setText(res.cleaned_text);
      toast({
        title: `Rewrote ${res.paragraphs_rewritten} flagged paragraph(s) ✨`,
        body: `Similarity ${res.before.similarity_pct}% → ${res.after.similarity_pct}% · AI ${res.before.ai_pct}% → ${res.after.ai_pct}%`,
        tone: "good",
      });
    } catch (e) {
      toast({ title: "AI & Plagiarism Reducer failed", body: (e as Error).message, tone: "crit" });
    } finally {
      setReducing(false);
    }
  };

  const handleApplyToStudio = async () => {
    if (!activePaperId || !reducedResult) return;
    setApplyingStudio(true);
    try {
      await api.post(`/api/paper-studio/${activePaperId}/replace-markdown`, {
        markdown: reducedResult.cleaned_text,
        preserve_references: true,
      });
      toast({
        title: "Applied to Paper Studio! 🎉",
        body: "Cleaned prose saved (previous draft kept in Paper Studio Undo history).",
        tone: "good",
      });
      onOpenStudio?.(activePaperId);
    } catch (e) {
      toast({ title: "Couldn't update Paper Studio draft", body: (e as Error).message, tone: "crit" });
    } finally {
      setApplyingStudio(false);
    }
  };

  const handleUnlockOwner = async () => {
    if (!ownerKey.trim()) return;
    setUnlockingOwner(true);
    try {
      await api.post("/api/auth/owner-unlock", { key: ownerKey.trim() });
      await refresh();
      setOwnerKey("");
      setOwnerKeyOpen(false);
      toast({ title: "Dev Owner Unlocked 👑", body: "All paid features & unlimited quotas enabled.", tone: "good" });
    } catch (e) {
      toast({ title: "Invalid Dev Owner key", body: (e as Error).message, tone: "crit" });
    } finally {
      setUnlockingOwner(false);
    }
  };

  const activeReport = useMemo(
    () => (viewingVersion === "cleaned" && reducedResult ? reducedResult.after_scan : originalScan),
    [viewingVersion, reducedResult, originalScan],
  );

  const aiFlaggedSentences = useMemo(() => {
    if (!activeReport) return [];
    return activeReport.paragraphs
      .flatMap((p) => p.sentences)
      .filter((s) => s.ai_band === "high" || s.ai_band === "moderate")
      .sort((a, b) => b.ai_score - a.ai_score);
  }, [activeReport]);

  const copyCleaned = async () => {
    const target = reducedResult?.cleaned_text ?? activeReport?.clean_text ?? text;
    if (!target) return;
    await navigator.clipboard.writeText(target);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
    toast({ title: "Copied manuscript text to clipboard", tone: "good" });
  };

  const downloadMarkdown = () => {
    const target = reducedResult?.cleaned_text ?? activeReport?.clean_text ?? text;
    if (!target) return;
    const blob = new Blob([`# ${title || "Manuscript"}\n\n${target}\n`], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(title || "manuscript").replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 50)}-clean.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Hero Banner */}
      <div className="card card-pop relative overflow-hidden bg-[linear-gradient(125deg,#18181b_0%,#311042_55%,#4c1d95_100%)] p-6 text-white md:p-8">
        <motion.div
          className="pointer-events-none absolute -right-6 -top-8 text-[140px] opacity-20"
          animate={{ rotate: [0, 5, -5, 0] }}
          transition={{ repeat: Infinity, duration: 6 }}
        >
          🛡️
        </motion.div>
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="sticker bg-yellow text-[#121212]">Paid Pro · Turnitin-Style Engine</span>
              {me?.is_owner && (
                <span className="sticker inline-flex items-center gap-1 bg-lime text-[#121212]">
                  <Crown className="size-3.5" /> Dev Owner · Unlimited
                </span>
              )}
            </div>
            <h2 className="mt-3 font-display text-3xl font-extrabold md:text-4xl">
              AI &amp; Plagiarism Originality Report + Reducer
            </h2>
            <p className="mt-1.5 text-sm text-white/85 md:text-base">
              Line-by-line color-coded similarity highlights matched against real OpenAlex scholarly papers, transparent
              stylometric AI-writing detection, and 1-click ethical AI &amp; Plagiarism Reduction with verified{" "}
              <b>Before% → After%</b> re-scoring.
            </p>
          </div>
          {activeReport && (
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" className="!border-white/40 !bg-white/10 !text-white hover:!bg-white/20 text-xs" onClick={() => printTurnitinReceipt(activeReport)}>
                <Printer className="size-3.5" /> Print Turnitin PDF Receipt
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Paid Plan Gate for Free Non-Owner Users */}
      {!canUse ? (
        <Card className="relative overflow-hidden border-[3px] border-edge p-6 md:p-8">
          <div className="mx-auto max-w-2xl text-center">
            <div className="mx-auto grid size-16 place-items-center rounded-2xl border-[2.5px] border-edge bg-yellow text-[#121212] shadow-[4px_4px_0_var(--shadow-c)]">
              <Lock className="size-8" />
            </div>
            <h3 className="mt-4 font-display text-2xl font-extrabold">
              AI &amp; Plagiarism Report + Reducer is exclusive to Paid Plans
            </h3>
            <p className="mt-2 text-sm text-ink-2">
              Upgrade to <b>Pro</b>, <b>Max</b>, or grab a <b>Paper Pack</b> to unlock unlimited Turnitin-style line-by-line
              similarity highlighting against 250M+ OpenAlex works, stylometric AI detection, printable PDF receipts, and
              1-click AI &amp; Plagiarism Reduction powered by Claude on Amazon Bedrock.
            </p>
            <div className="mt-5 grid gap-3 text-left sm:grid-cols-3">
              <div className="rounded-xl border-2 border-edge bg-surface-2 p-3 text-xs">
                <b className="block font-display text-sm">🎨 Highlighted Lines</b>
                Color-coded `[1]..[K]` inline matches with exact DOI links &amp; matched source sentences.
              </div>
              <div className="rounded-xl border-2 border-edge bg-surface-2 p-3 text-xs">
                <b className="block font-display text-sm">🤖 AI Stylometrics</b>
                Burstiness CV, RLHF participial cadence, LLM clichés &amp; Cabanac tortured-phrase detection.
              </div>
              <div className="rounded-xl border-2 border-edge bg-surface-2 p-3 text-xs">
                <b className="block font-display text-sm">✨ 1-Click Reducer</b>
                Rewrites flagged lines &amp; re-scores immediately (`Before% → After%`) while keeping math &amp; citations.
              </div>
            </div>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <Button
                variant="primary"
                onClick={() =>
                  openUpgrade({
                    code: "paid_only",
                    feature: "integrity_scans",
                    label: "Turnitin-style AI & Plagiarism Report + Reducer",
                    limit: 0,
                    plan: me?.plan ?? "free",
                    message: "Upgrade to Pro, Max, or Paper Pack to unlock AI & Plagiarism Reports and 1-Click Reduction.",
                  })
                }
              >
                <Crown className="size-4" /> Upgrade to Unlock Now
              </Button>
              <button
                type="button"
                onClick={() => setOwnerKeyOpen((v) => !v)}
                className="inline-flex items-center gap-1 text-xs font-bold text-muted underline hover:text-ink"
              >
                <KeyRound className="size-3.5" /> Dev Owner unlock
              </button>
            </div>
            {ownerKeyOpen && (
              <div className="mx-auto mt-4 flex max-w-sm gap-2">
                <input
                  type="password"
                  value={ownerKey}
                  onChange={(e) => setOwnerKey(e.target.value)}
                  placeholder="Enter OWNER_ACCESS_KEY…"
                  className="flex-1 rounded-xl border-2 border-edge bg-surface px-3 py-1.5 text-xs font-bold outline-none"
                />
                <Button variant="blue" className="!py-1.5 text-xs" loading={unlockingOwner} onClick={handleUnlockOwner}>
                  Unlock
                </Button>
              </div>
            )}
          </div>
        </Card>
      ) : (
        <>
          {/* Source Picker + Input Box */}
          <Card className="space-y-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-display text-base font-extrabold">
                1. Load a paper, upload a PDF, or paste manuscript prose
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="btn-brut inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-surface-2 px-3 py-1.5 text-xs font-extrabold">
                  <Upload className="size-3.5" /> Upload PDF / TXT
                  <input
                    type="file"
                    accept=".pdf,.txt,.md,.tex"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void handleUploadFile(f);
                      e.currentTarget.value = "";
                    }}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setTitle("Adaptive Conformal Prediction in Streaming Systems");
                    setText(SAMPLE_AI_PLAG_TEXT);
                    setActivePaperId(null);
                  }}
                  className="btn-brut inline-flex items-center gap-1 rounded-xl bg-yellow px-3 py-1.5 text-xs font-extrabold text-[#121212]"
                >
                  <Sparkles className="size-3.5" /> Load AI-heavy test passage
                </button>
              </div>
            </div>

            {(papers.length > 0 || demos.length > 0) && (
              <div className="flex flex-wrap items-center gap-2 rounded-2xl border-2 border-dashed border-edge bg-surface-2 p-3">
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Quick scan:</span>
                {papers.slice(0, 5).map((p) => (
                  <button
                    key={p.paper_id}
                    type="button"
                    onClick={() => runScanPayload({ paper_id: p.paper_id })}
                    className={clsx(
                      "btn-brut inline-flex max-w-[230px] items-center gap-1 truncate rounded-xl px-2.5 py-1 text-xs font-bold",
                      activePaperId === p.paper_id ? "bg-pink text-[#121212]" : "bg-surface",
                    )}
                  >
                    <FileText className="size-3 shrink-0" />
                    <span className="truncate">{p.title}</span>
                  </button>
                ))}
                {demos.map((d) => (
                  <button
                    key={d.slug}
                    type="button"
                    onClick={() => handleScanDemo(d.slug)}
                    className="btn-brut inline-flex items-center gap-1 rounded-xl bg-lime px-2.5 py-1 text-xs font-extrabold text-[#121212]"
                  >
                    <BookOpen className="size-3" /> {d.acronym} Demo
                  </button>
                ))}
              </div>
            )}

            <div className="space-y-2.5">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Manuscript title (used to retrieve closest peer-reviewed works on OpenAlex)"
                className="w-full rounded-xl border-[2.5px] border-edge bg-surface px-3.5 py-2 text-sm font-bold outline-none"
              />
              <textarea
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setActivePaperId(null);
                }}
                rows={activeReport ? 4 : 7}
                placeholder="Paste your abstract, section, or full paper draft here (minimum 20 words)…"
                className="w-full rounded-xl border-[2.5px] border-edge bg-surface px-3.5 py-2.5 text-sm leading-relaxed outline-none"
              />
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-bold">
                <input
                  type="checkbox"
                  checked={excludeRefs}
                  onChange={(e) => setExcludeRefs(e.target.checked)}
                  className="accent-[var(--pink)]"
                />
                Exclude Bibliography / References
              </label>
              <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-bold">
                <input
                  type="checkbox"
                  checked={excludeQuotes}
                  onChange={(e) => setExcludeQuotes(e.target.checked)}
                  className="accent-[var(--pink)]"
                />
                Exclude Quoted Text (&ldquo;…&rdquo;)
              </label>
              <div className="ml-auto flex flex-wrap gap-2">
                <Button
                  variant="blue"
                  loading={scanning}
                  onClick={() => runScanPayload({ text, title, paper_id: null })}
                >
                  <FileCheck2 className="size-4" />
                  {activeReport ? "Re-Scan Text" : "Run AI & Plagiarism Scan"}
                </Button>
              </div>
            </div>
          </Card>

          {/* Before -> After Reduction Banner */}
          <AnimatePresence>
            {reducedResult && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="card border-[2.5px] border-edge bg-[linear-gradient(120deg,var(--lime),var(--mint))] p-5 text-[#121212]"
              >
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <span className="rounded-full border-2 border-[#121212] bg-white px-2.5 py-0.5 text-[11px] font-extrabold uppercase">
                      Verified Re-Score Complete · {reducedResult.paragraphs_rewritten} Paragraph(s) Rewritten
                    </span>
                    <div className="mt-2 flex flex-wrap items-center gap-5 font-display text-lg font-extrabold">
                      <span>
                        Similarity:{" "}
                        <span className="line-through opacity-65">{reducedResult.before.similarity_pct}%</span>{" "}
                        <ArrowRight className="inline size-4" />{" "}
                        <span className="rounded-lg border-2 border-[#121212] bg-white px-2 py-0.5">
                          {reducedResult.after.similarity_pct}%
                        </span>
                      </span>
                      <span>
                        AI Indicator:{" "}
                        <span className="line-through opacity-65">{reducedResult.before.ai_pct}%</span>{" "}
                        <ArrowRight className="inline size-4" />{" "}
                        <span className="rounded-lg border-2 border-[#121212] bg-white px-2 py-0.5">
                          {reducedResult.after.ai_pct}%
                        </span>
                      </span>
                      <span className="text-sm">
                        Burstiness CV: {reducedResult.before.burstiness_cv} → <b>{reducedResult.after.burstiness_cv}</b>
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="inline-flex rounded-xl border-2 border-[#121212] bg-white p-0.5 text-xs font-extrabold">
                      <button
                        type="button"
                        onClick={() => setViewingVersion("cleaned")}
                        className={clsx(
                          "rounded-lg px-2.5 py-1",
                          viewingVersion === "cleaned" ? "bg-[#121212] text-white" : "text-[#121212]",
                        )}
                      >
                        Cleaned Report
                      </button>
                      <button
                        type="button"
                        onClick={() => setViewingVersion("original")}
                        className={clsx(
                          "rounded-lg px-2.5 py-1",
                          viewingVersion === "original" ? "bg-[#121212] text-white" : "text-[#121212]",
                        )}
                      >
                        Original Report
                      </button>
                    </div>
                    <Button variant="ghost" className="!bg-white !text-[#121212] !py-1.5 text-xs" onClick={copyCleaned}>
                      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                      {copied ? "Copied" : "Copy Clean"}
                    </Button>
                    <Button variant="ghost" className="!bg-white !text-[#121212] !py-1.5 text-xs" onClick={downloadMarkdown}>
                      <Download className="size-3.5" /> .md
                    </Button>
                    {activePaperId && (
                      <Button
                        variant="primary"
                        className="!py-1.5 text-xs"
                        loading={applyingStudio}
                        onClick={handleApplyToStudio}
                      >
                        <Wand2 className="size-3.5" /> Apply to Paper Studio
                      </Button>
                    )}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Main Turnitin Report + Split Viewer */}
          {activeReport && (
            <div className="space-y-4">
              {/* Gauges + Reducer Action Card */}
              <div className="grid gap-3 md:grid-cols-3">
                <GaugeRing
                  label="Similarity Index"
                  pct={activeReport.similarity_pct}
                  thresholds={[15, 30]}
                  sub={`Verbatim ${activeReport.verbatim_pct}% · Paraphrase ${activeReport.paraphrase_pct}% · ${activeReport.sources.length} matched source(s)`}
                />
                <GaugeRing
                  label="AI Writing Indicator"
                  pct={activeReport.ai_pct}
                  thresholds={[20, 45]}
                  sub={`Burstiness CV ${activeReport.burstiness_cv} (human ≥ 0.30) · ${activeReport.cliche_count} LLM cliché(s)`}
                />
                <div className="flex flex-col justify-between rounded-2xl border-[2.5px] border-edge bg-surface p-3.5 shadow-[3px_3px_0_var(--shadow-c)]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-display text-sm font-extrabold">AI &amp; Plagiarism Reducer</span>
                    <select
                      value={reduceMode}
                      onChange={(e) => setReduceMode(e.target.value as typeof reduceMode)}
                      className="rounded-lg border-2 border-edge bg-surface-2 px-2 py-0.5 text-[11px] font-extrabold outline-none"
                    >
                      <option value="both">Fix Both AI + Plag</option>
                      <option value="plagiarism">Reduce Plagiarism Only</option>
                      <option value="ai">Humanize AI Only</option>
                    </select>
                  </div>
                  <p className="my-1.5 text-xs text-ink-2">
                    Rewrites {activeReport.flagged_count} flagged sentence(s) with authentic burstiness &amp; proper
                    citations while preserving LaTeX math and numbers.
                  </p>
                  <Button
                    variant="primary"
                    className="w-full !py-2 text-xs"
                    loading={reducing}
                    onClick={handleReduce}
                  >
                    <Wand2 className="size-3.5" />
                    {reducing ? "Rewriting & Re-Scoring…" : "✨ Reduce AI & Plagiarism Now"}
                  </Button>
                </div>
              </div>

              {/* Filter Toolbar */}
              <div className="flex flex-wrap items-center gap-2 rounded-2xl border-[2.5px] border-edge bg-surface px-4 py-2.5">
                <span className="text-xs font-extrabold uppercase tracking-wider text-muted">Highlight Layer:</span>
                {(
                  [
                    ["all", "All Highlights"],
                    ["similarity", `Similarity (${activeReport.sources.length} sources)`],
                    ["ai", `AI Writing (${aiFlaggedSentences.length} lines)`],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      setLayer(id);
                      setFilterSourceId(null);
                    }}
                    className={clsx(
                      "rounded-full border-2 border-edge px-3 py-0.5 text-xs font-extrabold transition-colors",
                      layer === id && filterSourceId === null ? "bg-yellow text-[#121212]" : "bg-surface-2 hover:bg-surface-3",
                    )}
                  >
                    {label}
                  </button>
                ))}
                {filterSourceId !== null && (
                  <button
                    type="button"
                    onClick={() => setFilterSourceId(null)}
                    className="rounded-full border-2 border-edge bg-pink px-3 py-0.5 text-xs font-extrabold text-[#121212]"
                  >
                    Filtering Source [{filterSourceId}] ✕
                  </button>
                )}
                <div className="ml-auto flex items-center gap-2 text-xs text-muted">
                  <span>{activeReport.total_words.toLocaleString()} words</span>
                  <span>·</span>
                  <span>{activeReport.sources_checked} OpenAlex papers checked</span>
                </div>
              </div>

              {/* Split Pane: Highlighted Document (Left) + Turnitin Inspector (Right) */}
              <div className="grid items-start gap-4 lg:grid-cols-[1.55fr_1fr]">
                {/* Left: Highlighted Document Viewer */}
                <Card className="max-h-[760px] overflow-y-auto p-6">
                  <div className="mb-4 flex items-start justify-between gap-3 border-b-2 border-dashed border-line pb-3">
                    <div>
                      <div className="text-[11px] font-extrabold uppercase tracking-widest text-muted">
                        {viewingVersion === "cleaned" ? "Cleaned & Re-Scored Manuscript" : "Annotated Manuscript View"}
                      </div>
                      <h3 className="font-display text-xl font-extrabold">{activeReport.title}</h3>
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={copyCleaned}
                        className="btn-brut rounded-lg bg-surface-2 px-2.5 py-1 text-xs font-bold"
                        title="Copy text"
                      >
                        <Copy className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => printTurnitinReceipt(activeReport)}
                        className="btn-brut rounded-lg bg-surface-2 px-2.5 py-1 text-xs font-bold"
                        title="Print Turnitin PDF receipt"
                      >
                        <Printer className="size-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="space-y-4 font-serif text-[15px] leading-[1.78] text-ink">
                    {activeReport.paragraphs.map((p) => {
                      if (p.kind === "heading") {
                        return (
                          <h4 key={p.index} className="pt-2 font-display text-base font-extrabold text-ink">
                            {p.raw.replace(/^#+\s*/, "")}
                          </h4>
                        );
                      }
                      if (p.kind !== "prose") {
                        return (
                          <pre key={p.index} className="overflow-x-auto rounded-xl bg-surface-2 p-3 font-mono text-xs">
                            {p.raw}
                          </pre>
                        );
                      }
                      return (
                        <p key={p.index} className="text-justify">
                          {p.sentences.map((s) => {
                            const showSim =
                              Boolean(s.match) &&
                              (layer === "all" || layer === "similarity") &&
                              (filterSourceId === null || s.match?.source_id === filterSourceId);
                            const showAi =
                              s.ai_band !== "low" &&
                              (layer === "all" || layer === "ai") &&
                              filterSourceId === null;
                            const isSelected = selectedSentId === s.id;

                            if (!showSim && !showAi) {
                              return <span key={s.id}>{s.text} </span>;
                            }

                            const simColor = s.match?.color ?? "#e11d48";
                            const aiColor = s.ai_band === "high" ? "#7c3aed" : "#d97706";

                            return (
                              <span
                                key={s.id}
                                onClick={() => {
                                  setSelectedSentId(s.id);
                                  if (showSim) setInspectorTab("sources");
                                  else if (showAi) setInspectorTab("ai");
                                }}
                                style={{
                                  backgroundColor: showSim ? `${simColor}24` : `${aiColor}1e`,
                                  borderBottom: showSim
                                    ? `2.5px solid ${simColor}`
                                    : `2px dashed ${aiColor}`,
                                  outline: isSelected ? `2px solid var(--edge)` : undefined,
                                }}
                                className=" mr-1 cursor-pointer rounded px-1 py-0.5 transition-all hover:brightness-95"
                                title={
                                  showSim
                                    ? `Matched Source [${s.match!.source_id}]: ${s.match!.source_title} (${Math.round(s.match!.similarity * 100)}%)`
                                    : `AI Stylometric Signal (${s.ai_band}): ${s.ai_reasons.join(" · ")}`
                                }
                              >
                                {s.text}
                                {showSim && s.match && (
                                  <sup
                                    style={{ backgroundColor: simColor }}
                                    className="ml-1 inline-block rounded px-1 py-0 font-sans text-[10px] font-extrabold text-white"
                                  >
                                    [{s.match.source_id}]
                                  </sup>
                                )}
                                {showAi && (
                                  <sup
                                    style={{ backgroundColor: aiColor }}
                                    className="ml-1 inline-block rounded px-1 py-0 font-sans text-[9px] font-extrabold uppercase text-white"
                                  >
                                    AI
                                  </sup>
                                )}
                              </span>
                            );
                          })}
                        </p>
                      );
                    })}
                  </div>
                </Card>

                {/* Right: Turnitin Source Breakdown + AI Stylometric Inspector + Diff */}
                <Card className="max-h-[760px] overflow-y-auto p-4">
                  <div className="mb-3 grid grid-cols-3 gap-1 rounded-xl border-2 border-edge bg-surface-2 p-1 text-xs font-extrabold">
                    <button
                      type="button"
                      onClick={() => setInspectorTab("sources")}
                      className={clsx(
                        "rounded-lg py-1.5 transition-colors",
                        inspectorTab === "sources" ? "bg-surface shadow-sm" : "text-muted hover:text-ink",
                      )}
                    >
                      Sources ({activeReport.sources.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setInspectorTab("ai")}
                      className={clsx(
                        "rounded-lg py-1.5 transition-colors",
                        inspectorTab === "ai" ? "bg-surface shadow-sm" : "text-muted hover:text-ink",
                      )}
                    >
                      AI Lines ({aiFlaggedSentences.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setInspectorTab("diff")}
                      className={clsx(
                        "rounded-lg py-1.5 transition-colors",
                        inspectorTab === "diff" ? "bg-surface shadow-sm" : "text-muted hover:text-ink",
                      )}
                    >
                      Rewrites ({reducedResult?.changes.length ?? 0})
                    </button>
                  </div>

                  {/* Tab 1: Matched Sources */}
                  {inspectorTab === "sources" && (
                    <div className="space-y-2.5">
                      {(() => {
                        const sel = activeReport.paragraphs.flatMap((p) => p.sentences).find((x) => x.id === selectedSentId);
                        return sel?.match ? <LineFixPanel key={sel.id} scanId={activeReport.scan_id} sent={sel} /> : null;
                      })()}
                      {activeReport.sources.length === 0 ? (
                        <div className="rounded-xl border-2 border-dashed border-edge bg-surface-2 p-5 text-center text-xs text-ink-2">
                          <CheckCircle2 className="mx-auto mb-1.5 size-6 text-good" />
                          <b className="block font-display text-sm text-ink">0% External Similarity Detected</b>
                          No sentences exceeded verbatim 4-gram or semantic paraphrase thresholds across{" "}
                          {activeReport.sources_checked} related OpenAlex works.
                        </div>
                      ) : (
                        activeReport.sources.map((src) => {
                          const active = filterSourceId === src.id;
                          const matchedSents = activeReport.paragraphs
                            .flatMap((p) => p.sentences)
                            .filter((s) => s.match?.source_id === src.id);
                          return (
                            <div
                              key={src.id}
                              className={clsx(
                                "rounded-xl border-2 border-edge p-3 transition-all",
                                active ? "bg-yellow/25" : "bg-surface-2/60 hover:bg-surface-2",
                              )}
                            >
                              <div className="flex items-start gap-2.5">
                                <button
                                  type="button"
                                  onClick={() => setFilterSourceId(active ? null : src.id)}
                                  style={{ backgroundColor: src.color }}
                                  className="grid size-7 shrink-0 place-items-center rounded-lg border border-black/30 font-display text-xs font-extrabold text-white"
                                  title="Click to isolate this source in the manuscript"
                                >
                                  {src.id}
                                </button>
                                <div className="min-w-0 flex-1">
                                  <a
                                    href={src.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="line-clamp-2 text-xs font-extrabold leading-snug hover:underline"
                                  >
                                    {src.title} <ExternalLink className="inline size-3 opacity-60" />
                                  </a>
                                  <div className="mt-0.5 text-[11px] text-muted">
                                    {src.authors.slice(0, 2).join(", ")}
                                    {src.authors.length > 2 ? " et al." : ""} · {src.venue} ({src.year ?? "n.d."})
                                  </div>
                                </div>
                                <div className="shrink-0 text-right">
                                  <div className="font-display text-sm font-extrabold" style={{ color: src.color }}>
                                    {src.pct}%
                                  </div>
                                  <div className="text-[10px] text-muted">{src.occurrences} hit(s)</div>
                                </div>
                              </div>
                              {matchedSents[0]?.match && (
                                <div className="mt-2 rounded-lg border border-edge/30 bg-surface p-2 text-[11px] text-ink-2">
                                  <span className="font-bold uppercase text-muted">
                                    Closest source sentence ({matchedSents[0].match.kind}):{" "}
                                  </span>
                                  &ldquo;{matchedSents[0].match.matched_sentence}&rdquo;
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}

                  {/* Tab 2: AI Stylometric Signals */}
                  {inspectorTab === "ai" && (
                    <div className="space-y-2.5">
                      <div className="rounded-xl border-2 border-edge bg-surface-2 p-2.5 text-[11px] text-ink-2">
                        <b>Burstiness CV: {activeReport.burstiness_cv}</b> (authentic human academic writing typically
                        scores <b>≥ 0.30</b> by mixing concise 8-word statements with 28-word analytical clauses).
                      </div>
                      {aiFlaggedSentences.length === 0 ? (
                        <div className="rounded-xl border-2 border-dashed border-edge bg-surface-2 p-5 text-center text-xs text-ink-2">
                          <CheckCircle2 className="mx-auto mb-1.5 size-6 text-good" />
                          <b className="block font-display text-sm text-ink">Natural Human Stylometric Profile</b>
                          Zero high/moderate AI-writing clichés, participial cadence tails, or uniform burstiness flags!
                        </div>
                      ) : (
                        aiFlaggedSentences.map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => {
                              setLayer("ai");
                              setFilterSourceId(null);
                              setSelectedSentId(s.id);
                            }}
                            className={clsx(
                              "w-full rounded-xl border-2 border-edge p-3 text-left transition-colors",
                              selectedSentId === s.id ? "bg-violet/15" : "bg-surface-2/60 hover:bg-surface-2",
                            )}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <Badge tone={s.ai_band === "high" ? "crit" : "warn"}>
                                {s.ai_band === "high" ? "High AI signal" : "Moderate AI signal"} · {Math.round(s.ai_score * 100)}%
                              </Badge>
                              <span className="text-[10px] font-bold text-muted">{s.words} words</span>
                            </div>
                            <p className="mt-1.5 line-clamp-3 font-serif text-xs text-ink">&ldquo;{s.text}&rdquo;</p>
                            <ul className="mt-1.5 space-y-0.5 text-[11px] font-semibold text-ink-2">
                              {s.ai_reasons.map((r, idx) => (
                                <li key={idx} className="flex items-start gap-1">
                                  <AlertTriangle className="mt-0.5 size-3 shrink-0 text-orange" />
                                  <span>{r}</span>
                                </li>
                              ))}
                            </ul>
                          </button>
                        ))
                      )}
                    </div>
                  )}

                  {/* Tab 3: Reducer Before -> After Diffs */}
                  {inspectorTab === "diff" && (
                    <div className="space-y-3">
                      {!reducedResult || reducedResult.changes.length === 0 ? (
                        <div className="rounded-xl border-2 border-dashed border-edge bg-surface-2 p-5 text-center text-xs text-ink-2">
                          <ShieldAlert className="mx-auto mb-1.5 size-6 text-muted" />
                          <b className="block font-display text-sm text-ink">No rewrites run yet</b>
                          Click <b>✨ Reduce AI &amp; Plagiarism Now</b> above to rewrite flagged lines and inspect
                          paragraph-by-paragraph diffs here.
                        </div>
                      ) : (
                        reducedResult.changes.map((c) => (
                          <div key={c.paragraph_index} className="space-y-2 rounded-xl border-2 border-edge bg-surface-2 p-3 text-xs">
                            <div className="font-display font-extrabold text-ink">
                              Paragraph #{c.paragraph_index + 1} · <span className="font-sans font-semibold text-ink-2">{c.note}</span>
                            </div>
                            <div className="rounded-lg border border-crit/40 bg-crit/10 p-2 font-serif leading-relaxed text-ink">
                              <span className="mr-1 font-sans text-[10px] font-extrabold uppercase text-crit">Before:</span>
                              {c.before}
                            </div>
                            <div className="rounded-lg border border-good/40 bg-good/15 p-2 font-serif leading-relaxed text-ink">
                              <span className="mr-1 font-sans text-[10px] font-extrabold uppercase text-good">After:</span>
                              {c.after}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </Card>
              </div>

              {/* Transparent Methodology Footer */}
              <div className="rounded-xl border-2 border-dashed border-edge bg-surface-2 px-4 py-2.5 text-xs text-muted">
                <b>Methodology &amp; Honesty Guarantee:</b> {activeReport.methodology}
                {activeReport.warnings?.map((w, i) => (
                  <span key={i} className="ml-2 text-orange">
                    ({w})
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
