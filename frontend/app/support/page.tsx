import { ArrowRight, BookOpen, CreditCard, LifeBuoy, MessageSquareText, RotateCcw, ShieldCheck, Sparkles, UsersRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ContactComposer, HelpCenter } from "@/components/legal/HelpCenter";
import { PolicyShell, Section } from "@/components/legal/PolicyShell";
import { Reveal } from "@/components/legal/Reveal";
import { faqJsonLd, JsonLd } from "@/components/seo/JsonLd";
import { BUSINESS } from "@/lib/business";
import { FAQS } from "@/lib/supportFaq";

export const metadata: Metadata = {
  title: "Help centre & support",
  description: "Get help with Cite & Slayy: search answers about payments, refunds, papers, citations and privacy, or write to our support team.",
  alternates: { canonical: "/support" },
};

const QUICK = [
  { href: "#help", icon: <BookOpen className="size-6" />, t: "Search answers", d: `${FAQS.length} common questions`, color: "bg-lime" },
  { href: "#write", icon: <MessageSquareText className="size-6" />, t: "Write to us", d: "Reply in 2 business days", color: "bg-pink" },
  { href: "/refund", icon: <RotateCcw className="size-6" />, t: "Cancel or refund", d: "How it works, step by step", color: "bg-yellow" },
  { href: "/pricing", icon: <CreditCard className="size-6" />, t: "Plans & pricing", d: "Free, Pro, Max & Paper Pack", color: "bg-mint" },
];

export default function Support() {
  const [ceo] = BUSINESS.team;
  return (
    <PolicyShell current="/support" eyebrow="Help centre" title="How can we help?" heroColor="bg-lime" icon={<LifeBuoy className="size-12" />}
      intro={<>Search answers, fix billing questions in minutes, or write to the team that builds {BUSINESS.brand}. A real person replies to every message.</>}>
      <JsonLd data={faqJsonLd(FAQS)} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {QUICK.map((c, i) => (
          <Reveal key={c.t} delay={i * 0.06}>
            <Link href={c.href} className={`card group flex h-full flex-col p-5 text-[#121212] transition hover:-translate-y-1 ${c.color}`}>
              <div className="grid size-12 place-items-center rounded-2xl border-2 border-edge bg-surface">{c.icon}</div>
              <div className="mt-3 font-display text-lg font-extrabold">{c.t}</div>
              <div className="text-sm opacity-80">{c.d}</div>
              <ArrowRight className="mt-auto size-5 self-end pt-1 transition group-hover:translate-x-1" />
            </Link>
          </Reveal>
        ))}
      </div>

      <Section id="help" n={1} title="Search the help centre" icon={<Sparkles className="size-5" />}>
        <HelpCenter />
      </Section>

      <Section id="write" n={2} title="Write to us" icon={<MessageSquareText className="size-5" />}>
        <ContactComposer />
      </Section>

      <Section id="who" n={3} title="Talk to the right person" icon={<UsersRound className="size-5" />}>
        <div className="grid gap-3 md:grid-cols-3">
          {[
            { t: "Support team", d: "Account, payments, refunds, papers, bugs and security", e: BUSINESS.email, c: "bg-lime" },
            { t: `${ceo.name} · ${ceo.role}`, d: "Partnerships, institutions & press", e: ceo.email, c: "bg-yellow" },
          ].map((x) => (
            <a key={x.e} href={`mailto:${x.e}`} className={`rounded-2xl border-2 border-edge p-4 text-[#121212] no-underline transition hover:-translate-y-0.5 hover:shadow-[3px_3px_0_var(--shadow-c)] ${x.c}`}>
              <div className="font-display font-extrabold">{x.t}</div>
              <div className="text-sm opacity-80">{x.d}</div>
              <div className="mt-2 break-all text-sm font-bold underline">{x.e}</div>
            </a>
          ))}
        </div>
        <p className="flex items-center gap-2"><ShieldCheck className="size-4 shrink-0" /> Found a security issue? Email {BUSINESS.email} privately before sharing it anywhere.</p>
        <p>Want to know more about us? <Link href="/about">Meet the team</Link>.</p>
      </Section>
    </PolicyShell>
  );
}
