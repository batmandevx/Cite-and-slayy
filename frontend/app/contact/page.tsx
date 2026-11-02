import { Briefcase, Clock, Globe, LifeBuoy, Mail, MessageCircle, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PolicyShell, Section } from "@/components/legal/PolicyShell";
import { Reveal } from "@/components/legal/Reveal";
import { BUSINESS } from "@/lib/business";

export const metadata: Metadata = {
  title: "Contact",
  description: "Contact Cite & Slayy: support at slayyhacks@gmail.com, or reach our Founder & CTO and Co-founder & CEO directly.",
  alternates: { canonical: "/contact" },
};

export default function Contact() {
  const [cto, ceo] = BUSINESS.team;
  const CARDS = [
    { icon: <LifeBuoy className="size-6" />, t: "Support", d: "Account, payments, refunds, papers and bugs", email: BUSINESS.email, color: "bg-lime" },
    { icon: <ShieldCheck className="size-6" />, t: `${cto.name} · ${cto.role}`, d: "Product, technology and security", email: cto.email, color: "bg-pink" },
    { icon: <Briefcase className="size-6" />, t: `${ceo.name} · ${ceo.role}`, d: "Partnerships, institutions and press", email: ceo.email, color: "bg-yellow" },
  ];
  return (
    <PolicyShell current="/contact" eyebrow="Contact" title="Get in touch" heroColor="bg-surface" icon={<MessageCircle className="size-12" />}
      intro={<>Questions, feedback or partnership ideas? We read every message and reply within 2 business days.</>}>
      <div className="grid gap-4 md:grid-cols-3">
        {CARDS.map((c, i) => (
          <Reveal key={c.email} delay={i * 0.08}>
            <a href={`mailto:${c.email}`} className={`card group block h-full p-6 text-[#121212] transition hover:-translate-y-1 ${c.color}`}>
              <div className="grid size-12 place-items-center rounded-2xl border-2 border-edge bg-surface">{c.icon}</div>
              <div className="mt-4 font-display text-lg font-extrabold leading-tight">{c.t}</div>
              <div className="mt-1 text-sm opacity-80">{c.d}</div>
              <div className="mt-4 inline-flex items-center gap-1.5 break-all font-bold underline decoration-2 underline-offset-4"><Mail className="size-4 shrink-0" />{c.email}</div>
            </a>
          </Reveal>
        ))}
      </div>
      <Section id="details" n={1} title="Details" icon={<Globe className="size-5" />}>
        <ul>
          <li><b>Brand:</b> {BUSINESS.brand}</li>
          <li><b>Website:</b> <a href={BUSINESS.website}>citeslayy.com</a></li>
          <li><b>Country:</b> {BUSINESS.country}</li>
          <li><b>Response time:</b> <Clock className="mb-0.5 inline size-4" /> within 2 business days</li>
        </ul>
        <p>For help with common questions, see <Link href="/about#faq">About &amp; support</Link>.</p>
      </Section>
    </PolicyShell>
  );
}
