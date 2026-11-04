import { ArrowRight, Home, SearchX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { FeatureLinks } from "@/components/seo/SiteFooterLinks";

export const metadata: Metadata = {
  title: "Page not found",
  description: "This page doesn't exist. Head back to Cite & Slayy, or jump straight to one of our research tools.",
  robots: { index: false, follow: true },
};

/** 404: styled as the kind of fake reference Cite & Slayy catches. */
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b-[2.5px] border-edge">
        <div className="mx-auto flex max-w-[1100px] items-center justify-between gap-4 px-5 py-4">
          <Link href="/" aria-label="Cite & Slayy home"><Logo /></Link>
          <Link href="/app" className="btn-brut rounded-xl bg-lime px-4 py-2 text-sm font-bold text-[#121212]">Open the app</Link>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-[1100px] flex-1 items-center gap-10 px-5 py-14 md:grid-cols-[1.1fr_1fr]">
        <section>
          <span className="sticker -rotate-2 bg-pink text-[#121212]">Error 404</span>
          <h1 className="mt-5 font-display text-5xl font-extrabold leading-[0.98] tracking-tight md:text-7xl">
            Reference <span className="inline-block -rotate-1 rounded-2xl border-[3px] border-edge bg-yellow px-3 text-[#121212] shadow-[6px_6px_0_var(--shadow-c)]">not found.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink-2">
            We checked every database we know. This page doesn&apos;t exist, was moved, or the link has a typo.
            Unlike a hallucinated citation, at least we&apos;re telling you.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/" className="btn-brut inline-flex items-center gap-2 rounded-2xl bg-pink px-6 py-3 font-display text-lg font-extrabold text-[#121212]"><Home className="size-5" />Back home</Link>
            <Link href="/app" className="btn-brut inline-flex items-center gap-2 rounded-2xl bg-surface px-6 py-3 font-display text-lg font-extrabold">Open the app <ArrowRight className="size-5" /></Link>
          </div>
        </section>

        {/* the "audit result" card */}
        <section aria-label="Citation check result" className="card rotate-1 bg-surface p-5 font-mono text-sm">
          <div className="flex items-center gap-2 border-b-2 border-edge pb-3 font-sans font-extrabold">
            <SearchX className="size-5 text-crit-ink" /> Citation check
            <span className="ml-auto rounded-full border-2 border-edge bg-crit px-2.5 py-0.5 text-xs text-white">FABRICATED</span>
          </div>
          <p className="mt-4 leading-relaxed text-ink-2">[404] Page, A. N. (2026). <i>The URL you were looking for</i>. Journal of Missing Pages, 0(0), 404&ndash;404.</p>
          <ul className="mt-4 space-y-1.5 text-xs">
            <li className="flex justify-between gap-3"><span>DOI resolves</span><b className="text-crit-ink">no</b></li>
            <li className="flex justify-between gap-3"><span>Found in OpenAlex / Crossref</span><b className="text-crit-ink">no</b></li>
            <li className="flex justify-between gap-3"><span>Found on citeslayy.com</span><b className="text-crit-ink">no</b></li>
            <li className="flex justify-between gap-3"><span>Suggested replacement</span><b className="text-good-ink">see below</b></li>
          </ul>
        </section>

        <section className="md:col-span-2">
          <h2 className="font-display text-xl font-extrabold">Pages that do exist</h2>
          <FeatureLinks className="mt-3 flex flex-wrap gap-2 text-sm font-bold [&>a]:rounded-xl [&>a]:border-2 [&>a]:border-edge [&>a]:bg-surface [&>a]:px-3 [&>a]:py-1.5" />
          <nav aria-label="More pages" className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm text-ink-2">
            <Link href="/pricing" className="hover:underline">Pricing</Link><Link href="/about" className="hover:underline">About</Link>
            <Link href="/support" className="hover:underline">Help centre</Link><Link href="/contact" className="hover:underline">Contact</Link>
          </nav>
        </section>
      </main>
    </div>
  );
}
