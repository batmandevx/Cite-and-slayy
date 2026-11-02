import { BadgeCheck, Bug, Clock, CreditCard, HeartHandshake, LifeBuoy, Mail, RotateCcw, ShieldAlert, Sparkles, UserRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Callout, Faq, PolicyShell, Section } from "@/components/legal/PolicyShell";
import { Reveal } from "@/components/legal/Reveal";
import { JsonLd } from "@/components/seo/JsonLd";
import { BUSINESS } from "@/lib/business";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "About us, contact & support",
  description: "Meet the team behind Cite & Slayy (Founder & CTO Ayush Upadhyay, Co-founder & CEO Team member) and get help with your account, payments and papers.",
  alternates: { canonical: "/about" },
};

const TOC = [
  { id: "who", title: "Who we are" }, { id: "team", title: "Our team" }, { id: "contact", title: "Contact us" },
  { id: "how", title: "How support works" }, { id: "faq", title: "Common questions" }, { id: "report", title: "Report a problem" },
];

const VALUES = [
  { icon: <BadgeCheck className="size-5" />, t: "Real sources only", d: "Every reference links to a real paper you can open and check." },
  { icon: <Sparkles className="size-5" />, t: "Honest AI", d: "We help you write better research, never hide how it was made." },
  { icon: <HeartHandshake className="size-5" />, t: "Built for students", d: "Fair prices in INR and support from the people who build it." },
];

