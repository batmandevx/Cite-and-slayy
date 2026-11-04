import { ogCard } from "@/lib/ogImage";

export const alt = "Cite & Slayy · Originality check: Plagiarism & AI check, line by line.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return ogCard({"kicker": "Originality check", "title": "Plagiarism & AI check,", "highlight": "line by line.", "sub": "See which sentences overlap published work and fix them with proper quotes and citations.", "color": "#ff5fa2", "chips": [["Source matches", "#ffd23f"], ["AI-writing signals", "#7ee8c8"], ["Cite the source", "#ffffff"]]});
}
