import Link from "next/link";
import type { ReactNode } from "react";
import { BUSINESS, isPlaceholder } from "@/lib/business";
import { FeatureLinks } from "./seo/SiteFooterLinks";

export function Biz({ k }: { k: keyof typeof BUSINESS }) {
  const v = BUSINESS[k];
  return isPlaceholder(v) ? <mark className="rounded bg-yellow px-1 text-[#121212]">{v}</mark> : <>{v}</>;
}

export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl px-5 py-12">
      <Link href="/" className="font-display text-sm font-extrabold text-ink-2 hover:text-ink">← Cite &amp; Slayy</Link>
      <h1 className="mt-4 font-display text-4xl font-extrabold">{title}</h1>
      <p className="mt-1 text-sm text-muted">Last updated {BUSINESS.updated}</p>
      <div className="md mt-8 space-y-4 text-[15px] leading-relaxed [&_h2]:mt-8 [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-extrabold [&_li]:ml-5 [&_li]:list-disc">
        {children}
      </div>
      <footer className="mt-12 flex flex-wrap gap-4 border-t-2 border-dashed border-line pt-5 text-sm text-ink-2">
        <Link href="/about">About &amp; support</Link><Link href="/pricing">Pricing</Link><Link href="/terms">Terms</Link><Link href="/privacy">Privacy</Link>
        <Link href="/refund">Cancellation &amp; refunds</Link><Link href="/contact">Contact</Link>
        <FeatureLinks className="flex w-full flex-wrap gap-x-4 gap-y-2 text-xs font-bold" />
      </footer>
    </main>
  );
}
