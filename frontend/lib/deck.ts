/**
 * Research-talk deck (.pptx) built with pptxgenjs from /api/paper-studio/{id}/deck.
 * Native charts, tables and shapes (editable in PowerPoint); every number comes from the paper.
 * Works in the browser (download) and in Node (QA script) – the builder is environment-agnostic.
 */
import type PptxGenJS from "pptxgenjs";

export interface Card { title: string; text: string }
export interface DeckData {
  title: string; subtitle: string; author: string; affiliation: string; keywords: string[]; template: string;
  hook_value: string; hook_label: string; problem: Card[]; research_question: string; thesis: string; contributions: Card[];
  gap: Card[]; equation: string; equation_explained: string; method_modules: Card[]; algorithm: string[];
  theory: { kind: string; name: string; statement: string }[]; hypotheses: Card[]; metrics: string[]; limitations: Card[];
  conclusion: string[]; next_steps: string[]; notes: string[];
  data: {
    trend: { labels: string[]; series: { name: string; values: number[] }[] } | null;
    ref_years: { labels: string[]; values: number[] };
    architecture: { nodes: { id: string; label: string; decision: boolean }[]; edges: [string, string][] } | null;
    evaluation: string[][] | null; positioning: string[][] | null;
    experiments?: { rows: { model: string; acc: number | null; f1: number | null }[]; p_value: string | null; dataset: string | null } | null;
    figures: { caption: string; url: string }[];
    stats: { references: number; words?: number; median_ref_year?: number | null; top_cited: number };
    references: { n: number; title: string; year?: number; venue?: string | null }[];
  };
}

// Palette: deep indigo dominates title/closing slides, white content slides, brand pink as the sharp accent.
export interface DeckTheme {
  id: string; name: string; blurb: string;
  ink: string; accent: string; amber: string; teal: string; violet: string; slate: string; soft: string; line: string;
  onDark: string; onDark2: string; chip: string; chipLine: string; panel: string; grid: string; head: string; body: string;
}
export const DECK_THEMES: DeckTheme[] = [
  { id: "aurora", name: "Aurora", blurb: "Deep indigo + brand pink", ink: "1F1B3A", accent: "E8457F", amber: "F2A93B", teal: "1495A3", violet: "6C5CE7", slate: "5B5875",
    soft: "F4F2FA", line: "DCD8EA", onDark: "CFCBE6", onDark2: "E6E2FA", chip: "332D5C", chipLine: "4A4380", panel: "2B2652", grid: "E6E3F0", head: "Cambria", body: "Calibri" },
  { id: "ocean", name: "Ocean", blurb: "Navy + teal, conference classic", ink: "0B2545", accent: "0F9D8F", amber: "F4B942", teal: "2E86DE", violet: "8E7DBE", slate: "4A5D75",
    soft: "EEF4FA", line: "D3DFEA", onDark: "BFD2E6", onDark2: "E3EDF7", chip: "16365F", chipLine: "2B5283", panel: "133056", grid: "E2EAF2", head: "Cambria", body: "Calibri" },
  { id: "forest", name: "Forest", blurb: "Forest green + copper", ink: "1E3A2B", accent: "C7672A", amber: "E3B23C", teal: "3F8F6B", violet: "6D597A", slate: "4F5D52",
    soft: "F2F6F0", line: "D8E2D5", onDark: "C9D9CC", onDark2: "E7F0E8", chip: "2C4D3B", chipLine: "426B55", panel: "26463A", grid: "E3EAE1", head: "Bookman Old Style", body: "Calibri" },
  { id: "crimson", name: "Crimson", blurb: "Berry + gold, thesis defence", ink: "2B0F17", accent: "C8102E", amber: "D9A21B", teal: "3C6E71", violet: "7D5BA6", slate: "5E4A4F",
    soft: "FBF3F2", line: "EAD7D7", onDark: "E2C6CB", onDark2: "F5E6E8", chip: "4A1C27", chipLine: "6E2C3A", panel: "3D1520", grid: "F0E3E3", head: "Century Schoolbook", body: "Arial" },
  { id: "mono", name: "Mono", blurb: "Minimal charcoal + electric blue", ink: "1C1C1E", accent: "2F6FEB", amber: "F2A93B", teal: "14A38B", violet: "7E57C2", slate: "55555A",
    soft: "F5F5F7", line: "DDDDE1", onDark: "C9C9CE", onDark2: "EDEDF0", chip: "2E2E32", chipLine: "4A4A50", panel: "26262A", grid: "E8E8EC", head: "Arial", body: "Arial" },
  { id: "sunset", name: "Sunset", blurb: "Plum + coral, bold keynote", ink: "2D1B3D", accent: "F2545B", amber: "F7B32B", teal: "2A9D8F", violet: "A06CD5", slate: "5D4E6D",
    soft: "FBF4F2", line: "EBDCE0", onDark: "DCCBE6", onDark2: "F3E8F7", chip: "45305A", chipLine: "634878", panel: "3A2550", grid: "F0E5E8", head: "Cambria", body: "Calibri" },
];
const WHITE = "FFFFFF";
let INK = "", PINK = "", AMBER = "", TEAL = "", VIOLET = "", SLATE = "", SOFT = "", LINE = "", ON_DARK = "", ON_DARK2 = "", CHIP = "", CHIP_LINE = "", PANEL = "", GRID = "";
let ACCENTS: string[] = [];
let HEAD = "Cambria", BODY = "Calibri";
function applyDeckTheme(id?: string | DeckTheme) {
  const t = typeof id === "object" ? id : DECK_THEMES.find((x) => x.id === id) ?? DECK_THEMES[0];
  ({ ink: INK, accent: PINK, amber: AMBER, teal: TEAL, violet: VIOLET, slate: SLATE, soft: SOFT, line: LINE, onDark: ON_DARK, onDark2: ON_DARK2,
    chip: CHIP, chipLine: CHIP_LINE, panel: PANEL, grid: GRID, head: HEAD, body: BODY } = t);
  ACCENTS = [PINK, TEAL, AMBER, VIOLET];
}
applyDeckTheme();
const W = 13.333, H = 7.5, M = 0.6;

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

