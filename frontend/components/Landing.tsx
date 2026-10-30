"use client";

import clsx from "clsx";
import {
  ArrowRight, BadgeCheck, Compass, FilePen, Gavel, Quote, ShieldAlert, ShieldCheck, Sparkles, Wand2, Zap,
} from "lucide-react";
import Link from "next/link";
import { motion, MotionConfig, useReducedMotion, useScroll, useSpring, useTransform } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { Pricing } from "./billing/Pricing";
import { LandingDemoPapers } from "./DemoPapersShowcase";
import { PaperBuilder } from "./landing/PaperBuilder";
import { Logo } from "./Logo";
import { AnimatedNumber } from "./motion";
import { ThemeProvider, ThemeToggle } from "./theme";

interface Stats { papers_mapped: number; references_checked: number; papers_audited: number; retractions_caught: number; verdicts: number }

const pop = { type: "spring", stiffness: 260, damping: 18 } as const;

function InView({ children, delay = 0, className, rotate = 0 }: { children: ReactNode; delay?: number; className?: string; rotate?: number }) {
  return (
    <motion.div className={className} initial={{ opacity: 0, y: 40, rotate: rotate * 2, scale: 0.96 }}
      whileInView={{ opacity: 1, y: 0, rotate, scale: 1 }} viewport={{ once: true, margin: "-60px" }} transition={{ ...pop, delay }}>
      {children}
    </motion.div>
  );
}

function Marquee({ items, className }: { items: string[]; className?: string }) {
  const row = [...items, ...items];
  return (
    <div className={clsx("marquee border-y-[2.5px] border-edge py-3", className)}>
      <div className="marquee__track font-display text-xl font-extrabold uppercase tracking-tight md:text-2xl">
        {row.map((t, i) => (
          <span key={i} className="inline-flex items-center gap-10">
            {t} <Sparkles className="size-5 shrink-0" />
          </span>
        ))}
      </div>
    </div>
  );
}

const GETS = [
  { e: "📄", t: "A complete paper", d: "Abstract to conclusion: introduction, related work, method, results, discussion.", c: "bg-yellow" },
  { e: "🔗", t: "Real, verified references", d: "Every citation is a real paper with a DOI or link, checked for retractions.", c: "bg-lime" },
  { e: "📊", t: "Figures from real data", d: "Trend charts and tables computed from scholarly databases, not made up.", c: "bg-surface" },
  { e: "🧩", t: "Diagrams & equations", d: "Architecture diagram, workflow flowchart and numbered LaTeX equations.", c: "bg-blue text-white" },
  { e: "🖨️", t: "LaTeX, Word & PDF", d: "IEEE or Springer LaTeX (.zip with figures), Word with embedded figures, print-ready PDF.", c: "bg-pink" },
  { e: "🛡️", t: "Originality & citation report", d: "Copied-text and paraphrase checks against sources, claim support, tortured phrases.", c: "bg-mint" },
  { e: "💬", t: "Revise by chat", d: "Just say what to change. Agents rewrite, then re-verify. Undo anytime.", c: "bg-violet text-white" },
  { e: "🎯", t: "Where to publish", d: "Matching journals and conferences with open-access, DOAJ, APC and h-index info.", c: "bg-orange" },
];

const STEPS = [
  { n: 1, icon: Compass, title: "Tell us the topic", body: "Type a topic, brainstorm one with Azora AI from your interests, or upload the papers you've studied.", color: "bg-lime" },
  { n: 2, icon: FilePen, title: "Agents write it", body: "14 specialist agents vet real literature, measure longitudinal trends, formulate notation & theorems, and draft every section with figures, algorithms and diagrams.", color: "bg-blue text-white" },
  { n: 3, icon: ShieldCheck, title: "Say what to change", body: "“Add a comparison table.” “Make it more formal.” The agents revise, then re-check every citation, number and equation.", color: "bg-yellow" },
  { n: 4, icon: Gavel, title: "Download & submit", body: "Get LaTeX (IEEE / Springer), Word and PDF, a reviewer verdict, and a shortlist of matching journals and conferences.", color: "bg-pink" },
];


