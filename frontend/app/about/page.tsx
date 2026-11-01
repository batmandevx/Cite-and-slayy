import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/LegalPage";
import { JsonLd } from "@/components/seo/JsonLd";
import { BUSINESS } from "@/lib/business";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "About us, contact & support",
  description: "Meet the team behind Cite & Slayy (founder Ayush Upadhyay, CEO Team member) and get help: support email, response times and common questions.",
  alternates: { canonical: "/about" },
};

const TEAM = [
  { name: "Ayush Upadhyay", role: "Founder", initials: "AU", color: "bg-pink" },
  { name: "Team member", role: "Chief Executive Officer (CEO)", initials: "AB", color: "bg-lime" },
];

const HELP = [
  { q: "A payment went through but my plan didn't update", a: "Email us your registered email and the payment ID or UPI reference (UTR). We verify every payment and activate it manually if needed." },
  { q: "I want to cancel or get a refund", a: "See our cancellation and refund policy, then email us from your registered address." },
  { q: "I found a wrong citation or a bug", a: "Send us the paper title or a screenshot. Reports that help us improve are always welcome." },
  { q: "Something looks like a security issue", a: "Please email us privately before sharing it anywhere else. We take every report seriously." },
];

export default function About() {
  return (
    <LegalPage title="About us, contact & support">
      <JsonLd data={{
        "@context": "https://schema.org", "@type": "AboutPage", url: `${SITE_URL}/about`,
        mainEntity: {
          "@type": "Organization", name: BUSINESS.brand, url: SITE_URL, email: BUSINESS.email,
          founder: { "@type": "Person", name: "Ayush Upadhyay", jobTitle: "Founder" },
          employee: [{ "@type": "Person", name: "Team member", jobTitle: "Chief Executive Officer" }],
        },
      }} />

      <h2>Who we are</h2>
      <p>
        Cite &amp; Slayy helps students and researchers go from a topic to a well-sourced research paper, and check it before they submit:
        real, verified citations, research-gap discovery, originality checks and journal matching, powered by Azora AI.
        We built it because good research deserves sources you can trust.
      </p>

      <h2>Our team</h2>
      <div className="not-prose grid gap-4 sm:grid-cols-2">
        {TEAM.map((t) => (
          <div key={t.name} className="card flex items-center gap-4 p-4">
            <div className={`grid size-14 shrink-0 place-items-center rounded-2xl border-[2.5px] border-edge font-display text-xl font-extrabold text-[#121212] ${t.color}`}>{t.initials}</div>
            <div>
              <div className="font-display text-lg font-extrabold">{t.name}</div>
              <div className="text-sm text-ink-2">{t.role}</div>
            </div>
          </div>
        ))}
      </div>

      <h2>Contact &amp; support</h2>
      <p>
        Email us at <a className="font-bold underline" href={`mailto:${BUSINESS.email}`}>{BUSINESS.email}</a> for help with your account,
        payments, papers or anything else. We reply within 2 business days.
      </p>
      <p>Please write from your registered email address and include any payment ID, paper title or screenshot that helps us understand the issue.</p>

      <h2>Common questions</h2>
      <ul>
        {HELP.map((h) => <li key={h.q}><b>{h.q}.</b> {h.a}</li>)}
      </ul>

      <h2>Policies</h2>
      <p>
        <Link className="underline" href="/terms">Terms of service</Link> · <Link className="underline" href="/privacy">Privacy policy</Link> ·{" "}
        <Link className="underline" href="/refund">Cancellation &amp; refunds</Link> · <Link className="underline" href="/contact">Business contact details</Link>
      </p>
    </LegalPage>
  );
}
