import { ogCard } from "@/lib/ogImage";

export const alt = "Cite & Slayy · About us: Research you can trust, made simple.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return ogCard({"kicker": "About us", "title": "Research you can", "highlight": "trust, made simple.", "sub": "Real, verified citations for every student and researcher.", "color": "#ffd23f", "chips": [["Verified citations", "#c6f432"], ["Made in India", "#7ee8c8"]]});
}
