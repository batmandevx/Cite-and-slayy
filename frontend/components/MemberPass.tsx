"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

const Lanyard = dynamic(() => import("./reactbits/Lanyard"), { ssr: false, loading: () => <div className="shimmer size-full rounded-2xl" /> });

type Tier = "free" | "pro" | "max" | "founder" | "guest";

const LOOK: Record<Tier, { bg: [string, string]; ink: string; accent: string; label: string; finish: "matte" | "glossy" | "holographic" | "metallic"; metal: "silver" | "gold" | "graphite"; strap: string }> = {
  guest: { bg: ["#fff7e8", "#ffe1ec"], ink: "#121212", accent: "#e8457f", label: "RESEARCHER", finish: "glossy", metal: "silver", strap: "#e8457f" },
  free: { bg: ["#f6f4ee", "#e9e6dc"], ink: "#121212", accent: "#8a8a8a", label: "FREE", finish: "matte", metal: "graphite", strap: "#2b2b2b" },
  pro: { bg: ["#ff5fa2", "#7b5cff"], ink: "#ffffff", accent: "#ffe14d", label: "PRO", finish: "holographic", metal: "silver", strap: "#e8457f" },
  max: { bg: ["#151226", "#3a2a6b"], ink: "#ffffff", accent: "#f2c14e", label: "MAX", finish: "holographic", metal: "gold", strap: "#151226" },
  founder: { bg: ["#0f0f12", "#2a2116"], ink: "#ffffff", accent: "#f2c14e", label: "FOUNDER", finish: "metallic", metal: "gold", strap: "#121212" },
};

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function fitText(ctx: CanvasRenderingContext2D, text: string, max: number, size: number, weight = 800) {
  let s = size;
  do { ctx.font = `${weight} ${s}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`; s -= 4; } while (ctx.measureText(text).width > max && s > 24);
}

function hashId(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0).toString(36).toUpperCase().padStart(7, "0").slice(0, 7);
}

function drawFront(tier: Tier, name: string, since: string, id: string): string {
  const L = LOOK[tier], W = 1024, H = 1440;
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, L.bg[0]); g.addColorStop(1, L.bg[1]);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // soft blobs
  for (const [x, y, r, a] of [[880, 260, 300, 0.18], [120, 1180, 360, 0.14]] as const) {
    const rg = ctx.createRadialGradient(x, y, 0, x, y, r); rg.addColorStop(0, `${L.accent}${Math.round(a * 255).toString(16).padStart(2, "0")}`); rg.addColorStop(1, `${L.accent}00`);
    ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
  }
  ctx.fillStyle = L.ink;
  // header (the strap slot sits near the top, so content starts lower)
  ctx.font = `800 54px ui-sans-serif, system-ui, sans-serif`; ctx.fillText("Cite & Slayy", 80, 300);
  ctx.globalAlpha = 0.7; ctx.font = `600 30px ui-sans-serif, system-ui, sans-serif`; ctx.fillText("cite it right · slay the review", 80, 350); ctx.globalAlpha = 1;
  // tier badge
  ctx.font = `900 40px ui-sans-serif, system-ui, sans-serif`;
  const bw = ctx.measureText(L.label).width + 64;
  roundRect(ctx, W - 80 - bw, 248, bw, 76, 38); ctx.fillStyle = L.accent; ctx.fill();
  ctx.fillStyle = tier === "free" ? "#ffffff" : "#121212"; ctx.fillText(L.label, W - 80 - bw + 32, 300);
  // name
  ctx.fillStyle = L.ink; ctx.globalAlpha = 0.65; ctx.font = `700 30px ui-sans-serif, system-ui, sans-serif`; ctx.fillText("RESEARCH PASS", 80, 720); ctx.globalAlpha = 1;
  fitText(ctx, name, W - 160, 112, 900); ctx.fillText(name, 80, 840);
  // details
  ctx.font = `600 32px ui-sans-serif, system-ui, sans-serif`; ctx.globalAlpha = 0.8;
  ctx.fillText(`Member since ${since}`, 80, 920); ctx.fillText(`ID  CS-${id}`, 80, 970); ctx.globalAlpha = 1;
  // barcode
  let x = 80; const seed = id + name;
  for (let i = 0; x < W - 80; i++) { const w = 4 + ((seed.charCodeAt(i % seed.length) * (i + 3)) % 9); if (i % 2 === 0) { ctx.fillRect(x, 1180, w, 120); } x += w + 3; }
  ctx.font = `700 30px ui-monospace, Menlo, monospace`; ctx.fillText("citeslayy.com", 80, 1360);
  return c.toDataURL("image/png");
}

