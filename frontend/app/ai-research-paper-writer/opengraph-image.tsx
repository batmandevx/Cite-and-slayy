import { ogCard } from "@/lib/ogImage";

export const alt = "Cite & Slayy · AI paper writer: Topic in. Paper out.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return ogCard({"kicker": "AI paper writer", "title": "Topic in.", "highlight": "Paper out.", "sub": "Full research papers that cite only real, verified sources, formatted for IEEE or Springer.", "color": "#c6f432", "chips": [["Real citations", "#ffd23f"], ["Figures & equations", "#7ee8c8"], ["LaTeX · Word · PDF", "#ffffff"]]});
}
