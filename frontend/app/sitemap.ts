import type { MetadataRoute } from "next";
import { SEO_PAGES } from "@/lib/seoPages";
import { SITE_URL } from "@/lib/site";

// Bump when page content changes meaningfully.
const UPDATED = new Date("2026-11-01");

export default function sitemap(): MetadataRoute.Sitemap {
  const pages: [string, number, MetadataRoute.Sitemap[number]["changeFrequency"]][] = [
    ["", 1, "weekly"], ["/pricing", 0.9, "weekly"],
    ...SEO_PAGES.map((p) => [`/${p.slug}`, 0.8, "monthly"] as [string, number, "monthly"]),
    ["/contact", 0.5, "monthly"], ["/terms", 0.3, "yearly"], ["/privacy", 0.3, "yearly"], ["/refund", 0.3, "yearly"],
  ];
  return pages.map(([path, priority, changeFrequency]) => ({ url: `${SITE_URL}${path}`, lastModified: UPDATED, changeFrequency, priority }));
}
