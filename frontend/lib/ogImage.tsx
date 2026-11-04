import { ImageResponse } from "next/og";

// One renderer for every page's share card (1200×630), in the Slay Pop look: cream paper, ink outlines, hard shadows.
export const OG_SIZE = { width: 1200, height: 630 };

const INK = "#121212";

export function ogCard({ kicker, title, highlight, sub, color = "#c6f432", chips = [] }: {
  kicker: string; title: string; highlight?: string; sub: string; color?: string; chips?: [string, string][];
}) {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between",
        background: "#fff5e6", padding: "60px 72px", color: INK, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ display: "flex", width: 68, height: 68, borderRadius: 20, background: "#ff5fa2", border: `4px solid ${INK}`,
            alignItems: "center", justifyContent: "center", fontSize: 42, fontWeight: 900 }}>C</div>
          <div style={{ fontSize: 42, fontWeight: 900 }}>Cite &amp; Slayy</div>
          <div style={{ display: "flex", marginLeft: "auto", padding: "8px 18px", border: `4px solid ${INK}`, borderRadius: 999,
            background: color, fontSize: 26, fontWeight: 800 }}>{kicker}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: title.length > 34 ? 66 : 80, fontWeight: 900, lineHeight: 1.02, letterSpacing: -2, maxWidth: 1060 }}>{title}</div>
          {highlight && (
            <div style={{ display: "flex", marginTop: 16 }}>
              <div style={{ display: "flex", fontSize: 60, fontWeight: 900, lineHeight: 1.05, letterSpacing: -1.5, background: color,
                border: `5px solid ${INK}`, borderRadius: 22, padding: "4px 22px", boxShadow: `9px 9px 0 ${INK}` }}>{highlight}</div>
            </div>
          )}
          <div style={{ display: "flex", fontSize: 30, marginTop: 30, maxWidth: 1040, lineHeight: 1.3, opacity: 0.85 }}>{sub}</div>
        </div>
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          {chips.map(([t, bg]) => (
            <div key={t} style={{ display: "flex", padding: "10px 20px", border: `4px solid ${INK}`, borderRadius: 16, background: bg,
              fontSize: 26, fontWeight: 800, boxShadow: `5px 5px 0 ${INK}` }}>{t}</div>
          ))}
          <div style={{ display: "flex", marginLeft: "auto", fontSize: 26, fontWeight: 700, opacity: 0.65 }}>citeslayy.com</div>
        </div>
      </div>
    ),
    OG_SIZE,
  );
}
