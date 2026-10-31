import Link from "next/link";
import { SEO_PAGES } from "@/lib/seoPages";

const SHORT: Record<string, string> = {
  "ai-research-paper-writer": "AI paper writer", "citation-checker": "Citation checker", "research-gap-finder": "Research gap finder",
  "plagiarism-checker": "Plagiarism & AI check", "journal-finder": "Journal finder",
};

/** Links to the feature pages, so every public page reaches them (and search engines can follow them). */
export function FeatureLinks({ className, exclude }: { className?: string; exclude?: string }) {
  return (
    <nav aria-label="Tools" className={className}>
      {SEO_PAGES.filter((p) => p.slug !== exclude).map((p) => (
        <Link key={p.slug} href={`/${p.slug}`} className="hover:underline">{SHORT[p.slug] ?? p.h1}</Link>
      ))}
    </nav>
  );
}
