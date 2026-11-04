import { ogCard } from "@/lib/ogImage";

export const alt = "Cite & Slayy · Billing: Cancellation & Refunds";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return ogCard({"kicker": "Billing", "title": "Cancellation & Refunds", "sub": "How to cancel, when refunds apply, Paper Packs, UPI payments and timelines.", "color": "#ff5fa2", "chips": []});
}