export default function About() {
  const [founder, ceo] = BUSINESS.team;
  return (
    <PolicyShell current="/about" eyebrow="About & support" title="Hi, we're Cite & Slayy 👋" heroColor="bg-yellow"
      icon={<LifeBuoy className="size-12" />} toc={TOC}
      intro={<>We help students and researchers go from a topic to a well-sourced research paper, and check it before they submit. Here&apos;s who we are and how to reach us.</>}
      glance={[
        { icon: <Mail className="size-5" />, title: "Email support", text: BUSINESS.email, color: "bg-lime" },
        { icon: <Clock className="size-5" />, title: "Reply in 2 business days", text: "Usually much sooner. A real person reads every message.", color: "bg-mint" },
        { icon: <CreditCard className="size-5" />, title: "Every payment verified", text: "Payment issues are checked against Razorpay and fixed fast.", color: "bg-pink" },
        { icon: <RotateCcw className="size-5" />, title: "Fair refunds", text: "Cancel any time. See the refund policy for details.", color: "bg-surface" },
      ]}>
      <JsonLd data={{
        "@context": "https://schema.org", "@type": "AboutPage", url: `${SITE_URL}/about`,
        mainEntity: {
          "@type": "Organization", name: BUSINESS.brand, url: SITE_URL, email: BUSINESS.email,
          founder: { "@type": "Person", name: founder.name, jobTitle: "Founder & Chief Technology Officer", email: founder.email },
          employee: [{ "@type": "Person", name: ceo.name, jobTitle: "Co-founder & Chief Executive Officer", email: ceo.email }],
        },
      }} />

      <Section id="who" n={1} title="Who we are" icon={<Sparkles className="size-5" />}>
        <p>
          Cite &amp; Slayy is an AI research workspace. Give it a topic, or the papers you&apos;ve studied, and Azora AI&apos;s research agents
          find the gap, write a complete paper with <b>real, verified citations</b>, figures and equations, check originality and every
          reference, and help you pick the right journal.
        </p>
        <p>We started it because too many AI tools invent sources. Good research deserves references you can trust.</p>
        <div className="grid gap-3 pt-2 sm:grid-cols-3">
          {VALUES.map((v) => (
            <div key={v.t} className="rounded-2xl border-2 border-edge bg-surface-2 p-4">
              <div className="text-ink">{v.icon}</div>
              <div className="mt-2 font-display font-extrabold text-ink">{v.t}</div>
              <div className="text-sm">{v.d}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section id="team" n={2} title="Our team" icon={<UserRound className="size-5" />}>
        <div className="grid gap-4 sm:grid-cols-2">
          {BUSINESS.team.map((t, i) => (
            <Reveal key={t.name} delay={i * 0.08}>
              <div className="card flex h-full items-center gap-4 p-5 transition hover:-translate-y-1">
                <div className={`grid size-16 shrink-0 place-items-center rounded-2xl border-[2.5px] border-edge font-display text-2xl font-extrabold text-[#121212] ${t.color}`}>{t.initials}</div>
                <div className="min-w-0">
                  <div className="font-display text-xl font-extrabold text-ink">{t.name}</div>
                  <div className="text-sm font-semibold">{t.role}</div>
                  <a href={`mailto:${t.email}`} className="mt-1 inline-flex items-center gap-1 text-sm"><Mail className="size-3.5" />{t.email}</a>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      <Section id="contact" n={3} title="Contact us" icon={<Mail className="size-5" />}>
        <div className="not-prose overflow-x-auto">
          <table>
            <thead><tr><th>For</th><th>Write to</th></tr></thead>
            <tbody>
              <tr><td>Account, payments, refunds, papers, bugs</td><td><a href={`mailto:${BUSINESS.email}`}>{BUSINESS.email}</a></td></tr>
              <tr><td>Product, technology and security</td><td><a href={`mailto:${founder.email}`}>{founder.email}</a> ({founder.name}, {founder.role})</td></tr>
              <tr><td>Partnerships, institutions and press</td><td><a href={`mailto:${ceo.email}`}>{ceo.email}</a> ({ceo.name}, {ceo.role})</td></tr>
            </tbody>
          </table>
        </div>
        <p>Website: <a href={BUSINESS.website}>citeslayy.com</a></p>
      </Section>

      <Section id="how" n={4} title="How support works" icon={<LifeBuoy className="size-5" />}>
        <ol>
          <li><b>Email us from your registered address.</b> It lets us find your account securely.</li>
          <li><b>Include the details.</b> Your payment ID or UPI reference (UTR), the paper title, or a screenshot of what went wrong.</li>
          <li><b>We investigate.</b> Payments are checked directly with Razorpay; paper and citation issues are reproduced by our team.</li>
          <li><b>We reply within 2 business days</b> with a fix, a refund where it applies, or a clear explanation.</li>
        </ol>
        <Callout tone="mint">We never ask for your password, card number, CVV or UPI PIN. Ignore anyone who does.</Callout>
      </Section>

      <Section id="faq" n={5} title="Common questions" icon={<BadgeCheck className="size-5" />}>
        <div className="space-y-3">
          <Faq q="I paid but my plan didn't update" open>
            Card and UPI checkout payments are confirmed automatically with Razorpay, usually within a minute. If you paid by UPI QR, your plan
            activates after we match your 12-digit UTR. Still nothing? Email us your registered email and payment ID or UTR.
          </Faq>
          <Faq q="How do I cancel my subscription?">
            Open the app, go to <b>Account → Cancel subscription</b>. You keep your plan until the end of the period you paid for and won&apos;t be charged again.
            Read the full <Link href="/refund">cancellation &amp; refund policy</Link>.
          </Faq>
          <Faq q="A paper or check failed. Do I lose a credit?">
            No. If a paper, revision, audit or verdict fails, its use goes back to your monthly allowance automatically.
          </Faq>
          <Faq q="Are the citations really real?">
            Yes. References come from OpenAlex, Crossref, arXiv and Semantic Scholar, each with a link or DOI, and retracted papers are flagged.
            Always read and verify what you submit.
          </Faq>
          <Faq q="Can I use the paper as my own work?">
            Treat it as a strong first draft: check claims against sources, add your own analysis, and follow your university&apos;s and the
            publisher&apos;s rules on AI assistance and disclosure.
          </Faq>
          <Faq q="How do I delete my account and data?">
            Email us from your registered address. We delete your account and data within 30 days, except billing records the law requires us to keep.
          </Faq>
        </div>
      </Section>

      <Section id="report" n={6} title="Report a problem" icon={<Bug className="size-5" />}>
        <ul>
          <li><b>Bug or wrong citation:</b> send the paper title, what you expected and a screenshot to <a href={`mailto:${BUSINESS.email}`}>{BUSINESS.email}</a>.</li>
          <li><b>Security issue:</b> please email <a href={`mailto:${founder.email}`}>{founder.email}</a> privately before sharing it anywhere. We take every report seriously.</li>
          <li><b>Abuse or copyright concern:</b> tell us what and where, and we&apos;ll act on it quickly.</li>
        </ul>
        <Callout tone="yellow"><ShieldAlert className="mr-1 inline size-4" /> Read our <Link href="/terms">Terms</Link>, <Link href="/privacy">Privacy Policy</Link> and <Link href="/refund">Cancellation &amp; Refunds</Link>.</Callout>
      </Section>
    </PolicyShell>
  );
}
