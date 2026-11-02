import { ChevronDown, Mail } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { BUSINESS } from "@/lib/business";
import { Logo } from "../Logo";
import { FeatureLinks } from "../seo/SiteFooterLinks";
import { HeroArt } from "./HeroArt";
import { Reveal } from "./Reveal";
import { Toc } from "./Toc";

export interface Glance { icon: ReactNode; title: string; text: string; color: string }

const POLICIES = [
  { href: "/about", label: "About us" }, { href: "/support", label: "Help centre" }, { href: "/terms", label: "Terms of Service" }, { href: "/privacy", label: "Privacy Policy" },
  { href: "/refund", label: "Cancellation & Refunds" }, { href: "/contact", label: "Contact" },
];

/** Shared layout for the support and policy pages: hero, at-a-glance cards, sticky contents, numbered sections. */
export function PolicyShell({ eyebrow, title, intro, icon, heroColor = "bg-surface", glance, toc, current, children }: {
  eyebrow: string; title: string; intro: ReactNode; icon: ReactNode; heroColor?: string; glance?: Glance[];
  toc?: { id: string; title: string }[]; current: string; children: ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <header className="border-b-[2.5px] border-edge bg-surface/80 backdrop-blur">
        <div className="mx-auto flex max-w-[1180px] items-center justify-between gap-4 px-5 py-3.5">
          <Link href="/" aria-label="Cite & Slayy home"><Logo /></Link>
          <nav className="flex items-center gap-4 text-sm font-bold">
            <Link href="/pricing" className="hidden hover:underline sm:inline">Pricing</Link>
            <Link href="/about" className="hidden hover:underline sm:inline">About</Link>
            <Link href="/support" className="hidden hover:underline sm:inline">Support</Link>
            <Link href="/app" className="btn-brut rounded-xl bg-lime px-4 py-2 text-[#121212]">Open the app</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-[1180px] px-5 pb-16">
        {/* hero */}
        <Reveal>
          <section className={`card relative mt-8 overflow-hidden px-6 py-10 md:px-10 md:py-14 ${heroColor} ${heroColor === "bg-surface" ? "" : "text-[#121212]"}`}>
            <HeroArt icon={icon} />
            <div className="relative max-w-2xl">
              <span className="sticker bg-surface text-[#121212]">{eyebrow}</span>
              <h1 className="mt-4 font-display text-4xl font-extrabold leading-[1.02] tracking-tight md:text-6xl">{title}</h1>
              <div className={`mt-4 text-[17px] leading-relaxed ${heroColor === "bg-surface" ? "text-ink-2" : "opacity-85"}`}>{intro}</div>
              <p className={`mt-4 text-xs font-bold uppercase tracking-wider ${heroColor === "bg-surface" ? "text-muted" : "opacity-70"}`}>Last updated {BUSINESS.updated}</p>
            </div>
          </section>
        </Reveal>

        {/* at a glance */}
        {glance && (
          <section aria-label="At a glance" className="mt-8">
            <h2 className="mb-3 font-display text-xl font-extrabold">At a glance</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {glance.map((g, i) => (
                <Reveal key={g.title} delay={i * 0.06}>
                  <div className={`card h-full p-5 transition hover:-translate-y-1 ${g.color} ${g.color === "bg-surface" ? "" : "text-[#121212]"}`}>
                    <div className="grid size-10 place-items-center rounded-xl border-2 border-edge bg-surface text-[#121212]">{g.icon}</div>
                    <h3 className="mt-3 font-display text-lg font-extrabold leading-tight">{g.title}</h3>
                    <p className="mt-1 text-sm opacity-90">{g.text}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </section>
        )}

        {/* body */}
        <div className={`mt-10 grid gap-8 ${toc ? "lg:grid-cols-[250px_1fr]" : ""}`}>
          {toc && <aside className="hidden lg:block"><Toc items={toc} /></aside>}
          <div className="min-w-0 space-y-5">{children}</div>
        </div>

        {/* still need help */}
        <Reveal>
          <section className="card mt-12 flex flex-col items-start gap-4 bg-pink px-6 py-8 text-[#121212] md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="font-display text-2xl font-extrabold md:text-3xl">Still have a question?</h2>
              <p className="mt-1 max-w-xl">Write to us and a real person will reply within 2 business days.</p>
            </div>
            <a href={`mailto:${BUSINESS.email}`} className="btn-brut inline-flex items-center gap-2 rounded-2xl bg-yellow px-6 py-3 font-display text-lg font-extrabold">
              <Mail className="size-5" /> {BUSINESS.email}
            </a>
          </section>
        </Reveal>
      </main>

      <footer className="border-t-[2.5px] border-edge">
        <div className="mx-auto grid max-w-[1180px] gap-6 px-5 py-10 text-sm text-ink-2 md:grid-cols-[1fr_auto]">
          <div>
            <Logo />
            <p className="mt-3 max-w-sm text-xs">AI research workspace with real, verified citations. Made in {BUSINESS.country}.</p>
          </div>
          <div className="space-y-3">
            <nav aria-label="Policies" className="flex flex-wrap gap-x-4 gap-y-2 font-bold">
              {POLICIES.map((p) => (
                <Link key={p.href} href={p.href} className={p.href === current ? "text-ink underline decoration-pink decoration-[3px] underline-offset-4" : "hover:underline"}>{p.label}</Link>
              ))}
              <Link href="/pricing" className="hover:underline">Pricing</Link>
            </nav>
            <FeatureLinks className="flex flex-wrap gap-x-4 gap-y-2 text-xs" />
          </div>
        </div>
      </footer>
    </div>
  );
}

/** A numbered policy section card. */
export function Section({ id, n, title, icon, children }: { id: string; n: number; title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <Reveal>
      <section id={id} className="card scroll-mt-6 p-6 md:p-7">
        <div className="flex items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full border-2 border-edge bg-yellow font-display font-extrabold text-[#121212]">{n}</span>
          <h2 className="font-display text-xl font-extrabold md:text-2xl">{title}</h2>
          {icon && <span className="ml-auto hidden text-muted sm:block">{icon}</span>}
        </div>
        <div className="prose-policy mt-4 space-y-3 text-[15px] leading-relaxed text-ink-2">{children}</div>
      </section>
    </Reveal>
  );
}

/** Expandable question and answer. */
export function Faq({ q, children, open }: { q: string; children: ReactNode; open?: boolean }) {
  return (
    <details className="group rounded-2xl border-2 border-edge bg-surface p-4 transition open:shadow-[3px_3px_0_var(--shadow-c)]" open={open}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-display font-extrabold text-ink">
        {q}<ChevronDown className="size-5 shrink-0 transition group-open:rotate-180" />
      </summary>
      <div className="mt-2 text-[15px] leading-relaxed text-ink-2">{children}</div>
    </details>
  );
}

/** Small highlighted callout inside a section. */
export function Callout({ tone = "lime", children }: { tone?: "lime" | "yellow" | "pink" | "mint"; children: ReactNode }) {
  const bg = { lime: "bg-lime", yellow: "bg-yellow", pink: "bg-pink", mint: "bg-mint" }[tone];
  return <div className={`rounded-2xl border-2 border-edge ${bg} px-4 py-3 text-[15px] font-semibold text-[#121212]`}>{children}</div>;
}
