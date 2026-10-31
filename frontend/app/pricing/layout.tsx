import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pricing: Plans for Students & Researchers",
  description: "Cite & Slayy plans in INR: start free, then go Pro or Max for full research papers with verified citations, " +
    "LaTeX/Word/PDF export, plagiarism and AI checks, PPT decks and journal matching. Paper Packs available.",
  alternates: { canonical: "/pricing" },
};

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
