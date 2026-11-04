import type { Metadata } from "next";
import { JsonLd } from "@/components/seo/JsonLd";
import { breadcrumbJsonLd, pageMetadata } from "@/lib/seo";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = pageMetadata({
  title: "Pricing: Plans for Students & Researchers",
  description: "Cite & Slayy pricing in INR: start free, or go Pro or Max for full papers with verified citations, LaTeX/Word/PDF export, plagiarism checks and PPT decks.",
  path: "/pricing",
});

// Plans as schema.org offers (prices in INR, GST-inclusive; keep in step with backend/accounts/plans.py).
const offers = {
  "@context": "https://schema.org", "@type": "Product", name: "Cite & Slayy", url: `${SITE_URL}/pricing`,
  description: "AI research workspace: research papers with verified citations, citation checks, gap finder and journal matching.",
  brand: { "@type": "Brand", name: "Cite & Slayy" },
  offers: [
    { "@type": "Offer", name: "Free", price: "0", priceCurrency: "INR", url: `${SITE_URL}/pricing`, availability: "https://schema.org/InStock" },
    { "@type": "Offer", name: "Pro (monthly)", price: "6999", priceCurrency: "INR", url: `${SITE_URL}/pricing`, availability: "https://schema.org/InStock" },
    { "@type": "Offer", name: "Max (monthly)", price: "12999", priceCurrency: "INR", url: `${SITE_URL}/pricing`, availability: "https://schema.org/InStock" },
    { "@type": "Offer", name: "Paper Pack (60 days)", price: "9999", priceCurrency: "INR", url: `${SITE_URL}/pricing`, availability: "https://schema.org/InStock" },
  ],
};

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <JsonLd data={breadcrumbJsonLd([["Pricing", "/pricing"]])} />
      <JsonLd data={offers} />
      {children}
    </>
  );
}
