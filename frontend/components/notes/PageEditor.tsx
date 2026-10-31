"use client";

import clsx from "clsx";
import {
  AlignLeft, Bold, BookMarked, CalendarDays, Check, ClipboardCopy, Code2, Columns2, Eraser, Eye, FileCode2, Focus, Footprints,
  Heading1, Heading2, Heading3, Highlighter, History, Image as ImageIcon, Italic, Link2, List, ListChecks, ListOrdered, ListTree,
  Loader2, Mic, MicOff, Minus, Network, PenLine, Quote, Redo2, Replace, Search, Sigma, Strikethrough, Superscript, Table2, Underline,
  Undo2, Volume2, VolumeX, Workflow, X, ZoomIn, ZoomOut, Lock,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, apiFetch, toast, usePersistent } from "@/lib/api";
import { AssistMenu } from "../AssistMenu";
import { RichMarkdown } from "./RichMarkdown";
import { usePaid } from "../auth/AuthProvider";
import { ProChip, UnlockPanel } from "../billing/ProLock";

export interface Snapshot { at: number; md: string; label?: string }
export interface Page {
  id: string; title: string; md: string; template: "ieee" | "springer" | "plain"; updated: number; emoji: string; versions?: Snapshot[];
}

type View = "write" | "split" | "preview" | "latex";
type RibbonTab = "home" | "insert" | "review" | "view";

const GREEK = "α β γ δ ε θ λ μ π σ τ φ ω Δ Σ Ω ∞ ≈ ≠ ≤ ≥ ± × ÷ ∑ ∏ ∫ ∂ ∇ √ ∈ ∉ ⊂ ∪ ∩ → ⇒ ⇔ ∀ ∃ ° ‰ † ‡ § ¶ © ®".split(" ");

const EQUATIONS: { label: string; tex: string }[] = [
  { label: "Fraction", tex: "\\frac{a}{b}" }, { label: "Sum", tex: "\\sum_{i=1}^{n} x_i" }, { label: "Integral", tex: "\\int_{a}^{b} f(x)\\,dx" },
  { label: "Matrix", tex: "\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}" }, { label: "Argmin", tex: "\\hat{\\theta} = \\arg\\min_{\\theta} \\mathcal{L}(\\theta)" },
  { label: "Softmax", tex: "\\mathrm{softmax}(z)_i = \\frac{e^{z_i}}{\\sum_j e^{z_j}}" }, { label: "Bayes", tex: "P(A\\mid B) = \\frac{P(B\\mid A)P(A)}{P(B)}" },
  { label: "Cross-entropy", tex: "\\mathcal{L} = -\\sum_{c} y_c \\log \\hat{y}_c" },
];

const speakable = (md: string) => md.replace(/```[\s\S]*?```/g, " ").replace(/\$\$?[^$]+\$\$?/g, " (equation) ").replace(/!\[[^\]]*\]\([^)]*\)/g, "")
  .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/^#+\s*/gm, "").replace(/[*_~>|=+^`]/g, "").replace(/\s+/g, " ").trim();

/** Re-encode an image as PNG (long edge ≤ 2000 px) so it exports cleanly to Word and LaTeX. */
async function toPng(f: File): Promise<File> {
  const url = URL.createObjectURL(f);
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = url; });
    let edge = 2000;
    for (;;) {
      const k = Math.min(1, edge / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/png"));
      if (!blob) throw new Error("encode");
      if (blob.size < 4.8 * 1024 * 1024 || edge < 700) return new File([blob], f.name.replace(/\.\w+$/, "") + ".png", { type: "image/png" });
      edge = Math.round(edge * 0.7);
    }
  } finally { URL.revokeObjectURL(url); }
}

function RBtn({ icon: Icon, label, onClick, active, kbd, wide, disabled }: {
  icon: typeof Bold; label: string; onClick: () => void; active?: boolean; kbd?: string; wide?: boolean; disabled?: boolean;
}) {
  return (
    <motion.button type="button" whileTap={{ scale: 0.9 }} onMouseDown={(e) => e.preventDefault()} onClick={onClick} disabled={disabled}
      title={kbd ? `${label} (${kbd})` : label} aria-label={label}
      className={clsx("inline-flex items-center gap-1 rounded-lg border-2 px-1.5 py-1 text-[11px] font-bold transition disabled:opacity-40",
        active ? "border-edge bg-yellow text-[#121212]" : "border-transparent hover:border-edge hover:bg-surface")}>
      <Icon className="size-4" />{wide && <span>{label}</span>}
    </motion.button>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-0.5 border-r-2 border-dashed border-line px-2 last:border-r-0">
      <div className="flex flex-wrap items-center gap-0.5">{children}</div>
      <span className="text-[9px] font-extrabold uppercase tracking-wider text-muted">{label}</span>
    </div>
  );
}

