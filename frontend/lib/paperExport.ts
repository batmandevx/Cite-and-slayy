"use client";

import { track } from "./track";
import { apiFetch, toast } from "./api";

export interface PaperDoc { title: string; markdown: string; template: string; author: string; affiliation: string }
export type ExportFormat = "docx" | "latex-zip" | "latex";

/** Render one Mermaid diagram to a PNG data URL (SVG-only labels, so the canvas stays exportable). */
async function mermaidPng(code: string): Promise<string | null> {
  try {
    const mermaid = (await import("mermaid")).default;
    mermaid.initialize({ startOnLoad: false, theme: "default", securityLevel: "strict", flowchart: { htmlLabels: false }, suppressErrorRendering: true,
      themeVariables: { fontFamily: "Arial, Helvetica, sans-serif", primaryColor: "#eef3ff", primaryBorderColor: "#2a6fdb", lineColor: "#333333" } });
    if (!(await mermaid.parse(code, { suppressErrors: true }))) return null;
    const rid = `x${Math.random().toString(36).slice(2, 9)}`;
    let svg: string;
    try { ({ svg } = await mermaid.render(rid, code)); } finally { document.getElementById(`d${rid}`)?.remove(); }
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    const el = doc.documentElement;
    const vb = (el.getAttribute("viewBox") ?? "0 0 800 400").split(/\s+/).map(Number);
    const w = vb[2] || 800, h = vb[3] || 400;
    el.setAttribute("width", String(w)); el.setAttribute("height", String(h));
    const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(el));
    const img = new Image();
    await new Promise<void>((ok, bad) => { img.onload = () => ok(); img.onerror = () => bad(new Error("svg load")); img.src = url; });
    const scale = Math.min(3, 2400 / w);
    const c = document.createElement("canvas");
    c.width = Math.round(w * scale); c.height = Math.round(h * scale);
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/png");
  } catch {
    return null;   // the exporter falls back to a clearly marked placeholder
  }
}

export async function renderDiagrams(md: string): Promise<(string | null)[]> {
  const blocks = [...md.matchAll(/```mermaid\s*\n([\s\S]*?)\n```/g)].map((m) => m[1]);
  const out: (string | null)[] = [];
  for (const b of blocks) out.push(await mermaidPng(b));   // sequential: mermaid keeps global state
  return out;
}

export function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

const slug = (s: string) => s.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 60) || "paper";

/** Word (.docx) or LaTeX (.zip with figures, or bare .tex) with figures and diagrams embedded. */
export async function exportPaper(fmt: ExportFormat, doc: PaperDoc) {
  const diagrams = fmt === "latex" ? [] : await renderDiagrams(doc.markdown);
  const r = await apiFetch(`/api/export/${fmt}`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...doc, diagrams }) });
  if (!r.ok) { toast({ title: "Export failed", body: `${r.status}`, tone: "crit" }); return; }
  track("export");
  const ext = fmt === "docx" ? ".docx" : fmt === "latex-zip" ? `-${doc.template}-latex.zip` : `-${doc.template}.tex`;
  download(await r.blob(), slug(doc.title) + ext);
  toast({ title: fmt === "docx" ? "Word file downloaded" : `LaTeX (${doc.template.toUpperCase()}) downloaded`,
    body: fmt === "latex-zip" ? "Upload the .zip to Overleaf: New Project → Upload Project." : undefined, tone: "good" });
}

/** Print-to-PDF from rendered HTML (keeps equations, figures and diagrams exactly as shown, styled as an IEEE/academic monograph). */
export function printPdf(title: string, byline: string, html: string, template: string) {
  const w = window.open("", "_blank");
  if (!w) { toast({ title: "Allow pop-ups to export PDF", tone: "crit" }); return; }
  const styles = [...document.querySelectorAll("style, link[rel=stylesheet]")].map((n) => n.outerHTML).join("");
  const twoCol = template === "ieee";
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
  const banner = twoCol
    ? `<div class="ieee-bar"><span>IEEE MONOGRAPH FORMAT · VERIFIED SCHOLARLY CITATIONS</span><span>CITE &amp; SLAYY PAPER STUDIO</span></div>`
    : "";
  w.document.write(`<!doctype html><html data-theme="light"><head><title>${esc(title)}</title>${styles}
    <style>
      body{background:#fff!important;background-image:none!important;color:#111!important;padding:0;margin:0;font-family:"Times New Roman",Georgia,serif}
      .page{max-width:${twoCol ? "1040px" : "780px"};margin:auto;padding:28px 34px}
      .ieee-bar{display:flex;justify-content:space-between;border-top:2.5px solid #111;border-bottom:1px solid #555;padding:4px 0;margin-bottom:18px;font-family:Arial,Helvetica,sans-serif;font-size:7.5pt;font-weight:700;letter-spacing:.08em;color:#333}
      h1.ttl{font-size:${twoCol ? "22pt" : "24pt"};text-align:${twoCol ? "left" : "center"};margin:0 0 8px;font-family:"Times New Roman",Georgia,serif;font-weight:700;line-height:1.2;color:#0f172a}
      p.auth{text-align:${twoCol ? "left" : "center"};color:#334155;margin:0 0 18px;padding-bottom:12px;border-bottom:1px solid #cbd5e1;font-size:10.5pt;font-style:italic}
      .paper-preview h1.mb-1,.paper-preview p.mb-6{display:none!important}
      .md{font-size:${twoCol ? "9.6pt" : "11pt"};line-height:1.48;${twoCol ? "column-count:2;column-gap:24px;" : ""}text-align:justify;color:#111}
      .md h1,.md h2,.md h3{font-family:"Times New Roman",Georgia,serif;break-after:avoid;color:#111}
      .md h1{font-size:11pt;text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid #333;padding-bottom:2px;margin:14px 0 6px;text-align:left}
      .md h2{font-size:10pt;font-style:italic;font-weight:700;margin:10px 0 4px;text-align:left}
      .md img,.md svg{max-width:100%;height:auto;break-inside:avoid}
      .md table{display:table!important;font-family:Arial,Helvetica,sans-serif;font-size:7.8pt;break-inside:avoid;width:100%;border-collapse:collapse;border-top:1.8px solid #111;border-bottom:1.8px solid #111;margin:8px 0}
      .md th{background:#f8fafc!important;color:#111!important;border:none!important;border-bottom:1.2px solid #111!important;padding:4px 5px;font-weight:700;text-align:left}
      .md td{border:none!important;border-bottom:0.6px solid #d1d5db!important;padding:3.5px 5px;vertical-align:top;text-align:left;color:#111}
      .md blockquote{background:#f8fafc!important;border:1px solid #cbd5e1!important;border-left:3px solid #1d4ed8!important;padding:6px 9px;margin:8px 0;break-inside:avoid;font-size:8.8pt;text-align:left}
      .md figure,.md pre{break-inside:avoid}
      @page{margin:14mm}
    </style></head><body><div class="page">${banner}<h1 class="ttl">${esc(title)}</h1><p class="auth">${esc(byline)}</p>${html}</div></body></html>`);
  w.document.close();
  setTimeout(() => w.print(), 900);
}
