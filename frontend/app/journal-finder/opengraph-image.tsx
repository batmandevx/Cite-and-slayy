import { ogCard } from "@/lib/ogImage";

export const alt = "Cite & Slayy · Journal finder: Find the right journal for your paper.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return ogCard({"kicker": "Journal finder", "title": "Find the right", "highlight": "journal for your paper.", "sub": "Matched venues ranked by fit, with scope, indexing and openness, so you submit once.", "color": "#ff9a3c", "chips": [["Ranked by fit", "#ffd23f"], ["Scope & indexing", "#c6f432"], ["Conferences too", "#ffffff"]]});
}
