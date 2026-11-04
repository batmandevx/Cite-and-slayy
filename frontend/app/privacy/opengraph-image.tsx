import { ogCard } from "@/lib/ogImage";

export const alt = "Cite & Slayy · Legal: Privacy Policy";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return ogCard({"kicker": "Legal", "title": "Privacy Policy", "sub": "How we collect, use and protect your data, uploads and papers. We never sell your data.", "color": "#c6f432", "chips": []});
}