function drawBack(tier: Tier): string {
  const L = LOOK[tier], W = 1024, H = 1440;
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = tier === "free" || tier === "guest" ? "#121212" : L.bg[1]; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#ffffff";
  const lines = tier === "free"
    ? ["Upgrade to Pro", "for the holographic pass", "", "✦ Full papers + downloads", "✦ Slides in 6 themes", "✦ AI & plagiarism reports", "✦ Image upload in Azora AI"]
    : tier === "guest"
      ? ["Your pass is waiting", "", "✦ Sign up free", "✦ Write your first paper", "✦ Go Pro for holographic"]
      : ["All access", "", "✦ Paper Studio", "✦ Downloads & Overleaf", "✦ Slides & submission kits", "✦ AI & plagiarism reports", "✦ Reviewer verdicts"];
  let y = 380;
  lines.forEach((t, i) => {
    ctx.font = i < 2 ? `900 ${i === 0 ? 78 : 44}px ui-sans-serif, system-ui, sans-serif` : `700 44px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillStyle = i === 0 ? L.accent === "#8a8a8a" ? "#ffe14d" : L.accent : "#ffffff";
    ctx.fillText(t, 80, y); y += i === 0 ? 90 : 76;
  });
  ctx.globalAlpha = 0.5; ctx.font = `600 30px ui-sans-serif, system-ui, sans-serif`; ctx.fillText("tap to flip · drag to swing", 80, 1340);
  return c.toDataURL("image/png");
}

function drawStrap(color: string): string {
  const c = document.createElement("canvas"); c.width = 1200; c.height = 120;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = color; ctx.fillRect(0, 0, 1200, 120);
  ctx.fillStyle = "#ffffff"; ctx.font = `900 54px ui-sans-serif, system-ui, sans-serif`;
  ctx.fillText("CITE & SLAYY  ✦  CITE & SLAYY  ✦", 30, 80);
  return c.toDataURL("image/png");
}

/** A 3D hanging Cite & Slayy pass (React Bits Lanyard) personalised for the user and their plan. */
export function MemberPass({ tier, name, since, seed, height = 460, anchor = "center", className }: {
  tier: Tier; name: string; since?: string; seed?: string; height?: number; anchor?: "left" | "center" | "right"; className?: string;
}) {
  const [imgs, setImgs] = useState<{ front: string; back: string; strap: string } | null>(null);
  useEffect(() => {
    const id = hashId(seed || name);
    const s = since || new Date().toLocaleDateString(undefined, { month: "short", year: "numeric" });
    const t = setTimeout(() => setImgs({ front: drawFront(tier, name, s, id), back: drawBack(tier), strap: drawStrap(LOOK[tier].strap) }), 0);
    return () => clearTimeout(t);
  }, [tier, name, since, seed]);
  const L = LOOK[tier];
  return (
    <div className={className} style={{ height }}>
      {imgs && <Lanyard frontImage={imgs.front} backImage={imgs.back} strapImage={imgs.strap} finish={L.finish} metal={L.metal}
        size={0.62} strapLength={0.42} anchor={anchor} breeze={0.35} cornerRadius={0.35} />}
    </div>
  );
}
