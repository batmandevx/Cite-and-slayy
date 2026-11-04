import { ogCard } from "@/lib/ogImage";

export const alt = "Cite & Slayy · Legal: Terms of Service";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return ogCard({"kicker": "Legal", "title": "Terms of Service", "sub": "Accounts, plans, fair use, AI content and your responsibilities.", "color": "#7ee8c8", "chips": []});
}
