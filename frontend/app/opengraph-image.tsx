import { ImageResponse } from "next/og";

export const alt = "Cite & Slayy: topic in, publish-ready research paper out, with real verified citations";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const chip = (text: string, bg: string) => (
  <div style={{ display: "flex", padding: "12px 22px", border: "4px solid #121212", borderRadius: 18, background: bg,
    fontSize: 30, fontWeight: 800, boxShadow: "6px 6px 0 #121212" }}>{text}</div>
);

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between",
        background: "#fff5e6", padding: "64px 72px", color: "#121212", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ display: "flex", width: 72, height: 72, borderRadius: 20, background: "#ff5fa2", border: "4px solid #121212",
            alignItems: "center", justifyContent: "center", fontSize: 44, fontWeight: 900 }}>C</div>
          <div style={{ fontSize: 46, fontWeight: 900 }}>Cite &amp; Slayy</div>
          <div style={{ display: "flex", marginLeft: "auto", fontSize: 28, fontWeight: 700, opacity: 0.7 }}>citeslayy.com</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 86, fontWeight: 900, lineHeight: 1, letterSpacing: -2 }}>Topic in.</div>
          <div style={{ display: "flex", marginTop: 14 }}>
            <div style={{ display: "flex", fontSize: 86, fontWeight: 900, lineHeight: 1.05, letterSpacing: -2, background: "#c6f432",
              border: "5px solid #121212", borderRadius: 24, padding: "4px 24px", boxShadow: "10px 10px 0 #121212" }}>Paper out.</div>
          </div>
          <div style={{ fontSize: 34, marginTop: 34, maxWidth: 1000, lineHeight: 1.3 }}>
            Research papers with real, verified citations, figures and IEEE / Springer LaTeX.
          </div>
        </div>
        <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
          {chip("Verified citations", "#ffd23f")}
          {chip("Gap finder", "#7ee8c8")}
          {chip("Plagiarism check", "#ff5fa2")}
          {chip("Journal match", "#ffffff")}
        </div>
      </div>
    ),
    size,
  );
}