function LandingInner() {
  const reduced = !!useReducedMotion();
  const [stats, setStats] = useState<Stats | null>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ["start start", "end start"] });
  const yParallax = useTransform(scrollYProgress, [0, 1], [0, 120]);
  const progress = useSpring(useScroll().scrollYProgress, { stiffness: 200, damping: 30 });

  useEffect(() => {
    api.get<Stats>("/api/stats").then(setStats).catch(() => {});
  }, []);

  return (
    <div className="overflow-x-clip">
      <motion.div className="scroll-progress" style={{ scaleX: progress }} aria-hidden />

      {/* ---------- nav ---------- */}
      <header className="sticky top-0 z-40 border-b-[2.5px] border-edge bg-bg/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1240px] items-center justify-between gap-4 px-5 py-3.5">
          <Logo />
          <nav className="hidden items-center gap-7 font-display text-[15px] font-bold md:flex">
            <a href="#how" className="hover:text-pink">How it works</a>
            <a href="#demos" className="hover:text-pink">Demo papers</a>
            <a href="#catches" className="hover:text-pink">What it catches</a>
            <a href="#honest" className="hover:text-pink">No fake data</a>
            <a href="#pricing" className="hover:text-pink">Pricing</a>
          </nav>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link href="/app" className="btn-brut inline-flex items-center gap-1.5 rounded-xl bg-lime px-4 py-2 font-display text-sm font-extrabold text-[#121212]">
              Open the app <ArrowRight className="size-4" />
            </Link>
          </div>
        </div>
      </header>

      {/* ---------- hero ---------- */}
      <section ref={heroRef} className="relative mx-auto max-w-[1240px] px-5 pb-16 pt-14 md:pt-20">
        <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_1fr]">
          <div>
            <motion.div initial={{ opacity: 0, y: 20, rotate: -6 }} animate={{ opacity: 1, y: 0, rotate: -3 }} transition={pop}
              className="sticker mb-6 bg-lime">
              <BadgeCheck className="size-4" /> Topic → publish-ready paper · LaTeX · PDF · Word
            </motion.div>
            <h1 className="font-display text-[44px] font-extrabold leading-[0.95] tracking-tight sm:text-6xl lg:text-[76px]">
              {["Writing", "a", "research", "paper", "was"].map((w, i) => (
                <motion.span key={w} className="mr-3 inline-block" initial={{ opacity: 0, y: 60, rotate: 8 }}
                  animate={{ opacity: 1, y: 0, rotate: 0 }} transition={{ ...pop, delay: 0.08 * i }}>{w}</motion.span>
              ))}
              <br />
              <motion.span className="relative mt-2 inline-block" initial={{ opacity: 0, scale: 0.6, rotate: -8 }}
                animate={{ opacity: 1, scale: 1, rotate: -2 }} transition={{ ...pop, delay: 0.35 }}>
                <span className="absolute inset-0 -z-10 translate-x-2 translate-y-2 rounded-2xl border-[3px] border-edge bg-[#121212]" />
                <span className="relative block rounded-2xl border-[3px] border-edge bg-pink px-4 pb-2 pt-1 text-[#121212]">never this easy.</span>
              </motion.span>
            </h1>
            <motion.p initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.55 }}
              className="mt-8 max-w-xl text-lg leading-relaxed text-ink-2">
              Give us a topic, or the papers you&apos;ve studied. Our research agents write a <b className="text-ink">complete, publish-ready paper from scratch</b>:
              <b className="text-ink"> real verified citations</b>, figures, equations and diagrams, formatted for <b className="text-ink">IEEE or Springer</b>.
              Then we help you <b className="text-ink">pick the right journal</b>.
            </motion.p>
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7 }}
              className="mt-8 flex flex-wrap gap-3">
              <Link href="/app?tab=studio" className="btn-brut inline-flex items-center gap-2 rounded-2xl bg-pink px-6 py-4 font-display text-lg font-extrabold text-[#121212]">
                <Zap className="size-5" /> Write my paper
              </Link>
              <a href="#pricing" className="btn-brut inline-flex items-center gap-2 rounded-2xl bg-surface px-6 py-4 font-display text-lg font-extrabold">
                <ShieldCheck className="size-5" /> See plans
              </a>
              <Link href="/app?aurora=1" className="btn-brut inline-flex items-center gap-2 rounded-2xl bg-violet px-6 py-4 font-display text-lg font-extrabold text-white">
                <Sparkles className="size-5" /> Ask Azora AI
              </Link>
            </motion.div>
          </div>

          <motion.div style={reduced ? undefined : { y: yParallax }} className="relative" initial={{ opacity: 0, scale: 0.92, rotate: 4 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }} transition={{ ...pop, delay: 0.2 }}>
            <PaperBuilder />
          </motion.div>
        </div>
      </section>

      <Marquee className="-rotate-1 bg-yellow text-[#121212]"
        items={["Full paper from scratch", "Verified references", "LaTeX · PDF · Word", "IEEE & Springer", "Figures & diagrams",
          "Originality report", "Journal finder", "Revise by chat", "Crossref", "OpenAlex", "arXiv"]} />

      {/* ---------- what you get ---------- */}
      <section className="mx-auto max-w-[1240px] px-5 pt-16">
        <InView className="mb-10 text-center">
          <div className="sticker mx-auto mb-4 rotate-2 bg-pink text-[#121212]">What you get</div>
          <h2 className="font-display text-4xl font-extrabold md:text-5xl">Everything a paper needs. <span className="gradient-text">Done.</span></h2>
        </InView>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {GETS.map((g, i) => (
            <InView key={g.t} delay={i * 0.05} rotate={i % 2 ? 1 : -1}>
              <motion.div whileHover={{ y: -6, rotate: i % 2 ? -1 : 1 }} className={clsx("card card-pop h-full p-5", g.c, !g.c.includes("surface") && !g.c.includes("text-white") && "text-[#121212]")}>
                <div className="text-3xl">{g.e}</div>
                <div className="mt-2 font-display text-lg font-extrabold leading-tight">{g.t}</div>
                <p className="mt-1 text-sm opacity-80">{g.d}</p>
              </motion.div>
            </InView>
          ))}
        </div>
      </section>

      {/* ---------- live stats ---------- */}
      <section className="mx-auto grid max-w-[1240px] grid-cols-2 gap-4 px-5 py-16 md:grid-cols-4">
        {[
          ["Papers mapped", stats?.papers_mapped, "bg-lime"],
          ["References checked", stats?.references_checked, "bg-surface"],
          ["Papers audited", stats?.papers_audited, "bg-blue text-white"],
          ["Retractions caught", stats?.retractions_caught, "bg-pink"],
        ].map(([label, v, color], i) => (
          <InView key={label as string} delay={i * 0.08} rotate={i % 2 ? 1 : -1}>
            <div className={clsx("card card-pop px-5 py-6", color as string, !(color as string).includes("surface") && !(color as string).includes("text-white") && "text-[#121212]")}>
              <div className="font-display text-5xl font-extrabold tracking-tight md:text-6xl">
                {typeof v === "number" ? <AnimatedNumber value={v} /> : "—"}
              </div>
              <div className="mt-1 font-display text-sm font-bold uppercase tracking-wide opacity-80">{label as string}</div>
            </div>
          </InView>
        ))}
        <p className="col-span-full text-center text-xs text-muted">Live counters from this deployment&apos;s own results, not marketing numbers.</p>
      </section>

      {/* ---------- how it works ---------- */}
      <section id="how" className="mx-auto max-w-[1240px] scroll-mt-24 px-5 py-12">
        <InView className="mb-10 text-center">
          <div className="sticker mx-auto mb-4 -rotate-2 bg-surface">How it works</div>
          <h2 className="font-display text-4xl font-extrabold md:text-5xl">Topic → paper → changes → submit</h2>
        </InView>
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <InView key={s.n} delay={i * 0.1} rotate={[-1.5, 1, -1, 1.5][i]}>
              <div className="card card-pop h-full p-6">
                <div className="mb-5 flex items-center justify-between">
                  <span className={clsx("grid size-14 place-items-center rounded-2xl border-[2.5px] border-edge shadow-[3px_3px_0_var(--shadow-c)]", s.color, !s.color.includes("text-white") && "text-[#121212]")}>
                    <s.icon className="size-7" />
                  </span>
                  <span className="font-display text-6xl font-extrabold text-surface-3">{s.n}</span>
                </div>
                <h3 className="font-display text-2xl font-extrabold">{s.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{s.body}</p>
              </div>
            </InView>
          ))}
        </div>
      </section>

      {/* ---------- what it catches (real results from the demo papers) ---------- */}
      <section id="catches" className="mx-auto max-w-[1240px] scroll-mt-24 px-5 py-16">
        <InView className="mb-10 text-center">
          <div className="sticker mx-auto mb-4 rotate-2 bg-pink">Real catches</div>
          <h2 className="font-display text-4xl font-extrabold md:text-5xl">What it actually found</h2>
          <p className="mx-auto mt-3 max-w-2xl text-ink-2">Straight from audits of the real papers bundled with the demo.</p>
        </InView>
        <div className="grid gap-5 md:grid-cols-6">
          <InView className="md:col-span-4" rotate={-0.5}>
            <div className="card card-pop h-full bg-crit-soft p-7">
              <div className="sticker mb-4 bg-crit text-white" style={{ color: "#fff" }}><ShieldAlert className="size-4" /> RETRACTED citation</div>
              <p className="font-display text-2xl font-extrabold leading-snug md:text-3xl">
                A 2020 COVID preprint cites Gautret et al., the hydroxychloroquine trial that was later retracted.
              </p>
              <p className="mt-3 text-sm text-ink-2">
                Crossref notice <span className="font-mono">10.1016/j.ijantimicag.2024.107416</span>. A same-titled preprint version isn&apos;t retracted, so Cite &amp; Slayy checks every version and the retraction can&apos;t hide.
              </p>
            </div>
          </InView>
          <InView className="md:col-span-2" delay={0.1} rotate={1}>
            <div className="card card-pop h-full bg-yellow p-7 text-[#121212]">
              <Quote className="mb-3 size-8" />
              <p className="font-display text-xl font-extrabold">“counterfeit consciousness”</p>
              <p className="mt-1 text-sm">is a tortured phrase for <b>artificial intelligence</b>: one of 70 entries sourced from Cabanac et al. (2021).</p>
            </div>
          </InView>
          <InView className="md:col-span-2" delay={0.05} rotate={1}>
            <div className="card card-pop h-full bg-lime p-7 text-[#121212]">
              <div className="font-display text-6xl font-extrabold">0</div>
              <p className="mt-1 font-display text-lg font-extrabold">The paper itself, retracted</p>
              <p className="mt-1 text-sm">An image-classification paper scores 0/100: Crossref lists retraction notice <span className="font-mono">10.1155/2023/9780628</span>.</p>
            </div>
          </InView>
          <InView className="md:col-span-4" delay={0.15} rotate={-0.5}>
            <div className="card card-pop h-full p-7">
              <div className="sticker mb-4 bg-blue text-white" style={{ color: "#fff" }}><Wand2 className="size-4" /> Reviewer jury · Methods 4/10</div>
              <p className="font-display text-xl font-extrabold leading-snug md:text-2xl">
                Flagged: a single run with no baselines or variance across seeds, and a 16.9-second runtime that doesn&apos;t fit the paper&apos;s billion-parameter framing.
              </p>
              <p className="mt-3 text-sm text-ink-2">Paraphrased from the Methods reviewer&apos;s feedback on an AI-generated draft.</p>
            </div>
          </InView>
        </div>
      </section>

      {/* ---------- honesty ---------- */}
      <section id="honest" className="scroll-mt-24 border-y-[2.5px] border-edge bg-[#121212] py-16 text-[#fff5e6]">
        <div className="mx-auto grid max-w-[1240px] items-center gap-10 px-5 lg:grid-cols-2">
          <InView>
            <div className="sticker mb-5 -rotate-2 bg-lime">No fake data. Ever.</div>
            <h2 className="font-display text-4xl font-extrabold leading-tight md:text-5xl">
              If it can&apos;t check it, it says <span className="text-yellow">“could not verify”</span>, never “verified”.
            </h2>
          </InView>
          <div className="grid gap-3">
            {[
              "Every flag links the exact API response it came from",
              "Missing abstract → “Unclear”, never “Unsupported”",
              "The AI can only cite papers it was actually shown",
              "Integrity score shows its formula and inputs",
            ].map((t, i) => (
              <InView key={t} delay={i * 0.08}>
                <div className="flex items-center gap-3 rounded-2xl border-[2.5px] border-[#fff5e6] bg-[#1e1b17] px-5 py-4 font-display text-lg font-bold shadow-[4px_4px_0_#ff4fa3]">
                  <BadgeCheck className="size-6 shrink-0 text-lime" /> {t}
                </div>
              </InView>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- showcase demo papers ---------- */}
      <LandingDemoPapers />

      {/* ---------- pricing ---------- */}
      <section id="pricing" className="mx-auto max-w-[1240px] scroll-mt-24 px-5 py-16">
        <div className="mb-10 text-center">
          <span className="sticker bg-yellow text-[#121212]">Plans</span>
          <h2 className="mt-3 font-display text-4xl font-extrabold md:text-5xl">Topic in. <span className="gradient-text">Paper out.</span></h2>
          <p className="mx-auto mt-2 max-w-xl text-ink-2">Start free with one full paper a month. Go Pro for the Pro engine, AI revisions and more.</p>
        </div>
        <Pricing onChoose={() => { window.location.href = "/pricing"; return false; }} onBuyPack={async () => { window.location.href = "/pricing"; return false; }} />
      </section>

      {/* ---------- CTA ---------- */}
      <section className="mx-auto max-w-[1240px] px-5 py-20">
        <InView rotate={-1}>
          <div className="card relative overflow-hidden bg-pink px-8 py-14 text-center text-[#121212] md:py-20">
            <Sparkles className="wobble absolute left-8 top-8 size-10" />
            <Sparkles className="wobble absolute bottom-10 right-10 size-12" />
            <h2 className="font-display text-4xl font-extrabold md:text-6xl">Ready to slay?</h2>
            <p className="mx-auto mt-3 max-w-xl text-lg">Draft → audit → verdict in one click, with a report you can hand to your supervisor.</p>
            <Link href="/app?slay=1" className="btn-brut mt-8 inline-flex items-center gap-2 rounded-2xl bg-yellow px-8 py-4 font-display text-xl font-extrabold">
              <Zap className="size-6" /> Slay it now
            </Link>
          </div>
        </InView>
      </section>

      <Marquee className="rotate-1 bg-lime text-[#121212]" items={["Cite it right", "Slay the review", "Evidence for every flag", "Retractions included"]} />

      <footer className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-4 px-5 py-10 text-sm text-ink-2">
        <Logo />
        <p className="max-w-xl text-xs">
          Data: OpenAlex, arXiv, Semantic Scholar, Crossref (incl. Retraction Watch). Built for the GDGOC APU Hackathon.
        </p>
        <nav className="flex flex-wrap gap-4 text-xs font-bold">
          <Link href="/pricing">Pricing</Link><Link href="/terms">Terms</Link><Link href="/privacy">Privacy</Link>
          <Link href="/refund">Refunds</Link><Link href="/contact">Contact</Link>
        </nav>
      </footer>
    </div>
  );
}

export default function Landing() {
  return (
    <ThemeProvider>
      <MotionConfig reducedMotion="user">
        <LandingInner />
      </MotionConfig>
    </ThemeProvider>
  );
}
