import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pricing: Plans for Students & Researchers",
  description: "Cite & Slayy pricing in INR: start free, or go Pro or Max for full papers with verified citations, LaTeX/Word/PDF export, plagiarism checks and PPT decks.",
  alternates: { canonical: "/pricing" },
};

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