/** Readable text for LaTeX fragments in table cells and labels ($\mathcal{O}(d^2)$ -> O(d²)). */
const SUP: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "n": "ⁿ", "T": "ᵀ", "-": "⁻" };
const GREEK: Record<string, string> = { alpha: "α", beta: "β", gamma: "γ", delta: "δ", Delta: "Δ", epsilon: "ε", theta: "θ", lambda: "λ", mu: "μ",
  nu: "ν", pi: "π", sigma: "σ", Sigma: "Σ", tau: "τ", phi: "φ", omega: "ω", Omega: "Ω", ell: "ℓ", infty: "∞", cdot: "·", times: "×",
  le: "≤", leq: "≤", ge: "≥", geq: "≥", approx: "≈", in: "∈", sum: "Σ", log: "log", sqrt: "√", to: "→", rightarrow: "→" };
export function tex(s: string): string {
  return s.replace(/\$([^$]*)\$/g, (_, m: string) => m
    .replace(/\\(?:mathcal|mathbf|mathrm|text|operatorname|boldsymbol|hat|bar|tilde)\{([^}]*)\}/g, "$1")
    .replace(/\\([A-Za-z]+)/g, (__, w: string) => GREEK[w] ?? w)
    .replace(/\^\{?([0-9nT-])\}?/g, (__, c: string) => SUP[c] ?? `^${c}`)
    .replace(/[{}]/g, "").replace(/\s+/g, " ").trim())
    .replace(/\*\*/g, "");
}
const shadow = () => ({ type: "outer" as const, color: "000000", opacity: 0.12, blur: 8, offset: 2, angle: 90 });

