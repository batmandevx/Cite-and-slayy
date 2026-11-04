import { ogCard } from "@/lib/ogImage";

export const alt = "Cite & Slayy · Gap finder: Find the gap before you write.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return ogCard({"kicker": "Gap finder", "title": "Find the gap", "highlight": "before you write.", "sub": "Map a field's clusters, see what's rising or underexplored, and get research questions to pursue.", "color": "#7ee8c8", "chips": [["Topic clusters", "#ffd23f"], ["Trend lines", "#c6f432"], ["Research questions", "#ffffff"]]});
}
