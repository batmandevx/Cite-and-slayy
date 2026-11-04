import { ogCard } from "@/lib/ogImage";

export const alt = "Cite & Slayy · Contact: Get in touch.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return ogCard({"kicker": "Contact", "title": "Get in", "highlight": "touch.", "sub": "Questions, feedback or partnerships. We reply within 2 business days.", "color": "#ff5fa2", "chips": [["Support", "#c6f432"], ["Partnerships", "#ffd23f"], ["Press", "#ffffff"]]});
}