export function buildDeck(Pptx: typeof PptxGenJS, d: DeckData, images: Record<string, string> = {}, theme?: string | DeckTheme): PptxGenJS {
  applyDeckTheme(theme);
  const pres = new Pptx();
  pres.layout = "LAYOUT_WIDE";
  pres.title = d.title;
  pres.author = d.author || "Author";
  pres.theme = { headFontFace: HEAD, bodyFontFace: BODY };
  const short = clip(d.title, 70);
  pres.defineSlideMaster({
    title: "LIGHT", background: { color: WHITE },
    objects: [{ text: { text: short, options: { x: M, y: H - 0.45, w: 9, h: 0.3, fontFace: BODY, fontSize: 10, color: SLATE } } }],
    slideNumber: { x: W - 1.1, y: H - 0.45, w: 0.6, h: 0.3, fontFace: BODY, fontSize: 10, color: SLATE, align: "right" },
  });
  pres.defineSlideMaster({ title: "DARK", background: { color: INK },
    slideNumber: { x: W - 1.1, y: H - 0.45, w: 0.6, h: 0.3, fontFace: BODY, fontSize: 10, color: ON_DARK, align: "right" } });

  let n = 0;
  const notes = (s: PptxGenJS.Slide) => { const t = d.notes[n++]; if (t) s.addNotes(t); };
  const slide = (master: "LIGHT" | "DARK", section: string) => pres.addSlide({ masterName: master, sectionTitle: section });
  const title = (s: PptxGenJS.Slide, t: string, kicker?: string) => {
    if (kicker) s.addText(kicker.toUpperCase(), { x: M, y: 0.35, w: 8, h: 0.35, fontFace: BODY, fontSize: 12, bold: true, color: PINK, charSpacing: 2, isTextBox: true, margin: 0 });
    s.addText(t, { x: M, y: 0.65, w: W - 2 * M, h: 0.8, fontFace: HEAD, fontSize: 34, bold: true, color: INK, isTextBox: true, margin: 0, valign: "top" });
  };
  const badge = (s: PptxGenJS.Slide, label: string, x: number, y: number, color: string, size = 0.55) => {
    s.addShape(pres.ShapeType.ellipse, { x, y, w: size, h: size, fill: { color }, line: { color, width: 0 } });
    s.addText(label, { x, y, w: size, h: size, fontFace: HEAD, fontSize: size > 0.5 ? 18 : 13, bold: true, color: WHITE, align: "center", valign: "middle", isTextBox: true, margin: 0 });
  };
  const card = (s: PptxGenJS.Slide, x: number, y: number, w: number, h: number, c: Card, i: number, num?: string) => {
    s.addShape(pres.ShapeType.roundRect, { x, y, w, h, fill: { color: SOFT }, line: { color: LINE, width: 0.75 }, rectRadius: 0.12, shadow: shadow() });
    const compact = h < 1.9;
    badge(s, num ?? String(i + 1), x + 0.25, y + (compact ? 0.2 : 0.3), ACCENTS[i % ACCENTS.length], compact ? 0.48 : 0.55);
    s.addText(clip(tex(c.title), 60), { x: x + (compact ? 0.9 : 1.0), y: y + (compact ? 0.14 : 0.25), w: w - 1.25, h: compact ? 0.6 : 0.65, fontFace: HEAD, fontSize: compact ? 16 : 17, bold: true, color: INK, valign: "middle", isTextBox: true, margin: 0 });
    s.addText(clip(tex(c.text), compact ? 150 : 190), { x: x + (compact ? 0.9 : 0.3), y: y + (compact ? 0.72 : 1.0), w: w - (compact ? 1.15 : 0.6), h: h - (compact ? 0.82 : 1.2), fontFace: BODY, fontSize: 14, color: SLATE, valign: "top", isTextBox: true, margin: 0, fit: "shrink" });
  };
  const sec = (name: string) => pres.addSection({ title: name });

  // 1 — title
  sec("Opening");
  let s = slide("DARK", "Opening");
  s.addText(`${(d.template || "ieee").toUpperCase()} · RESEARCH TALK`, { x: M, y: 0.7, w: 6, h: 0.4, fontFace: BODY, fontSize: 13, bold: true, color: PINK, charSpacing: 3, isTextBox: true, margin: 0 });
  s.addText(clip(d.title, 140), { x: M, y: 1.3, w: W - 2 * M, h: 2.6, fontFace: HEAD, fontSize: 40, bold: true, color: WHITE, valign: "top", isTextBox: true, margin: 0, fit: "shrink" });
  s.addText(clip(d.subtitle, 150), { x: M, y: 4.05, w: W - 2.5, h: 0.8, fontFace: BODY, fontSize: 18, italic: true, color: ON_DARK, isTextBox: true, margin: 0 });
  s.addText([d.author, d.affiliation].filter(Boolean).join("  ·  ") || " ", { x: M, y: 5.2, w: 9, h: 0.45, fontFace: BODY, fontSize: 16, color: WHITE, isTextBox: true, margin: 0 });
  let kx = M;
  (d.keywords || []).slice(0, 5).forEach((k) => {
    const kw = clip(k, 24), w = 0.4 + kw.length * 0.105, x = kx;
    if (x + w > W - M) return;
    kx += w + 0.15;
    s.addShape(pres.ShapeType.roundRect, { x, y: 5.95, w, h: 0.42, fill: { color: CHIP }, line: { color: CHIP_LINE, width: 0.75 }, rectRadius: 0.2 });
    s.addText(kw, { x, y: 5.95, w, h: 0.42, fontFace: BODY, fontSize: 12, color: ON_DARK2, align: "center", valign: "middle", isTextBox: true, margin: 0 });
  });
  notes(s);

  // agenda: one numbered chip per part of the talk
  s = slide("LIGHT", "Opening");
  title(s, "Today's talk", "Agenda");
  const parts = ["The problem", "Our approach", "Evidence", ...(d.data.experiments ? ["Pilot experiments"] : []), "Evaluation plan", "Takeaways"];
  parts.forEach((t, i) => {
    const col = i % 2, row = Math.floor(i / 2), x = M + col * 6.1, y = 1.8 + row * 1.5;
    badge(s, String(i + 1).padStart(2, "0"), x, y + 0.1, ACCENTS[i % ACCENTS.length], 0.8);
    s.addText(t, { x: x + 1.05, y, w: 4.8, h: 1.0, fontFace: HEAD, fontSize: 24, bold: true, color: INK, valign: "middle", isTextBox: true, margin: 0 });
  });

  // 2 — problem with stat callout
  sec("Motivation");
  s = slide("LIGHT", "Motivation");
  title(s, "Why this problem matters", "The problem");
  s.addShape(pres.ShapeType.roundRect, { x: M, y: 1.8, w: 4.2, h: 4.6, fill: { color: INK }, line: { color: INK, width: 0 }, rectRadius: 0.15 });
  s.addText(clip(d.hook_value, 14), { x: M + 0.3, y: 2.2, w: 3.6, h: 1.6, fontFace: HEAD, fontSize: 60, bold: true, color: PINK, isTextBox: true, margin: 0, fit: "shrink" });
  s.addText(clip(d.hook_label, 120), { x: M + 0.3, y: 3.9, w: 3.6, h: 2.2, fontFace: BODY, fontSize: 16, color: WHITE, valign: "top", isTextBox: true, margin: 0 });
  d.problem.slice(0, 3).forEach((c, i) => card(s, M + 4.6, 1.8 + i * 1.6, W - 2 * M - 4.6, 1.42, c, i));
  notes(s);

  // 3 — research question
  s = slide("LIGHT", "Motivation");
  title(s, "Research question", "What we ask");
  s.addText("“", { x: M, y: 1.6, w: 1.2, h: 1.4, fontFace: HEAD, fontSize: 110, bold: true, color: PINK, isTextBox: true, margin: 0 });
  s.addText(clip(d.research_question, 240), { x: M + 1.2, y: 1.9, w: W - 2 * M - 1.4, h: 2.4, fontFace: HEAD, fontSize: 28, italic: true, color: INK, valign: "middle", isTextBox: true, margin: 0, fit: "shrink" });
  s.addShape(pres.ShapeType.roundRect, { x: M + 1.2, y: 4.7, w: W - 2 * M - 1.4, h: 1.5, fill: { color: SOFT }, line: { color: LINE, width: 0.75 }, rectRadius: 0.12 });
  s.addText([{ text: "Thesis  ", options: { bold: true, color: PINK } }, { text: clip(d.thesis, 220), options: { color: INK } }],
    { x: M + 1.5, y: 4.8, w: W - 2 * M - 2, h: 1.3, fontFace: BODY, fontSize: 17, valign: "middle", isTextBox: true, margin: 0 });
  notes(s);

  // 4 — contributions 2x2
  s = slide("LIGHT", "Motivation");
  title(s, "Contributions", "What this paper delivers");
  d.contributions.slice(0, 4).forEach((c, i) => card(s, M + (i % 2) * 6.15, 1.75 + Math.floor(i / 2) * 2.45, 5.9, 2.25, c, i));
  notes(s);

  // 5 — gap / positioning
  sec("Approach");
  s = slide("LIGHT", "Approach");
  title(s, "Where prior work falls short", "Related work");
  const pos = d.data.positioning;
  if (pos && pos.length > 2) {
    const rows = pos.slice(0, 7).map((r, ri) => r.slice(0, 7).map((c) => ({ text: clip(tex(c), 40), options: {
      bold: ri === 0, color: ri === 0 ? WHITE : /^yes/i.test(c) ? "0E7A5F" : /^no/i.test(c) ? "B4234F" : INK,
      fill: { color: ri === 0 ? INK : ri % 2 ? WHITE : SOFT } } })));
    s.addTable(rows, { x: M, y: 1.75, w: W - 2 * M, fontFace: BODY, fontSize: 13, border: { type: "solid", pt: 0.5, color: LINE }, valign: "middle", rowH: 0.48 });
  } else {
    d.gap.slice(0, 3).forEach((c, i) => card(s, M + i * 4.1, 1.9, 3.85, 4.4, c, i));
  }
  notes(s);

  // 6 — formulation / key equation
  s = slide("LIGHT", "Approach");
  title(s, "Problem formulation", "The model");
  s.addShape(pres.ShapeType.roundRect, { x: M, y: 1.9, w: W - 2 * M, h: 2.2, fill: { color: SOFT }, line: { color: LINE, width: 0.75 }, rectRadius: 0.15 });
  s.addText(clip(d.equation, 120), { x: M + 0.4, y: 2.0, w: W - 2 * M - 0.8, h: 2.0, fontFace: "Cambria Math", fontSize: 30, color: INK, align: "center", valign: "middle", isTextBox: true, margin: 0, fit: "shrink" });
  badge(s, "∑", M, 4.65, TEAL, 0.7);
  s.addText(clip(d.equation_explained, 260), { x: M + 1.0, y: 4.55, w: W - 2 * M - 1.2, h: 1.6, fontFace: BODY, fontSize: 18, color: SLATE, valign: "middle", isTextBox: true, margin: 0 });
  notes(s);

  // 7 — architecture: native shapes from the paper's own diagram
  s = slide("LIGHT", "Approach");
  title(s, "Architecture", "How it works");
  const arch = d.data.architecture;
  if (arch && arch.nodes.length >= 2) {
    const ns = arch.nodes.slice(0, 8), per = Math.ceil(ns.length / 2) > 4 ? Math.ceil(ns.length / 2) : Math.min(ns.length, 4);
    const rowsN = Math.ceil(ns.length / per), bw = 2.35, bh = 0.95, gapX = (W - 2 * M - per * bw) / Math.max(1, per - 1);
    const pos2: Record<string, { x: number; y: number }> = {};
    ns.forEach((nd, i) => {
      const r = Math.floor(i / per), c = r % 2 ? per - 1 - (i % per) : i % per;   // snake layout keeps arrows short
      const x = M + c * (bw + gapX), y = 1.85 + r * (rowsN > 1 ? 1.75 : 0) + (rowsN > 1 ? 0 : 0.8);
      pos2[nd.id] = { x, y };
      s.addShape(pres.ShapeType.roundRect, { x, y, w: bw, h: bh, rectRadius: nd.decision ? 0.45 : 0.12,
        fill: { color: i === 0 ? INK : nd.decision ? AMBER : SOFT }, line: { color: i === 0 ? INK : ACCENTS[i % 4], width: 1.5 }, shadow: shadow() });
      s.addText(clip(tex(nd.label), 34), { x: x + 0.08, y, w: bw - 0.16, h: bh, fontFace: BODY, fontSize: 13, bold: true, align: "center", valign: "middle",
        color: i === 0 ? WHITE : INK, isTextBox: true, margin: 0, fit: "shrink" });
    });
    arch.edges.forEach(([a, b]) => {
      const p = pos2[a], q = pos2[b];
      if (!p || !q) return;
      const ax = p.x + bw / 2, ay = p.y + bh / 2, bx = q.x + bw / 2, by = q.y + bh / 2;
      const dx = bx - ax, dy = by - ay;
      const sx = Math.abs(dx) >= Math.abs(dy) ? ax + Math.sign(dx) * bw / 2 : ax, sy = Math.abs(dx) >= Math.abs(dy) ? ay : ay + Math.sign(dy) * bh / 2;
      const ex = Math.abs(dx) >= Math.abs(dy) ? bx - Math.sign(dx) * bw / 2 : bx, ey = Math.abs(dx) >= Math.abs(dy) ? by : by - Math.sign(dy) * bh / 2;
      s.addShape(pres.ShapeType.line, { x: Math.min(sx, ex), y: Math.min(sy, ey), w: Math.max(0.01, Math.abs(ex - sx)), h: Math.max(0.01, Math.abs(ey - sy)),
        flipH: ex < sx, flipV: ey < sy, line: { color: SLATE, width: 1.75, endArrowType: "triangle" } });
    });
  }
  d.method_modules.slice(0, 3).forEach((c, i) => {
    const x = M + i * 4.1;
    s.addText([{ text: clip(c.title, 40) + "\n", options: { bold: true, color: ACCENTS[i % 4], fontSize: 15 } }, { text: clip(c.text, 110), options: { color: SLATE, fontSize: 13 } }],
      { x, y: 5.45, w: 3.85, h: 1.35, fontFace: BODY, valign: "top", isTextBox: true, margin: 0 });
  });
  notes(s);

  // 8 — algorithm as a process flow
  s = slide("LIGHT", "Approach");
  title(s, "Algorithm 1 at a glance", "Procedure");
  const steps = d.algorithm.slice(0, 5), sw = (W - 2 * M - (steps.length - 1) * 0.25) / Math.max(1, steps.length);
  steps.forEach((t, i) => {
    const x = M + i * (sw + 0.25);
    s.addShape(pres.ShapeType.roundRect, { x, y: 2.3, w: sw, h: 3.4, fill: { color: i === steps.length - 1 ? INK : SOFT }, line: { color: LINE, width: 0.75 }, rectRadius: 0.15, shadow: shadow() });
    badge(s, String(i + 1), x + sw / 2 - 0.35, 1.95, ACCENTS[i % 4], 0.7);
    s.addText(clip(t, 110), { x: x + 0.2, y: 2.9, w: sw - 0.4, h: 2.6, fontFace: BODY, fontSize: 15, color: i === steps.length - 1 ? WHITE : INK, valign: "top", align: "left", isTextBox: true, margin: 0 });
  });
  notes(s);

  // 9 — theory
  s = slide("LIGHT", "Approach");
  title(s, "Formal guarantees", "Theory");
  const th = d.theory.slice(0, 3), tw = (W - 2 * M - (th.length - 1) * 0.3) / Math.max(1, th.length);
  th.forEach((t, i) => {
    const x = M + i * (tw + 0.3);
    s.addShape(pres.ShapeType.roundRect, { x, y: 1.9, w: tw, h: 4.5, fill: { color: SOFT }, line: { color: LINE, width: 0.75 }, rectRadius: 0.15, shadow: shadow() });
    s.addShape(pres.ShapeType.roundRect, { x: x + 0.3, y: 2.2, w: 1.9, h: 0.45, fill: { color: ACCENTS[i % 4] }, line: { color: ACCENTS[i % 4], width: 0 }, rectRadius: 0.2 });
    s.addText(clip(t.kind, 16).toUpperCase(), { x: x + 0.3, y: 2.2, w: 1.9, h: 0.45, fontFace: BODY, fontSize: 12, bold: true, color: WHITE, align: "center", valign: "middle", isTextBox: true, margin: 0 });
    s.addText(clip(t.name, 60), { x: x + 0.3, y: 2.85, w: tw - 0.6, h: 0.8, fontFace: HEAD, fontSize: 18, bold: true, color: INK, valign: "top", isTextBox: true, margin: 0 });
    s.addText(clip(t.statement, 230), { x: x + 0.3, y: 3.7, w: tw - 0.6, h: 2.5, fontFace: BODY, fontSize: 14, italic: true, color: SLATE, valign: "top", isTextBox: true, margin: 0 });
  });
  notes(s);

  // 10 — literature trend (native line chart)
  sec("Evidence");
  s = slide("LIGHT", "Evidence");
  title(s, "The field is moving", "Measured trend");
  const tr = d.data.trend;
  const trendImg = d.data.figures.find((f) => f.url.includes("trend"));
  if (tr && tr.series.length) {
    s.addChart(pres.ChartType.line, tr.series.map((x) => ({ name: x.name, labels: tr.labels, values: x.values })), {
      x: M, y: 1.7, w: 8.4, h: 4.9, chartColors: [PINK, TEAL, AMBER, VIOLET], lineSize: 2.5, lineDataSymbol: "circle", lineDataSymbolSize: 7,
      showLegend: true, legendPos: "b", legendFontFace: "+mn-lt", legendFontSize: 12, legendColor: SLATE,
      catAxisLabelColor: SLATE, valAxisLabelColor: SLATE, catAxisLabelFontFace: "+mn-lt", valAxisLabelFontFace: "+mn-lt", catAxisLabelFontSize: 11, valAxisLabelFontSize: 11,
      valGridLine: { color: GRID, size: 0.5 }, catGridLine: { style: "none" }, showTitle: true, title: "Works per year (OpenAlex; latest year partial)",
      titleFontFace: "+mn-lt", titleFontSize: 13, titleColor: INK,
    });
    const first = tr.series[0];
    const full = first.values.slice(0, -1).filter((v) => v > 0);
    const growth = full.length > 1 && full[0] ? `${(full[full.length - 1] / full[0]).toFixed(1)}×` : `${first.values.at(-1) ?? 0}`;
    s.addText(growth, { x: 9.5, y: 2.1, w: 3.2, h: 1.4, fontFace: HEAD, fontSize: 60, bold: true, color: PINK, isTextBox: true, margin: 0 });
    s.addText(`growth in “${clip(first.name, 40)}” across complete years`, { x: 9.5, y: 3.5, w: 3.2, h: 1.2, fontFace: BODY, fontSize: 15, color: SLATE, isTextBox: true, margin: 0, valign: "top" });
  } else if (trendImg && images[trendImg.url]) {
    s.addImage({ data: images[trendImg.url], x: M, y: 1.7, w: 8.4, h: 4.6, sizing: { type: "contain", w: 8.4, h: 4.6 } });
  }
  notes(s);

  // 11 — cited literature profile
  s = slide("LIGHT", "Evidence");
  title(s, "Grounded in recent literature", "Evidence base");
  const ry = d.data.ref_years;
  if (ry.labels.length) {
    s.addChart(pres.ChartType.bar, [{ name: "Cited works", labels: ry.labels, values: ry.values }], {
      x: M, y: 1.7, w: 7.6, h: 4.9, barDir: "col", chartColors: [TEAL], showValue: true, dataLabelPosition: "outEnd", dataLabelColor: INK, dataLabelFontSize: 11,
      dataLabelFontFace: "+mn-lt", showLegend: false, catAxisLabelColor: SLATE, valAxisLabelColor: SLATE, catAxisLabelFontFace: "+mn-lt", valAxisLabelFontFace: "+mn-lt",
      catAxisLabelFontSize: 11, valAxisLabelFontSize: 11, valGridLine: { color: GRID, size: 0.5 }, catGridLine: { style: "none" },
      showTitle: true, title: "Cited works by publication year", titleFontFace: "+mn-lt", titleFontSize: 13, titleColor: INK,
    });
  }
  const st = d.data.stats;
  [[String(st.references), "verified references"], [String(st.median_ref_year ?? "—"), "median publication year"], [st.top_cited.toLocaleString("en-US"), "citations, most-cited source"]]
    .forEach(([v, l], i) => {
      const y = 1.8 + i * 1.6;
      s.addShape(pres.ShapeType.roundRect, { x: 8.7, y, w: 4.0, h: 1.4, fill: { color: i === 0 ? INK : SOFT }, line: { color: LINE, width: 0.75 }, rectRadius: 0.12 });
      s.addText(v, { x: 8.95, y: y + 0.1, w: 3.6, h: 0.75, fontFace: HEAD, fontSize: 32, bold: true, color: i === 0 ? PINK : INK, isTextBox: true, margin: 0 });
      s.addText(l, { x: 8.95, y: y + 0.85, w: 3.6, h: 0.4, fontFace: BODY, fontSize: 13, color: i === 0 ? ON_DARK : SLATE, isTextBox: true, margin: 0 });
    });
  notes(s);

  // pilot experiments: native bar chart of measured macro-F1 + confusion matrix image
  const ex = d.data.experiments;
  if (ex && ex.rows.length >= 2) {
    sec("Pilot experiments");
    s = slide("LIGHT", "Pilot experiments");
    title(s, "What the pilot runs measured", "Pilot experiments");
    s.addChart(pres.ChartType.bar, [{ name: "Macro-F1 (%)", labels: ex.rows.map((x) => clip(x.model, 22)), values: ex.rows.map((x) => x.f1 ?? 0) }], {
      x: M, y: 1.7, w: 8.2, h: 4.9, barDir: "col", chartColors: [PINK, TEAL, AMBER, VIOLET, INK, SLATE], showValue: true, dataLabelPosition: "outEnd",
      dataLabelColor: INK, dataLabelFontSize: 11, dataLabelFontFace: "+mn-lt", dataLabelFormatCode: "0.0", showLegend: false,
      catAxisLabelColor: SLATE, valAxisLabelColor: SLATE, catAxisLabelFontFace: "+mn-lt", valAxisLabelFontFace: "+mn-lt", catAxisLabelFontSize: 11, valAxisLabelFontSize: 11,
      valAxisMinVal: Math.max(0, Math.floor(Math.min(...ex.rows.map((x) => x.f1 ?? 0)) - 10)), valAxisMaxVal: 100,
      valGridLine: { color: GRID, size: 0.5 }, catGridLine: { style: "none" }, showTitle: true, title: "Macro-F1 by model (15-fold CV, executed)",
      titleFontFace: "+mn-lt", titleFontSize: 13, titleColor: INK,
    });
    const best = ex.rows[0];
    s.addShape(pres.ShapeType.roundRect, { x: 9.2, y: 1.8, w: 3.5, h: 2.2, fill: { color: INK }, line: { color: INK, width: 0 }, rectRadius: 0.12 });
    s.addText(`${(best.f1 ?? 0).toFixed(1)}%`, { x: 9.45, y: 1.95, w: 3.0, h: 1.0, fontFace: HEAD, fontSize: 40, bold: true, color: PINK, isTextBox: true, margin: 0 });
    s.addText(`macro-F1, ${clip(best.model, 26)}`, { x: 9.45, y: 2.95, w: 3.0, h: 0.8, fontFace: BODY, fontSize: 14, color: ON_DARK, isTextBox: true, margin: 0, valign: "top" });
    s.addText([
      { text: ex.dataset ? clip(ex.dataset, 70) : "Public benchmark data", options: { bold: true, color: INK, breakLine: true } },
      { text: ex.p_value ? `Best vs. runner-up: paired t-test p = ${ex.p_value}` : "Repeated stratified cross-validation", options: { color: SLATE } },
    ], { x: 9.2, y: 4.25, w: 3.5, h: 1.6, fontFace: BODY, fontSize: 13, valign: "top", isTextBox: true, margin: 0 });
    s.addText("Pilot runs on public data, executed by the pipeline; not a full evaluation of the proposed method.",
      { x: M, y: 6.65, w: W - 2 * M, h: 0.35, fontFace: BODY, fontSize: 11, italic: true, color: SLATE, isTextBox: true, margin: 0 });
    const cmImg = d.data.figures.find((f) => f.url.includes("exp_cm"));
    const simImg = d.data.figures.find((f) => f.url.includes("exp_sim0")) ?? d.data.figures.find((f) => f.url.includes("exp_sweep"));
    if ((cmImg && images[cmImg.url]) || (simImg && images[simImg.url])) {
      s = slide("LIGHT", "Pilot experiments");
      title(s, "Where the errors are", "Pilot experiments");
      [cmImg, simImg].filter((f): f is { caption: string; url: string } => !!f && !!images[f.url]).forEach((f, i, arr) => {
        const w = arr.length === 2 ? 5.9 : 9.0, x = arr.length === 2 ? M + i * 6.2 : (W - 9.0) / 2;
        s.addImage({ data: images[f.url], x, y: 1.7, w, h: 4.4, sizing: { type: "contain", w, h: 4.4 } });
        s.addText(clip(f.caption, 140), { x, y: 6.15, w, h: 0.6, fontFace: BODY, fontSize: 11, color: SLATE, isTextBox: true, margin: 0, valign: "top" });
      });
    }
  }

  // 12 — hypotheses + metrics
  sec("Evaluation plan");
  s = slide("LIGHT", "Evaluation plan");
  title(s, "What we will test", "Hypotheses");
  d.hypotheses.slice(0, 3).forEach((c, i) => card(s, M + i * 4.1, 1.75, 3.85, 3.3, c, i, `H${i + 1}`));
  s.addText("Metrics", { x: M, y: 5.35, w: 2, h: 0.4, fontFace: HEAD, fontSize: 16, bold: true, color: INK, isTextBox: true, margin: 0 });
  let mx = M;
  d.metrics.slice(0, 5).forEach((m, i) => {
    const t = clip(tex(m), 30), w = 0.5 + t.length * 0.11;
    if (mx + w > W - M) return;
    s.addShape(pres.ShapeType.roundRect, { x: mx, y: 5.85, w, h: 0.5, fill: { color: ACCENTS[i % 4] }, line: { color: ACCENTS[i % 4], width: 0 }, rectRadius: 0.25 });
    s.addText(t, { x: mx, y: 5.85, w, h: 0.5, fontFace: BODY, fontSize: 13, bold: true, color: WHITE, align: "center", valign: "middle", isTextBox: true, margin: 0 });
    mx += w + 0.2;
  });
  notes(s);

  // 13 — evaluation table (planned)
  s = slide("LIGHT", "Evaluation plan");
  title(s, "Planned benchmark", "Experiments to run");
  const ev = d.data.evaluation;
  if (ev && ev.length > 1) {
    const cols = Math.min(6, ev[0].length);
    const rows = ev.slice(0, 8).map((r, ri) => r.slice(0, cols).map((c) => ({ text: clip(tex(c), 34), options: {
      bold: ri === 0, italic: /to be measured/i.test(c), color: ri === 0 ? WHITE : /to be measured/i.test(c) ? "8A86A6" : INK,
      fill: { color: ri === 0 ? INK : ri % 2 ? WHITE : SOFT } } })));
    s.addTable(rows, { x: M, y: 1.75, w: W - 2 * M, fontFace: BODY, fontSize: 13, border: { type: "solid", pt: 0.5, color: LINE }, valign: "middle", rowH: 0.5 });
  }
  s.addText("Cells read “to be measured” until the experiments are run. Report only numbers you measure.", { x: M, y: 6.35, w: W - 2 * M, h: 0.4, fontFace: BODY, fontSize: 12, italic: true, color: SLATE, isTextBox: true, margin: 0 });
  notes(s);

  // 14 — limitations 2x2
  s = slide("LIGHT", "Evaluation plan");
  title(s, "Limitations and failure modes", "Honest scope");
  d.limitations.slice(0, 4).forEach((c, i) => card(s, M + (i % 2) * 6.15, 1.75 + Math.floor(i / 2) * 2.45, 5.9, 2.25, c, i, "!"));
  notes(s);

  // 15 — conclusion (dark)
  sec("Close");
  s = slide("DARK", "Close");
  s.addText("Takeaways", { x: M, y: 0.6, w: 8, h: 0.8, fontFace: HEAD, fontSize: 36, bold: true, color: WHITE, isTextBox: true, margin: 0 });
  d.conclusion.slice(0, 3).forEach((t, i) => {
    badge(s, String(i + 1), M, 1.82 + i * 1.3, ACCENTS[i % 4]);
    s.addText(clip(tex(t), 170), { x: M + 0.8, y: 1.55 + i * 1.3, w: 6.5, h: 1.1, fontFace: BODY, fontSize: 17, color: WHITE, valign: "middle", isTextBox: true, margin: 0, fit: "shrink" });
  });
  s.addShape(pres.ShapeType.roundRect, { x: 8.0, y: 1.6, w: 4.7, h: 4.6, fill: { color: PANEL }, line: { color: CHIP_LINE, width: 0.75 }, rectRadius: 0.15 });
  s.addText("Next steps", { x: 8.3, y: 1.85, w: 4.1, h: 0.5, fontFace: HEAD, fontSize: 20, bold: true, color: AMBER, isTextBox: true, margin: 0 });
  s.addText(d.next_steps.slice(0, 3).map((t, i, a) => ({ text: clip(t, 90), options: { bullet: true, breakLine: i < a.length - 1 } })),
    { x: 8.3, y: 2.45, w: 4.1, h: 3.5, fontFace: BODY, fontSize: 16, color: ON_DARK2, valign: "top", paraSpaceAfter: 10, isTextBox: true, margin: 0 });
  notes(s);

  // 16 — references + Q&A
  s = slide("LIGHT", "Close");
  title(s, "Key references", "Thank you · Questions?");
  s.addText(d.data.references.slice(0, 8).map((r, i, a) => ({
    text: `[${r.n}] ${clip(r.title || "", 95)}${r.year ? ` (${r.year})` : ""}${r.venue ? `, ${clip(r.venue, 40)}` : ""}`,
    options: { breakLine: i < a.length - 1 } })), { x: M, y: 1.75, w: 8.4, h: 4.9, fontFace: BODY, fontSize: 13, color: INK, valign: "top", paraSpaceAfter: 8, isTextBox: true, margin: 0 });
  s.addShape(pres.ShapeType.roundRect, { x: 9.4, y: 1.75, w: 3.3, h: 4.6, fill: { color: INK }, line: { color: INK, width: 0 }, rectRadius: 0.15 });
  s.addText("Q&A", { x: 9.4, y: 2.6, w: 3.3, h: 1.4, fontFace: HEAD, fontSize: 54, bold: true, color: PINK, align: "center", isTextBox: true, margin: 0 });
  s.addText([d.author, d.affiliation].filter(Boolean).join("\n") || " ", { x: 9.6, y: 4.1, w: 2.9, h: 1.6, fontFace: BODY, fontSize: 14, color: WHITE, align: "center", valign: "top", isTextBox: true, margin: 0 });
  notes(s);

  return pres;
}

/** Browser: fetch content + figures, build, and download. */
export async function downloadDeck(paperId: string, author: string, affiliation: string, apiFetch: (p: string, i?: RequestInit) => Promise<Response>, fileBase: string, theme?: string | DeckTheme) {
  const r = await apiFetch(`/api/paper-studio/${paperId}/deck`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ author, affiliation }) });
  if (!r.ok) {
    let msg = `${r.status}`;
    try { const b = await r.json(); msg = typeof b.detail === "string" ? b.detail : b.detail?.message ?? msg; } catch { /* keep status */ }
    throw new Error(msg);
  }
  const d = (await r.json()) as DeckData;
  const images: Record<string, string> = {};
  for (const f of d.data.figures) {
    try {
      const blob = await (await apiFetch(f.url)).blob();
      images[f.url] = await new Promise<string>((ok) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).replace(/^data:/, "")); fr.readAsDataURL(blob); });
    } catch { /* chart falls back to native data */ }
  }
  const Pptx = (await import("pptxgenjs")).default;
  await buildDeck(Pptx, d, images, theme).writeFile({ fileName: `${fileBase}-presentation.pptx` });
}
