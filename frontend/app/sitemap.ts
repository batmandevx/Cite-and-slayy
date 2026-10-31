import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const pages: [string, number, MetadataRoute.Sitemap[number]["changeFrequency"]][] = [
    ["", 1, "weekly"], ["/pricing", 0.9, "weekly"], ["/contact", 0.5, "monthly"],
    ["/terms", 0.3, "yearly"], ["/privacy", 0.3, "yearly"], ["/refund", 0.3, "yearly"],
  ];
  return pages.map(([path, priority, changeFrequency]) => ({ url: `${SITE_URL}${path}`, changeFrequency, priority }));
}
