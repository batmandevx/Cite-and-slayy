"use client";

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
  const ext = fmt === "docx" ? ".docx" : fmt === "latex-zip" ? `-${doc.template}-latex.zip` : `-${doc.template}.tex`;
  download(await r.blob(), slug(doc.title) + ext);
  toast({ title: fmt === "docx" ? "Word file downloaded" : `LaTeX (${doc.template.toUpperCase()}) downloaded`,
    body: fmt === "latex-zip" ? "Upload the .zip to Overleaf: New Project → Upload Project." : undefined, tone: "good" });
}

/** Print-to-PDF from rendered HTML (keeps equations, figures and diagrams exactly as shown). */
export function printPdf(title: string, byline: string, html: string, template: string) {
  const w = window.open("", "_blank");
  if (!w) { toast({ title: "Allow pop-ups to export PDF", tone: "crit" }); return; }
  const styles = [...document.querySelectorAll("style, link[rel=stylesheet]")].map((n) => n.outerHTML).join("");
  const twoCol = template === "ieee";
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
  w.document.write(`<!doctype html><html data-theme="light"><head><title>${esc(title)}</title>${styles}
    <style>
      body{background:#fff!important;background-image:none!important;color:#111;padding:0;margin:0;font-family:"Times New Roman",Georgia,serif}
      .page{max-width:${twoCol ? "1000px" : "760px"};margin:auto;padding:36px}
      h1.ttl{font-size:${twoCol ? "24px" : "26px"};text-align:center;margin:0 0 6px;font-family:inherit;line-height:1.25}
      p.auth{text-align:center;color:#444;margin:0 0 22px;font-style:italic}
      .md{font-size:${twoCol ? "10pt" : "11.5pt"};line-height:1.45;${twoCol ? "column-count:2;column-gap:26px;" : ""}text-align:justify}
      .md h1,.md h2,.md h3{font-family:inherit;break-after:avoid}
      .md h1{font-size:12pt;text-transform:uppercase;letter-spacing:.04em;text-align:center;margin:14px 0 6px}
      .md h2{font-size:11pt;font-style:italic;margin:10px 0 4px}
      .md img,.md svg{max-width:100%;break-inside:avoid}
      .md table{font-size:8.5pt;break-inside:avoid;width:100%}
      .md div{break-inside:avoid;border:none!important;box-shadow:none!important;background:#fff!important}
      @page{margin:16mm}
    </style></head><body><div class="page"><h1 class="ttl">${esc(title)}</h1><p class="auth">${esc(byline)}</p>${html}</div></body></html>`);
  w.document.close();
  setTimeout(() => w.print(), 900);
}
