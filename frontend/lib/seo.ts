import type { Metadata } from "next";
import { SITE_NAME, SITE_URL } from "./site";

/**
 * Title, description, canonical URL and Open Graph / Twitter tags for one public page.
 * Without this a page inherits the homepage's og:url and og:title, so shared links would show the homepage card.
 * The share image comes from the page's own opengraph-image.tsx.
 */
export function pageMetadata({ title, description, path }: { title: string; description: string; path: string }): Metadata {
  const url = `${SITE_URL}${path === "/" ? "" : path}`;
  const full = `${title} · ${SITE_NAME}`;
  return {
    title, description,
    alternates: { canonical: path },
    openGraph: { type: "website", url, siteName: SITE_NAME, locale: "en_IN", title: full, description },
    twitter: { card: "summary_large_image", title: full, description },
  };
}

/** schema.org BreadcrumbList: Home › …crumbs (each crumb a [name, path] pair). */
export function breadcrumbJsonLd(crumbs: [string, string][]) {
  const all: [string, string][] = [["Home", "/"], ...crumbs];
  return {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: all.map(([name, path], i) => ({
      "@type": "ListItem", position: i + 1, name, item: `${SITE_URL}${path === "/" ? "" : path}`,
    })),
  };
}
