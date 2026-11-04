import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Logo } from "../Logo";
import { faqJsonLd, JsonLd } from "./JsonLd";
import { FeatureLinks, SHORT_NAME } from "./SiteFooterLinks";
import { CookieSettingsLink } from "../CookieConsent";
import { breadcrumbJsonLd, pageMetadata } from "@/lib/seo";
import { BUSINESS } from "@/lib/business";
import { SEO_PAGES } from "@/lib/seoPages";
import { SITE_URL } from "@/lib/site";

const find = (slug: string) => SEO_PAGES.find((p) => p.slug === slug);

export function featureMetadata(slug: string): Metadata {
  const p = find(slug);
  if (!p) return {};
  return pageMetadata({ title: p.title, description: p.description, path: `/${p.slug}` });
}

const CARD = ["bg-yellow", "bg-lime", "bg-mint", "bg-pink", "bg-surface", "bg-orange"];

/** A public, server-rendered landing page for one tool (content in lib/seoPages.ts). */
export function FeaturePage({ slug }: { slug: string }) {
  const p = find(slug);
  if (!p) notFound();
  const breadcrumbs = breadcrumbJsonLd([[SHORT_NAME[p.slug] ?? p.h1, `/${p.slug}`]]);
  const related = SEO_PAGES.filter((r) => r.slug !== p.slug);
  const app = {
    "@context": "https://schema.org", "@type": "WebApplication", name: `Cite & Slayy ${SHORT_NAME[p.slug] ?? ""}`.trim(),
    url: `${SITE_URL}/${p.slug}`, description: p.description, applicationCategory: "EducationalApplication", operatingSystem: "Web",
    offers: { "@type": "Offer", price: "0", priceCurrency: "INR", description: "Free plan available" },
    publisher: { "@id": `${SITE_URL}/#org` },
  };
  return (
    <div className="min-h-screen">
      <JsonLd data={breadcrumbs} />
      <JsonLd data={faqJsonLd(p.faqs)} />
      <JsonLd data={app} />
      <header className="border-b-[2.5px] border-edge">
        <div className="mx-auto flex max-w-[1100px] items-center justify-between gap-4 px-5 py-4">
          <Link href="/" aria-label="Cite & Slayy home"><Logo /></Link>
          <nav className="flex items-center gap-4 text-sm font-bold">
            <Link href="/pricing" className="hidden sm:inline">Pricing</Link>
            <Link href="/app" className="btn-brut rounded-xl bg-lime px-4 py-2 text-[#121212]">Open the app</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-[1100px] px-5">
        <nav aria-label="Breadcrumb" className="pt-6 text-xs font-bold text-muted">
          <ol className="flex flex-wrap items-center gap-1.5">
            <li><Link href="/" className="hover:text-ink hover:underline">Home</Link></li><li aria-hidden>/</li>
            <li aria-current="page" className="text-ink-2">{SHORT_NAME[p.slug] ?? p.h1}</li>
          </ol>
        </nav>

        <section className="py-12 md:py-16">
          <span className="sticker bg-lime">{p.kicker}</span>
          <h1 className="mt-5 max-w-4xl font-display text-4xl font-extrabold leading-[1.02] tracking-tight md:text-6xl">{p.h1}</h1>
          <p className="mt-6 max-w-3xl text-lg leading-relaxed text-ink-2">{p.intro}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/app" className="btn-brut rounded-2xl bg-pink px-6 py-3 font-display text-lg font-extrabold text-[#121212]">{p.cta} →</Link>
            <Link href="/pricing" className="btn-brut rounded-2xl bg-surface px-6 py-3 font-display text-lg font-extrabold">See plans</Link>
          </div>
        </section>

        <section aria-labelledby="how" className="py-10">
          <h2 id="how" className="font-display text-3xl font-extrabold md:text-4xl">How it works</h2>
          <ol className="mt-6 grid gap-4 md:grid-cols-3">
            {p.steps.map((s, i) => (
              <li key={s.t} className="card p-5">
                <div className="grid size-9 place-items-center rounded-full border-2 border-edge bg-yellow font-display font-extrabold text-[#121212]">{i + 1}</div>
                <h3 className="mt-3 font-display text-xl font-extrabold">{s.t}</h3>
                <p className="mt-1 text-ink-2">{s.d}</p>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="features" className="py-10">
          <h2 id="features" className="font-display text-3xl font-extrabold md:text-4xl">What you get</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {p.features.map((f, i) => (
              <div key={f.t} className={`card p-5 ${CARD[i % CARD.length]} ${CARD[i % CARD.length] === "bg-surface" ? "" : "text-[#121212]"}`}>
                <h3 className="font-display text-lg font-extrabold">{f.t}</h3>
                <p className="mt-1 text-[15px] opacity-90">{f.d}</p>
              </div>
            ))}
          </div>
        </section>

        <section aria-labelledby="faq" className="py-10">
          <h2 id="faq" className="font-display text-3xl font-extrabold md:text-4xl">Frequently asked questions</h2>
          <div className="mt-6 space-y-3">
            {p.faqs.map((f) => (
              <details key={f.q} className="card group p-5" open>
                <summary className="cursor-pointer list-none font-display text-lg font-extrabold">{f.q}</summary>
                <p className="mt-2 text-ink-2">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section aria-labelledby="related" className="py-10">
          <h2 id="related" className="font-display text-3xl font-extrabold md:text-4xl">Related tools</h2>
          <p className="mt-2 text-ink-2">They share one workspace, so a paper you write can go straight into the next check.</p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {related.map((r, i) => (
              <Link key={r.slug} href={`/${r.slug}`} className={`card group block p-5 transition hover:-translate-y-1 text-[#121212] ${["bg-yellow", "bg-mint", "bg-lime", "bg-orange"][i % 4]}`}>
                <span className="text-xs font-extrabold uppercase tracking-wider opacity-70">{r.kicker}</span>
                <h3 className="mt-1 font-display text-lg font-extrabold leading-tight">{SHORT_NAME[r.slug] ?? r.h1}</h3>
                <p className="mt-2 line-clamp-3 text-sm opacity-85">{r.description}</p>
                <span className="mt-3 inline-block text-sm font-extrabold underline decoration-2 underline-offset-4 group-hover:decoration-pink">Learn more →</span>
              </Link>
            ))}
          </div>
        </section>

        <section className="py-12">
          <div className="card bg-pink px-6 py-12 text-center text-[#121212]">
            <h2 className="font-display text-3xl font-extrabold md:text-5xl">Ready to slay your next paper?</h2>
            <p className="mx-auto mt-3 max-w-xl">Start free. Upgrade when you need full papers, exports and every check.</p>
            <Link href="/app" className="btn-brut mt-6 inline-block rounded-2xl bg-yellow px-7 py-3 font-display text-lg font-extrabold">{p.cta} →</Link>
          </div>
        </section>
      </main>

      <footer className="border-t-[2.5px] border-edge">
        <div className="mx-auto grid max-w-[1100px] gap-6 px-5 py-10 text-sm text-ink-2 md:grid-cols-[1fr_auto]">
          <div>
            <Logo />
            <p className="mt-3 text-xs">Data: OpenAlex, arXiv, Semantic Scholar, Crossref (incl. Retraction Watch).</p>
          </div>
          <div className="space-y-3">
            <FeatureLinks exclude={p.slug} className="flex flex-wrap gap-x-4 gap-y-2 font-bold" />
            <nav className="flex flex-wrap gap-x-4 gap-y-2 text-xs">
              <Link href="/about">About</Link><Link href="/support">Help centre</Link><Link href="/pricing">Pricing</Link><Link href="/terms">Terms</Link><Link href="/privacy">Privacy</Link>
              <Link href="/refund">Refunds</Link><Link href="/contact">Contact</Link><a href={`mailto:${BUSINESS.email}`}>{BUSINESS.email}</a>
              <CookieSettingsLink />
            </nav>
          </div>
        </div>
      </footer>
    </div>
  );
}
