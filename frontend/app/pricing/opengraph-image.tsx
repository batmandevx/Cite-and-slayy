import { ogCard } from "@/lib/ogImage";

export const alt = "Cite & Slayy · Pricing: Start free. Upgrade when ready.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return ogCard({"kicker": "Pricing", "title": "Start free.", "highlight": "Upgrade when ready.", "sub": "Pro and Max plans in INR for full papers, every check and LaTeX, Word and PDF export.", "color": "#ffd23f", "chips": [["Free plan", "#c6f432"], ["Pro ₹6,999", "#ff5fa2"], ["Max ₹12,999", "#7ee8c8"]]});
}