function Pop({ open, onClose, children, className }: { open: boolean; onClose: () => void; children: React.ReactNode; className?: string }) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={onClose} />
          <motion.div initial={{ opacity: 0, y: -6, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6 }}
            className={clsx("absolute left-0 top-full z-40 mt-1 rounded-xl border-[2.5px] border-edge bg-surface p-3 shadow-[4px_4px_0_var(--shadow-c)]", className)}>
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export function PageEditor({ page, edit, author, affil, previewRef }: {
  page: Page; edit: (patch: Partial<Page>) => void; author: string; affil: string;
  previewRef: React.RefObject<HTMLDivElement | null>;
}) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [view, setView] = usePersistent<View>("notesEditorView", "split");
  const [tab, setTab] = useState<RibbonTab>("home");
  const [zoom, setZoom] = usePersistent<number>("notesZoom", 100);
  const [focus, setFocus] = useState(false);
  const [outline, setOutline] = usePersistent<boolean>("notesOutline", true);
  const [findOpen, setFindOpen] = useState(false);
  const [find, setFind] = useState("");
  const [repl, setRepl] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [pop, setPop] = useState<null | "table" | "eq" | "sym" | "cite" | "link" | "history">(null);
  const [grid, setGrid] = useState<[number, number]>([0, 0]);
  const [doi, setDoi] = useState("");
  const [citing, setCiting] = useState(false);
  const [linkUrl, setLinkUrl] = useState("https://");
  const [uploading, setUploading] = useState(false);
  const [latex, setLatex] = useState<string>("");
  const [latexBusy, setLatexBusy] = useState(false);
  const [caret, setCaret] = useState({ line: 1, col: 1 });
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const recog = useRef<{ stop(): void } | null>(null);
  const md = page.md;
  const { paid, gate } = usePaid();

  // ---- text primitives (execCommand keeps the browser's own undo stack working) ----
  const replaceRange = useCallback((start: number, end: number, text: string, selStart?: number, selEnd?: number) => {
    const el = ta.current;
    if (!el) { edit({ md: md.slice(0, start) + text + md.slice(end) }); return; }
    el.focus();
    el.setSelectionRange(start, end);
    const ok = document.execCommand?.("insertText", false, text);
    if (!ok) edit({ md: el.value.slice(0, start) + text + el.value.slice(end) });
    requestAnimationFrame(() => el.setSelectionRange(selStart ?? start + text.length, selEnd ?? selStart ?? start + text.length));
  }, [edit, md]);

  const sel = () => {
    const el = ta.current;
    return el ? { s: el.selectionStart, e: el.selectionEnd, text: el.value.slice(el.selectionStart, el.selectionEnd) } : { s: md.length, e: md.length, text: "" };
  };

  const insert = useCallback((text: string) => { const el = ta.current; const p = el ? el.selectionEnd : md.length; replaceRange(p, p, text); }, [md.length, replaceRange]);

  const wrap = (before: string, after = before, placeholder = "text") => {
    const { s, e, text } = sel();
    if (text.startsWith(before) && text.endsWith(after) && text.length >= before.length + after.length) {
      const inner = text.slice(before.length, text.length - after.length);
      replaceRange(s, e, inner, s, s + inner.length); return;
    }
    const v = ta.current?.value ?? md;
    if (v.slice(s - before.length, s) === before && v.slice(e, e + after.length) === after) {
      replaceRange(s - before.length, e + after.length, text, s - before.length, e - before.length); return;
    }
    const body = text || placeholder;
    replaceRange(s, e, before + body + after, s + before.length, s + before.length + body.length);
  };

  const linePrefix = (prefix: string | ((i: number) => string), strip: RegExp) => {
    const v = ta.current?.value ?? md;
    const { s, e } = sel();
    const ls = v.lastIndexOf("\n", s - 1) + 1;
    const le = v.indexOf("\n", e) === -1 ? v.length : v.indexOf("\n", e);
    const lines = v.slice(ls, le).split("\n");
    const all = lines.every((l) => strip.test(l));
    const out = lines.map((l, i) => (all ? l.replace(strip, "") : (typeof prefix === "string" ? prefix : prefix(i)) + l.replace(strip, ""))).join("\n");
    replaceRange(ls, le, out, ls, ls + out.length);
  };

  const heading = (n: 0 | 1 | 2 | 3) => linePrefix(n ? "#".repeat(n) + " " : "", n ? new RegExp(`^#{${n}}\\s`) : /^#{1,6}\s/);
  const fixHeading = (n: 0 | 1 | 2 | 3) => {
    // switching H2→H3 should replace, not stack
    const v = ta.current?.value ?? md; const { s } = sel();
    const ls = v.lastIndexOf("\n", s - 1) + 1; const le = v.indexOf("\n", s) === -1 ? v.length : v.indexOf("\n", s);
    const line = v.slice(ls, le); const bare = line.replace(/^#{1,6}\s+/, "");
    const cur = (line.match(/^(#{1,6})\s/)?.[1].length ?? 0);
    if (cur === n || n === 0) { replaceRange(ls, le, bare, ls, ls + bare.length); return; }
    if (cur) { const t = "#".repeat(n) + " " + bare; replaceRange(ls, le, t, ls, ls + t.length); return; }
    heading(n);
  };

  const clearFormatting = () => {
    const { s, e, text } = sel();
    if (!text) return;
    const t = text.replace(/\*\*|\+\+|==|~~|(?<!\w)\*(?!\s)|`/g, "").replace(/\^(\S+?)\^/g, "$1").replace(/^#{1,6}\s+|^>\s?/gm, "");
    replaceRange(s, e, t, s, s + t.length);
  };

  const insertTable = (r: number, c: number) => {
    const head = "| " + Array.from({ length: c }, (_, i) => `Column ${i + 1}`).join(" | ") + " |";
    const rule = "|" + "---|".repeat(c);
    const rows = Array.from({ length: r - 1 }, () => "| " + Array(c).fill("   ").join(" | ") + " |");
    insert(`\n\nTable: Caption\n${[head, rule, ...rows].join("\n")}\n\n`);
    setPop(null);
  };

  const footnote = () => {
    const n = (md.match(/\[\^(\d+)\]:/g)?.length ?? 0) + 1;
    const el = ta.current; const p = el ? el.selectionEnd : md.length;
    const tail = `\n\n[^${n}]: Footnote text.`;
    // marker at caret, definition at end of document
    const v = el?.value ?? md;
    const next = v.slice(0, p) + `[^${n}]` + v.slice(p) + tail;
    if (el) { el.focus(); el.setSelectionRange(0, v.length); if (document.execCommand?.("insertText", false, next)) { requestAnimationFrame(() => el.setSelectionRange(next.length - 14, next.length - 1)); return; } }
    edit({ md: next });
  };

  const cite = async () => {
    const id = doi.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//, "");
    if (!/^10\.\d{4,9}\/\S+$/.test(id)) { toast({ title: "Enter a DOI like 10.1038/nature14539", tone: "accent" }); return; }
    setCiting(true);
    try {
      const r = await fetch(`https://api.crossref.org/works/${encodeURIComponent(id)}`);
      if (!r.ok) throw new Error("DOI not found on Crossref");
      const w = (await r.json()).message as { title?: string[]; author?: { family?: string; given?: string }[]; issued?: { "date-parts"?: number[][] }; "container-title"?: string[]; volume?: string; page?: string };
      const names = (w.author ?? []).slice(0, 3).map((a) => `${(a.given ?? "").split(/\s+/).map((g) => g[0] ? g[0] + "." : "").join(" ")} ${a.family ?? ""}`.trim());
      const authors = names.join(", ") + ((w.author?.length ?? 0) > 3 ? " et al." : "");
      const year = w.issued?.["date-parts"]?.[0]?.[0] ?? "n.d.";
      const ref = `${authors}, "${w.title?.[0] ?? "Untitled"}," *${w["container-title"]?.[0] ?? ""}*${w.volume ? `, vol. ${w.volume}` : ""}${w.page ? `, pp. ${w.page}` : ""}, ${year}. doi: ${id}`;
      const v = ta.current?.value ?? md;
      const refsAt = v.search(/^#{1,2}\s*References\s*$/im);
      const existing = refsAt >= 0 ? (v.slice(refsAt).match(/^\[(\d+)\]/gm) ?? []).length : 0;
      const n = existing + 1;
      const p = ta.current ? ta.current.selectionEnd : v.length;
      let next = v.slice(0, p) + ` [${n}]` + v.slice(p);
      next = refsAt >= 0 ? next.replace(/\s*$/, `\n\n[${n}] ${ref}\n`) : next.replace(/\s*$/, `\n\n# References\n\n[${n}] ${ref}\n`);
      const el = ta.current;
      if (el) { el.focus(); el.setSelectionRange(0, v.length); if (!document.execCommand?.("insertText", false, next)) edit({ md: next }); } else edit({ md: next });
      toast({ title: `Cited [${n}]`, body: w.title?.[0], tone: "good" });
      setDoi(""); setPop(null);
    } catch (e) {
      toast({ title: "Couldn't cite that DOI", body: (e as Error).message, tone: "crit" });
    } finally { setCiting(false); }
  };

  const uploadImage = async (files: FileList | File[] | null) => {
    const f = files && Array.from(files).find((x) => x.type.startsWith("image/"));
    if (!f) return;
    setUploading(true);
    try {
      const png = await toPng(f);
      const { url } = await api.upload<{ url: string }>("/api/workspace/images", png);
      insert(`\n\n![${f.name.replace(/\.\w+$/, "").replace(/[-_]/g, " ")}](${url})\n\n`);
    } catch (e) {
      toast({ title: "Image upload failed", body: (e as Error).message, tone: "crit" });
    } finally { setUploading(false); }
  };

  const snapshot = (label?: string) => {
    const versions = [{ at: Date.now(), md, label }, ...(page.versions ?? [])].slice(0, 15);
    edit({ versions });
    toast({ title: "Version saved", body: label ?? new Date().toLocaleTimeString(), tone: "good" });
  };

  const readAloud = () => {
    const synth = window.speechSynthesis;
    if (!synth) { toast({ title: "Read-aloud isn't supported in this browser", tone: "accent" }); return; }
    if (speaking) { synth.cancel(); setSpeaking(false); return; }
    const { text } = sel();
    const u = new SpeechSynthesisUtterance(speakable(text || md).slice(0, 20000));
    u.lang = navigator.language || "en-US";
    u.onend = () => setSpeaking(false); u.onerror = () => setSpeaking(false);
    synth.cancel(); synth.speak(u); setSpeaking(true);
  };

  const dictate = () => {
    if (listening) { recog.current?.stop(); return; }
    const w = window as unknown as { SpeechRecognition?: new () => unknown; webkitSpeechRecognition?: new () => unknown };
    const Ctor = (w.SpeechRecognition ?? w.webkitSpeechRecognition) as (new () => {
      lang: string; continuous: boolean; interimResults: boolean; start(): void; stop(): void;
      onresult: (e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void; onend: () => void; onerror: (e: { error: string }) => void;
    }) | undefined;
    if (!Ctor) { toast({ title: "Dictation isn't supported in this browser", body: "Try Chrome, Edge or Safari.", tone: "accent" }); return; }
    const r = new Ctor();
    r.lang = navigator.language || "en-US"; r.continuous = true; r.interimResults = false;
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) insert(e.results[i][0].transcript.trim() + " ");
    };
    r.onerror = (e) => { if (e.error === "not-allowed") toast({ title: "Allow microphone access to dictate", tone: "crit" }); };
    r.onend = () => { setListening(false); recog.current = null; };
    recog.current = r; r.start(); setListening(true);
  };
  useEffect(() => () => { recog.current?.stop(); window.speechSynthesis?.cancel(); }, []);

  // ---- find & replace ----
  const rx = useMemo(() => {
    if (!find) return null;
    try { return new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), matchCase ? "g" : "gi"); } catch { return null; }
  }, [find, matchCase]);
  const matches = useMemo(() => (rx ? [...md.matchAll(rx)].map((m) => m.index ?? 0) : []), [md, rx]);
  const findNext = (back = false) => {
    const el = ta.current; if (!el || !matches.length) return;
    const from = back ? el.selectionStart - 1 : el.selectionEnd;
    const i = back ? [...matches].reverse().find((m) => m <= from) ?? matches[matches.length - 1] : matches.find((m) => m >= from) ?? matches[0];
    el.focus(); el.setSelectionRange(i, i + find.length);
    const line = md.slice(0, i).split("\n").length;
    el.scrollTop = Math.max(0, (line - 5) * 22 * zoom / 100);
  };
  const replaceOne = () => {
    const el = ta.current; if (!el || !rx) return;
    const cur = el.value.slice(el.selectionStart, el.selectionEnd);
    if (cur && (matchCase ? cur === find : cur.toLowerCase() === find.toLowerCase())) replaceRange(el.selectionStart, el.selectionEnd, repl);
    findNext();
  };
  const replaceAll = () => {
    if (!rx || !matches.length) return;
    const n = matches.length;
    const el = ta.current; const next = md.replace(rx, repl);
    if (el) { el.focus(); el.setSelectionRange(0, md.length); if (!document.execCommand?.("insertText", false, next)) edit({ md: next }); } else edit({ md: next });
    toast({ title: `Replaced ${n} match${n > 1 ? "es" : ""}`, tone: "good" });
  };

  // ---- outline & stats ----
  const heads = useMemo(() => {
    const out: { level: number; text: string; idx: number }[] = [];
    let inCode = false; let idx = 0;
    for (const line of md.split("\n")) {
      if (line.startsWith("```")) inCode = !inCode;
      const m = !inCode && line.match(/^(#{1,3})\s+(.+)/);
      if (m) out.push({ level: m[1].length, text: m[2].replace(/[*_`]/g, ""), idx });
      idx += line.length + 1;
    }
    return out;
  }, [md]);
  const stats = useMemo(() => {
    const prose = md.replace(/```[\s\S]*?```/g, " ").replace(/\$\$[\s\S]*?\$\$/g, " ");
    const words = (prose.match(/[\p{L}\p{N}'’-]+/gu) ?? []).length;
    return { words, chars: md.length, read: Math.max(1, Math.round(words / 230)), figs: (md.match(/^Figure:|!\[/gm) ?? []).length, tables: (md.match(/^Table:/gm) ?? []).length, cites: new Set(md.match(/\[\d+\]/g) ?? []).size };
  }, [md]);
  const jump = (idx: number) => {
    const el = ta.current;
    if (el) { el.focus(); el.setSelectionRange(idx, idx); el.scrollTop = Math.max(0, (md.slice(0, idx).split("\n").length - 3) * 22 * zoom / 100); }
    const h = previewRef.current?.querySelectorAll("h1,h2,h3")[heads.findIndex((x) => x.idx === idx)];
    h?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // ---- LaTeX source (Overleaf-style) ----
  useEffect(() => {
    if (view !== "latex" || !paid) return;
    let alive = true;
    const t = setTimeout(async () => {
      setLatexBusy(true);
      try {
        const r = await apiFetch("/api/export/latex", { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: page.title, markdown: md, template: page.template, author, affiliation: affil }) });
        const txt = await r.text();
        if (alive) setLatex(r.ok ? txt : `% ${(() => { try { return JSON.parse(txt).detail?.message ?? JSON.parse(txt).detail; } catch { return "LaTeX preview unavailable"; } })()}`);
      } catch { if (alive) setLatex("% LaTeX preview unavailable (offline)"); }
      finally { if (alive) setLatexBusy(false); }
    }, 600);
    return () => { alive = false; clearTimeout(t); };
  }, [view, md, page.title, page.template, author, affil, paid]);

  // ---- keyboard shortcuts ----
  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === "Tab") {
      e.preventDefault();
      if (e.shiftKey) linePrefix("", /^ {1,2}/); else if (sel().text.includes("\n")) linePrefix("  ", /^(?!)/); else insert("  ");
      return;
    }
    if (e.key === "Enter" && !mod) {
      const v = e.currentTarget.value; const p = e.currentTarget.selectionStart;
      const line = v.slice(v.lastIndexOf("\n", p - 1) + 1, p);
      const m = line.match(/^(\s*)([-*+] \[[ x]\] |[-*+] |(\d+)[.)] |> )/);
      if (m) {
        e.preventDefault();
        if (line.trim() === m[2].trim()) { const ls = v.lastIndexOf("\n", p - 1) + 1; replaceRange(ls, p, ""); return; }   // empty item ends the list
        const nextMarker = m[3] ? `${Number(m[3]) + 1}${m[2].trim().slice(-1)} ` : m[2].replace("[x]", "[ ]");
        insert("\n" + m[1] + nextMarker);
      }
      return;
    }
    if (!mod) return;
    const k = e.key.toLowerCase();
    const act: Record<string, () => void> = {
      b: () => wrap("**"), i: () => wrap("*"), u: () => wrap("++"), k: () => setPop("link"), e: () => wrap("`", "`", "code"),
      f: () => { setFindOpen(true); setTimeout(() => document.getElementById("pe-find")?.focus(), 30); },
      h: () => { setFindOpen(true); setTimeout(() => document.getElementById("pe-repl")?.focus(), 30); },
      s: () => { if (gate("versions")) snapshot(); }, "1": () => fixHeading(1), "2": () => fixHeading(2), "3": () => fixHeading(3), "0": () => fixHeading(0),
    };
    if (e.shiftKey && k === "x") { e.preventDefault(); wrap("~~"); return; }
    if (e.shiftKey && k === "h") { e.preventDefault(); wrap("=="); return; }
    if (act[k] && !(k === "h" && e.shiftKey)) { e.preventDefault(); act[k](); }
  };
  const onCaret = () => {
    const el = ta.current; if (!el) return;
    const before = el.value.slice(0, el.selectionStart).split("\n");
    setCaret({ line: before.length, col: before[before.length - 1].length + 1 });
  };

  const undo = () => { ta.current?.focus(); document.execCommand?.("undo"); };
  const redo = () => { ta.current?.focus(); document.execCommand?.("redo"); };

  const showEditor = view === "write" || view === "split" || view === "latex";
  const showPreview = view === "split" || view === "preview";

  const ribbon: Record<RibbonTab, React.ReactNode> = {
    home: (
      <>
        <Group label="History">
          <RBtn icon={Undo2} label="Undo" kbd="⌘Z" onClick={undo} />
          <RBtn icon={Redo2} label="Redo" kbd="⌘⇧Z" onClick={redo} />
        </Group>
        <Group label="Font">
          <RBtn icon={Bold} label="Bold" kbd="⌘B" onClick={() => wrap("**")} />
          <RBtn icon={Italic} label="Italic" kbd="⌘I" onClick={() => wrap("*")} />
          <RBtn icon={Underline} label="Underline" kbd="⌘U" onClick={() => wrap("++")} />
          <RBtn icon={Strikethrough} label="Strikethrough" kbd="⌘⇧X" onClick={() => wrap("~~")} />
          <RBtn icon={Highlighter} label="Highlight" kbd="⌘⇧H" onClick={() => wrap("==")} />
          <RBtn icon={Superscript} label="Superscript" onClick={() => wrap("^", "^", "2")} />
          <RBtn icon={Code2} label="Inline code" kbd="⌘E" onClick={() => wrap("`", "`", "code")} />
          <RBtn icon={Eraser} label="Clear formatting" onClick={clearFormatting} />
        </Group>
        <Group label="Styles">
          <RBtn icon={AlignLeft} label="Normal text" kbd="⌘0" onClick={() => fixHeading(0)} />
          <RBtn icon={Heading1} label="Heading 1" kbd="⌘1" onClick={() => fixHeading(1)} />
          <RBtn icon={Heading2} label="Heading 2" kbd="⌘2" onClick={() => fixHeading(2)} />
          <RBtn icon={Heading3} label="Heading 3" kbd="⌘3" onClick={() => fixHeading(3)} />
        </Group>
        <Group label="Paragraph">
          <RBtn icon={List} label="Bulleted list" onClick={() => linePrefix("- ", /^[-*+]\s(?!\[)/)} />
          <RBtn icon={ListOrdered} label="Numbered list" onClick={() => linePrefix((i) => `${i + 1}. `, /^\d+[.)]\s/)} />
          <RBtn icon={ListChecks} label="Checklist" onClick={() => linePrefix("- [ ] ", /^[-*+]\s\[[ x]\]\s/)} />
          <RBtn icon={Quote} label="Quote" onClick={() => linePrefix("> ", /^>\s?/)} />
        </Group>
        <Group label="Editing">
          <RBtn icon={Search} label="Find" kbd="⌘F" active={findOpen} onClick={() => setFindOpen(!findOpen)} />
          <RBtn icon={Replace} label="Replace" kbd="⌘H" onClick={() => { setFindOpen(true); setTimeout(() => document.getElementById("pe-repl")?.focus(), 30); }} />
        </Group>
      </>
    ),
    insert: (
      <>
        <Group label="Tables">
          <div className="relative">
            <RBtn icon={Table2} label="Table" wide active={pop === "table"} onClick={() => setPop(pop === "table" ? null : "table")} />
            <Pop open={pop === "table"} onClose={() => setPop(null)}>
              <div className="mb-1 text-[11px] font-bold">{grid[0] ? `${grid[0]} × ${grid[1]} table` : "Pick a size"}</div>
              <div className="grid grid-cols-8 gap-0.5" onMouseLeave={() => setGrid([0, 0])}>
                {Array.from({ length: 64 }, (_, i) => { const r = Math.floor(i / 8) + 1, c = (i % 8) + 1; return (
                  <button key={i} type="button" onMouseEnter={() => setGrid([r, c])} onClick={() => insertTable(Math.max(2, r), c)}
                    className={clsx("size-4 rounded-sm border", r <= grid[0] && c <= grid[1] ? "border-edge bg-pink" : "border-line bg-surface-2")} />); })}
              </div>
            </Pop>
          </div>
        </Group>
        <Group label="Illustrations">
          <RBtn icon={uploading ? Loader2 : ImageIcon} label="Picture" wide disabled={uploading} onClick={() => fileRef.current?.click()} />
          <RBtn icon={Workflow} label="Flowchart" wide onClick={() => insert("\n\nFigure: Workflow\n```mermaid\nflowchart TD\n  A[Start] --> B{Decision}\n  B -- yes --> C[Do this]\n  B -- no --> D[Do that]\n```\n\n")} />
          <RBtn icon={Network} label="Diagram" wide onClick={() => insert("\n\nFigure: System architecture\n```mermaid\nflowchart LR\n  UI[Frontend] --> API[Backend API]\n  API --> DB[(Database)]\n  API --> M[Model service]\n```\n\n")} />
        </Group>
        <Group label="Symbols">
          <div className="relative">
            <RBtn icon={Sigma} label="Equation" wide active={pop === "eq"} onClick={() => setPop(pop === "eq" ? null : "eq")} />
            <Pop open={pop === "eq"} onClose={() => setPop(null)} className="w-72">
              <div className="mb-2 flex gap-1.5">
                <button type="button" className="rounded-lg border-2 border-edge bg-yellow px-2 py-1 text-[11px] font-bold text-[#121212]" onClick={() => { wrap("$", "$", "x^2"); setPop(null); }}>Inline $…$</button>
                <button type="button" className="rounded-lg border-2 border-edge bg-lime px-2 py-1 text-[11px] font-bold text-[#121212]" onClick={() => { insert("\n\n$$\nE = mc^2\n$$\n\n"); setPop(null); }}>Display $$…$$</button>
              </div>
              <div className="grid grid-cols-2 gap-1">
                {EQUATIONS.map((q) => (
                  <button key={q.label} type="button" onClick={() => { insert(`\n\n$$\n${q.tex}\n$$\n\n`); setPop(null); }}
                    className="rounded-lg border-2 border-line px-2 py-1 text-left text-[11px] font-bold hover:border-edge hover:bg-surface-2">{q.label}</button>
                ))}
              </div>
            </Pop>
          </div>
          <div className="relative">
            <RBtn icon={Sigma} label="Symbol" wide active={pop === "sym"} onClick={() => setPop(pop === "sym" ? null : "sym")} />
            <Pop open={pop === "sym"} onClose={() => setPop(null)} className="w-64">
              <div className="grid grid-cols-8 gap-1">
                {GREEK.map((g) => <button key={g} type="button" onClick={() => insert(g)} className="rounded-md border border-line py-1 text-sm hover:border-edge hover:bg-yellow hover:text-[#121212]">{g}</button>)}
              </div>
            </Pop>
          </div>
        </Group>
        <Group label="Links & references">
          <div className="relative">
            <RBtn icon={Link2} label="Link" kbd="⌘K" active={pop === "link"} onClick={() => setPop(pop === "link" ? null : "link")} />
            <Pop open={pop === "link"} onClose={() => setPop(null)} className="w-72">
              <form onSubmit={(e) => { e.preventDefault(); const { s, e: en, text } = sel(); const label = text || "link text"; replaceRange(s, en, `[${label}](${linkUrl})`, s + 1, s + 1 + label.length); setPop(null); }} className="flex gap-1.5">
                <input autoFocus value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} className="min-w-0 flex-1 rounded-lg border-2 border-edge bg-bg px-2 py-1 text-xs" />
                <button className="rounded-lg border-2 border-edge bg-pink px-2 text-xs font-bold text-[#121212]">Insert</button>
              </form>
            </Pop>
          </div>
          <div className="relative">
            <span className="inline-flex items-center"><RBtn icon={BookMarked} label="Cite DOI" wide active={pop === "cite"} onClick={() => gate("cite") && setPop(pop === "cite" ? null : "cite")} />{!paid && <ProChip />}</span>
            <Pop open={pop === "cite"} onClose={() => setPop(null)} className="w-80">
              <p className="mb-1.5 text-[11px] text-muted">Paste a DOI: the reference is looked up on Crossref, numbered, and added to your References section.</p>
              <form onSubmit={(e) => { e.preventDefault(); cite(); }} className="flex gap-1.5">
                <input autoFocus value={doi} onChange={(e) => setDoi(e.target.value)} placeholder="10.1038/nature14539" className="min-w-0 flex-1 rounded-lg border-2 border-edge bg-bg px-2 py-1 text-xs" />
                <button disabled={citing} className="inline-flex items-center rounded-lg border-2 border-edge bg-lime px-2 text-xs font-bold text-[#121212]">{citing ? <Loader2 className="size-3.5 animate-spin" /> : "Cite"}</button>
              </form>
            </Pop>
          </div>
          <RBtn icon={Footprints} label="Footnote" wide onClick={footnote} />
          <RBtn icon={Minus} label="Divider" onClick={() => insert("\n\n---\n\n")} />
          <RBtn icon={CalendarDays} label="Date" onClick={() => insert(new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }))} />
          <RBtn icon={Code2} label="Code block" onClick={() => insert("\n\n```python\nprint('hello')\n```\n\n")} />
        </Group>
      </>
    ),
    review: (
      <>
        <Group label="Proofing">
          <RBtn icon={Search} label="Find & replace" wide onClick={() => setFindOpen(!findOpen)} active={findOpen} />
        </Group>
        <Group label="Speech">
          <RBtn icon={speaking ? VolumeX : Volume2} label={speaking ? "Stop reading" : "Read aloud"} wide active={speaking} onClick={() => gate("voice") && readAloud()} />
          <RBtn icon={listening ? MicOff : Mic} label={listening ? "Stop dictation" : "Dictate"} wide active={listening} onClick={() => gate("voice") && dictate()} />
          {!paid && <ProChip />}
        </Group>
        <Group label="Versions">
          <RBtn icon={History} label="Save version" kbd="⌘S" wide onClick={() => gate("versions") && snapshot()} />
          <div className="relative">
            <RBtn icon={History} label={`History (${page.versions?.length ?? 0})`} wide active={pop === "history"} onClick={() => gate("versions") && setPop(pop === "history" ? null : "history")} />
            {!paid && <ProChip />}
            <Pop open={pop === "history"} onClose={() => setPop(null)} className="max-h-72 w-80 overflow-y-auto">
              {(page.versions ?? []).length === 0 ? <p className="text-xs text-muted">No saved versions yet. Press ⌘S to save one.</p> : (page.versions ?? []).map((v, i) => (
                <div key={v.at} className="flex items-center gap-2 border-b border-dashed border-line py-1.5 text-xs last:border-0">
                  <div className="flex-1"><div className="font-bold">{new Date(v.at).toLocaleString()}</div><div className="text-muted">{(v.md.match(/\S+/g) ?? []).length} words</div></div>
                  <button type="button" className="rounded-lg border-2 border-edge bg-yellow px-2 py-0.5 font-bold text-[#121212]"
                    onClick={() => { if (confirm("Restore this version? Your current text is saved as a version first.")) { edit({ md: v.md, versions: [{ at: Date.now(), md, label: "Before restore" }, ...(page.versions ?? []).filter((_, j) => j !== i)].slice(0, 15) }); setPop(null); } }}>Restore</button>
                </div>
              ))}
            </Pop>
          </div>
        </Group>
        <Group label="AI">
          {!paid ? <RBtn icon={Lock} label="AI assist · Pro" wide onClick={() => gate("ai_assist")} /> : <AssistMenu actions={["continue", "improve", "summarize", "outline", "explain"]}
            getText={() => sel().text || md.slice(-4000)}
            onResult={(t, a) => {
              const { s, e, text } = sel();
              if (a === "improve" && text) { replaceRange(s, e, t); return; }
              const label = { continue: "", summarize: "\n**Summary**\n", outline: "\n", explain: "\n> **Explained simply:** ", improve: "\n" }[a as "continue"] ?? "\n";
              insert(`\n${label}${t}\n`);
            }} />}
        </Group>
      </>
    ),
    view: (
      <>
        <Group label="Layout">
          {([["write", PenLine, "Write"], ["split", Columns2, "Split"], ["preview", Eye, "Print view"], ["latex", FileCode2, "LaTeX source"]] as const).map(([v, I, l]) => (
            <span key={v} className="inline-flex items-center"><RBtn icon={I} label={l} wide active={view === v} onClick={() => setView(v)} />{v === "latex" && !paid && <ProChip />}</span>
          ))}
        </Group>
        <Group label="Show">
          <RBtn icon={ListTree} label="Navigation" wide active={outline} onClick={() => setOutline(!outline)} />
          <RBtn icon={Focus} label="Focus mode" wide active={focus} onClick={() => setFocus(!focus)} />
        </Group>
        <Group label="Zoom">
          <RBtn icon={ZoomOut} label="Zoom out" onClick={() => setZoom(Math.max(70, zoom - 10))} />
          <button type="button" onClick={() => setZoom(100)} className="w-12 text-center text-xs font-bold">{zoom}%</button>
          <RBtn icon={ZoomIn} label="Zoom in" onClick={() => setZoom(Math.min(170, zoom + 10))} />
        </Group>
      </>
    ),
  };

  const body = (
    <div className={clsx(focus && "fixed inset-0 z-50 flex flex-col bg-bg")}>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { uploadImage(e.target.files); e.target.value = ""; }} />
      {/* Ribbon */}
      <div className="border-b-2 border-dashed border-line bg-surface-2/70">
        <div className="flex items-center gap-1 px-3 pt-2">
          {(["home", "insert", "review", "view"] as const).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)} className="relative rounded-t-lg px-3 py-1 text-xs font-extrabold capitalize">
              {tab === t && <motion.span layoutId="ribbon-tab" className="absolute inset-0 rounded-t-lg border-2 border-b-0 border-edge bg-surface" />}
              <span className="relative">{t}</span>
            </button>
          ))}
          {focus && <button type="button" onClick={() => setFocus(false)} className="ml-auto inline-flex items-center gap-1 rounded-lg border-2 border-edge px-2 py-0.5 text-xs font-bold"><X className="size-3.5" />Exit focus</button>}
        </div>
        <motion.div key={tab} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="flex flex-wrap items-end gap-y-1 border-t-2 border-edge bg-surface px-1 py-1.5">
          {ribbon[tab]}
        </motion.div>
      </div>

      {/* Find & replace */}
      <AnimatePresence>
        {findOpen && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden border-b-2 border-dashed border-line bg-surface">
            <div className="flex flex-wrap items-center gap-2 px-4 py-2 text-xs">
              <input id="pe-find" value={find} onChange={(e) => setFind(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); findNext(e.shiftKey); } if (e.key === "Escape") setFindOpen(false); }}
                placeholder="Find" className="w-44 rounded-lg border-2 border-edge bg-bg px-2 py-1" />
              <input id="pe-repl" value={repl} onChange={(e) => setRepl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); replaceOne(); } }}
                placeholder="Replace with" className="w-44 rounded-lg border-2 border-edge bg-bg px-2 py-1" />
              <span className="font-bold text-muted">{find ? `${matches.length} match${matches.length === 1 ? "" : "es"}` : ""}</span>
              <label className="inline-flex items-center gap-1 font-bold"><input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} />Match case</label>
              <button type="button" onClick={() => findNext(true)} className="rounded-lg border-2 border-edge px-2 py-0.5 font-bold">Prev</button>
              <button type="button" onClick={() => findNext()} className="rounded-lg border-2 border-edge px-2 py-0.5 font-bold">Next</button>
              <button type="button" onClick={replaceOne} className="rounded-lg border-2 border-edge bg-yellow px-2 py-0.5 font-bold text-[#121212]">Replace</button>
              <button type="button" onClick={replaceAll} className="rounded-lg border-2 border-edge bg-pink px-2 py-0.5 font-bold text-[#121212]">Replace all</button>
              <button type="button" onClick={() => setFindOpen(false)} className="ml-auto opacity-60 hover:opacity-100" aria-label="Close find"><X className="size-4" /></button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Workspace */}
      <div className={clsx("flex", focus ? "min-h-0 flex-1" : "min-h-[560px]")}>
        {outline && heads.length > 0 && !focus && (
          <nav className="hidden w-52 shrink-0 overflow-y-auto border-r-2 border-dashed border-line bg-surface-2/50 p-3 text-xs xl:block" style={{ maxHeight: 760 }}>
            <div className="mb-2 font-extrabold uppercase tracking-wider text-muted">Navigation</div>
            {heads.map((h) => (
              <button key={h.idx} type="button" onClick={() => jump(h.idx)} className="block w-full truncate rounded-md px-1.5 py-1 text-left hover:bg-yellow hover:text-[#121212]"
                style={{ paddingLeft: 6 + (h.level - 1) * 12, fontWeight: h.level === 1 ? 800 : h.level === 2 ? 650 : 500 }}>{h.text}</button>
            ))}
          </nav>
        )}
        <div className={clsx("grid min-w-0 flex-1", (view === "split" || view === "latex") && "lg:grid-cols-2")}>
          {showEditor && (
            <textarea ref={ta} value={md} onChange={(e) => edit({ md: e.target.value })} onKeyDown={onKey} onKeyUp={onCaret} onClick={onCaret} spellCheck
              onPaste={(e) => { const fs = Array.from(e.clipboardData.files); if (fs.some((f) => f.type.startsWith("image/"))) { e.preventDefault(); uploadImage(fs); } }}
              onDrop={(e) => { const fs = Array.from(e.dataTransfer.files); if (fs.some((f) => f.type.startsWith("image/"))) { e.preventDefault(); uploadImage(fs); } }}
              style={{ fontSize: 13 * zoom / 100, lineHeight: 1.7 }}
              className={clsx("w-full resize-none border-edge bg-surface p-5 font-mono outline-none lg:border-r-2", focus ? "h-full" : "min-h-[560px]",
                focus && view === "write" && "mx-auto max-w-3xl")} />
          )}
          {showPreview && (
            <div className={clsx("overflow-y-auto bg-surface-2/40 p-4", !focus && "max-h-[760px]")}>
              <div ref={previewRef} style={{ zoom: zoom / 100 }} className="mx-auto max-w-[820px] rounded-sm border-2 border-edge bg-surface px-10 py-10 shadow-[4px_4px_0_var(--shadow-c)]">
                <RichMarkdown>{md}</RichMarkdown>
              </div>
            </div>
          )}
          {view === "latex" && !paid && (
            <div className="grid place-items-center bg-surface-2/40 p-6">
              <UnlockPanel feature="latex" title="Live LaTeX, Overleaf-style" className="max-w-md"
                perks={["Watch your page compile to IEEE, Springer or plain LaTeX as you type", "Copy main.tex or open it in Overleaf in one click",
                  "Download Word and a LaTeX .zip with every figure"]} />
            </div>
          )}
          {view === "latex" && paid && (
            <div className={clsx("relative overflow-auto bg-[#1e1e2e] text-[#cdd6f4]", !focus && "max-h-[760px]")}>
              <div className="sticky top-0 flex items-center gap-2 border-b border-white/10 bg-[#181825] px-3 py-1.5 text-[11px] font-bold">
                <FileCode2 className="size-3.5" />main.tex · {page.template.toUpperCase()}
                {latexBusy ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3 text-[#a6e3a1]" />}
                <button type="button" onClick={() => { navigator.clipboard.writeText(latex); toast({ title: "LaTeX copied", tone: "good" }); }} className="ml-auto inline-flex items-center gap-1 rounded-md border border-white/20 px-2 py-0.5 hover:bg-white/10">
                  <ClipboardCopy className="size-3" />Copy</button>
              </div>
              <pre className="p-4 font-mono text-[12px] leading-relaxed" style={{ fontSize: 12 * zoom / 100 }}>
                {latex.split("\n").map((l, i) => (
                  <div key={i} className="flex"><span className="mr-4 w-8 shrink-0 select-none text-right text-white/30">{i + 1}</span>
                    <span className={clsx(l.trimStart().startsWith("%") ? "text-[#6c7086]" : /^\\(section|subsection|begin|end|title|documentclass)/.test(l.trim()) ? "text-[#f5c2e7]" : "")}>{l || " "}</span></div>
                ))}
              </pre>
            </div>
          )}
        </div>
      </div>

      {/* Status bar */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t-2 border-dashed border-line bg-surface-2/70 px-4 py-1.5 text-[11px] font-bold text-muted">
        <span className="text-ink">{stats.words.toLocaleString()} words</span>
        <span>{stats.chars.toLocaleString()} characters</span>
        <span>~{stats.read} min read</span>
        <span>{stats.figs} figures · {stats.tables} tables · {stats.cites} citations</span>
        {showEditor && <span>Ln {caret.line}, Col {caret.col}</span>}
        <span className="ml-auto inline-flex items-center gap-1"><Check className="size-3 text-good" />Autosaved {new Date(page.updated).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
      </div>
    </div>
  );
  return body;
}
