import { ogCard } from "@/lib/ogImage";

export const alt = "Cite & Slayy · Help centre: How can we help?";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return ogCard({"kicker": "Help centre", "title": "How can we", "highlight": "help?", "sub": "Answers on payments, refunds, papers, citations and privacy, or write to our team.", "color": "#c6f432", "chips": [["Payments", "#ffd23f"], ["Papers", "#7ee8c8"], ["Privacy", "#ffffff"]]});
}
