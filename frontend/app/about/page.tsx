import { ArrowRight, BadgeCheck, BookOpenCheck, Compass, FileText, Gavel, HeartHandshake, Rocket, ShieldCheck, Sparkles, Target } from "lucide-react";
import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import Link from "next/link";
import { PolicyShell, Section } from "@/components/legal/PolicyShell";
import { Reveal } from "@/components/legal/Reveal";
import { FoundersSpotlight } from "@/components/FoundersSpotlight";
import { JsonLd } from "@/components/seo/JsonLd";
import { BUSINESS } from "@/lib/business";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = pageMetadata({
  title: "About us",
  description: `Cite & Slayy is an AI research workspace led by ${BUSINESS.team[0].role} ${BUSINESS.team[0].name}. Real, verified citations for every student and researcher.`,
  path: "/about",
});

const STATS = [
  { v: "4", l: "scholarly databases checked", c: "bg-lime" },
  { v: "100%", l: "real, linkable references", c: "bg-yellow" },
  { v: "2", l: "publisher formats: IEEE & Springer", c: "bg-mint" },
  { v: "₹0", l: "to start, no card needed", c: "bg-pink" },
];

const JOURNEY = [
  { icon: <Compass className="size-5" />, t: "Find the gap", d: "Map a field with real publication data and spot what's underexplored." },
  { icon: <FileText className="size-5" />, t: "Write the paper", d: "Research agents draft every section with verified citations, figures and equations." },
  { icon: <BookOpenCheck className="size-5" />, t: "Check everything", d: "References, retractions, claim support and originality, line by line." },
  { icon: <Gavel className="size-5" />, t: "Decide & submit", d: "A reasoned go / no-go verdict and the journals that fit your work." },
];

const VALUES = [
  { icon: <BadgeCheck className="size-6" />, t: "Real sources only", d: "Every reference links to a real paper you can open. If we can't verify it, we flag it.", c: "bg-lime" },
  { icon: <ShieldCheck className="size-6" />, t: "Honest AI", d: "We help you write better research, never hide how it was made or promise to beat detectors.", c: "bg-mint" },
  { icon: <HeartHandshake className="size-6" />, t: "Built for students", d: "Fair prices in INR, a free plan to start, and support from the people who build it.", c: "bg-pink" },
  { icon: <Target className="size-6" />, t: "Evidence for every flag", d: "Every warning shows its source, so you can check our work instead of trusting a score.", c: "bg-yellow" },
];

export default function About() {
  const [ceo] = BUSINESS.team;
  return (
    <PolicyShell current="/about" eyebrow="About us" title="Research you can trust, made simple" heroColor="bg-yellow"
      icon={<Rocket className="size-12" />}
      intro={<>{BUSINESS.brand} turns a topic into a well-sourced research paper and checks it before you submit. We&apos;re a small team from {BUSINESS.country} building the research tool we wished we had.</>}>
      <JsonLd data={{
        "@context": "https://schema.org", "@type": "AboutPage", url: `${SITE_URL}/about`,
        mainEntity: {
          "@type": "Organization", name: BUSINESS.brand, url: SITE_URL, email: BUSINESS.email,
          founder: [
            { "@type": "Person", name: ceo.name, jobTitle: ceo.role, email: ceo.email },
          ],
        },
      }} />

      {/* numbers */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STATS.map((s, i) => (
          <Reveal key={s.l} delay={i * 0.07}>
            <div className={`card h-full p-5 text-[#121212] ${s.c}`}>
              <div className="font-display text-5xl font-extrabold tracking-tight">{s.v}</div>
              <div className="mt-1 text-sm font-semibold opacity-80">{s.l}</div>
            </div>
          </Reveal>
        ))}
      </div>

      <Section id="story" n={1} title="Why we built it" icon={<Sparkles className="size-5" />}>
        <p className="text-[17px]">
          AI writing tools are fast, but too many of them <b>invent sources</b>. Students lose marks, papers get desk-rejected,
          and nobody can tell which citations are real until it&apos;s too late.
        </p>
        <p className="text-[17px]">
          We built {BUSINESS.brand} so speed and honesty go together: Azora AI&apos;s research agents only cite papers that exist,
          every claim can be traced to its source, and every check shows its evidence. <b>Cite it right, slay the review.</b>
        </p>
      </Section>

      <Section id="what" n={2} title="What it does, start to finish" icon={<Compass className="size-5" />}>
        <ol className="relative grid list-none gap-4 pl-0 md:grid-cols-4">
          {JOURNEY.map((j, i) => (
            <li key={j.t} className="relative m-0 rounded-2xl border-2 border-edge bg-surface-2 p-4">
              <div className="flex items-center gap-2">
                <span className="grid size-8 place-items-center rounded-full border-2 border-edge bg-yellow font-display text-sm font-extrabold text-[#121212]">{i + 1}</span>
                <span className="text-ink">{j.icon}</span>
              </div>
              <div className="mt-3 font-display font-extrabold text-ink">{j.t}</div>
              <div className="text-sm">{j.d}</div>
              {i < JOURNEY.length - 1 && <ArrowRight className="absolute -right-3.5 top-1/2 z-10 hidden size-5 -translate-y-1/2 rounded-full bg-surface text-ink md:block" />}
            </li>
          ))}
        </ol>
      </Section>

      <Reveal>
        <div id="team" className="scroll-mt-6"><FoundersSpotlight /></div>
      </Reveal>

      <Section id="values" n={3} title="What we stand for" icon={<ShieldCheck className="size-5" />}>
        <div className="grid gap-3 sm:grid-cols-2">
          {VALUES.map((v) => (
            <div key={v.t} className={`rounded-2xl border-2 border-edge p-4 text-[#121212] transition hover:-translate-y-0.5 hover:shadow-[3px_3px_0_var(--shadow-c)] ${v.c}`}>
              {v.icon}
              <div className="mt-2 font-display text-lg font-extrabold">{v.t}</div>
              <div className="text-sm opacity-85">{v.d}</div>
            </div>
          ))}
        </div>
      </Section>

      <Reveal>
        <div className="card flex flex-col items-start gap-4 bg-mint p-6 text-[#121212] md:flex-row md:items-center md:justify-between">
          <div>
            <div className="font-display text-2xl font-extrabold">Need help with something?</div>
            <p className="text-sm opacity-80">Search answers or write to us in the help centre.</p>
          </div>
          <Link href="/support" className="btn-brut inline-flex items-center gap-2 rounded-2xl bg-surface px-5 py-2.5 font-display font-extrabold">
            Visit the help centre <ArrowRight className="size-5" />
          </Link>
        </div>
      </Reveal>
    </PolicyShell>
  );
}
