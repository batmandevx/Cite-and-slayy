import { Cookie, Database, Eye, Globe, Lock, Mail, Server, ShieldCheck, Trash2, UserRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Callout, PolicyShell, Section } from "@/components/legal/PolicyShell";
import { BUSINESS } from "@/lib/business";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How Cite & Slayy collects, uses and protects your data, uploads and research papers. We never sell your data.",
  alternates: { canonical: "/privacy" },
};

const TOC = [
  ["collect", "What we collect"], ["use", "How we use it"], ["share", "Who we share it with"], ["security", "How we protect it"],
  ["cookies", "Cookies"], ["retention", "Keeping & deleting data"], ["rights", "Your rights"], ["contact", "Privacy contact"],
].map(([id, title]) => ({ id, title }));

export default function Privacy() {
  const cto = BUSINESS.team[0];
  return (
    <PolicyShell current="/privacy" eyebrow="Legal" title="Privacy Policy" heroColor="bg-lime" icon={<Lock className="size-12" />} toc={TOC}
      intro={<>Your research is yours. This policy explains what {BUSINESS.brand} collects, why, and the control you have over it.</>}
      glance={[
        { icon: <ShieldCheck className="size-5" />, title: "We never sell your data", text: "No ads, no data brokers, ever.", color: "bg-yellow" },
        { icon: <Eye className="size-5" />, title: "Private by default", text: "Your papers, notes and chats are visible only to you.", color: "bg-mint" },
        { icon: <Cookie className="size-5" />, title: "One essential cookie", text: "Just to keep you signed in. No tracking cookies.", color: "bg-pink" },
        { icon: <Trash2 className="size-5" />, title: "Delete any time", text: "Ask and we erase your account within 30 days.", color: "bg-surface" },
      ]}>
      <Section id="collect" n={1} title="What we collect" icon={<Database className="size-5" />}>
        <ul>
          <li><b>Account:</b> your name, email address and a securely hashed password (or your Google profile name, email and picture if you sign in with Google).</li>
          <li><b>Your work:</b> papers you upload, papers and decks generated for you, notes, to-dos, images you add and chats with Azora AI.</li>
          <li><b>Usage:</b> which features you use and how much AI processing they need, so we can apply plan limits and keep costs fair.</li>
          <li><b>Payments:</b> handled by Razorpay. We receive payment and subscription IDs, amounts and status (and the UTR you give us for UPI QR payments), never your card, bank or UPI PIN details.</li>
          <li><b>Technical:</b> basic logs such as IP address, browser and error reports, used for security and to fix problems.</li>
        </ul>
      </Section>
      <Section id="use" n={2} title="How we use it" icon={<UserRound className="size-5" />}>
        <ul>
          <li>to provide the Service: research, writing, checks, exports and support;</li>
          <li>to apply your plan, verify payments and prevent fraud and abuse;</li>
          <li>to keep the Service secure and fix bugs;</li>
          <li>to email you about your account, payments and important changes. We don&apos;t send marketing without your consent.</li>
        </ul>
        <Callout tone="lime">We don&apos;t sell your data, and we don&apos;t use your private papers to advertise to you.</Callout>
      </Section>
      <Section id="share" n={3} title="Who we share it with" icon={<Globe className="size-5" />}>
        <ul>
          <li><b>AI model providers</b> process the text needed to produce your results, under agreements that keep it confidential.</li>
          <li><b>Public scholarly databases</b> (such as OpenAlex, Crossref, arXiv and Semantic Scholar) receive search terms and reference details, not your account details.</li>
          <li><b>Cloud hosting</b> stores your data on secured servers.</li>
          <li><b>Razorpay</b> processes payments.</li>
          <li><b>Authorities</b>, only when the law requires it.</li>
        </ul>
      </Section>
      <Section id="security" n={4} title="How we protect it" icon={<Server className="size-5" />}>
        <ul>
          <li>Encrypted HTTPS connections everywhere, with strict browser security headers.</li>
          <li>Passwords stored only as strong one-way hashes; sessions signed and revocable.</li>
          <li>Your documents are tied to your account and hidden from everyone else.</li>
          <li>Every payment is verified server-to-server with Razorpay.</li>
        </ul>
      </Section>
      <Section id="cookies" n={5} title="Cookies" icon={<Cookie className="size-5" />}>
        <p>We use one essential, secure cookie to keep you signed in. Your theme and some app preferences are saved in your browser&apos;s local storage. We use no advertising or cross-site tracking cookies.</p>
      </Section>
      <Section id="retention" n={6} title="Keeping & deleting data" icon={<Trash2 className="size-5" />}>
        <p>
          We keep your data while your account is active. Email <a href={`mailto:${BUSINESS.email}`}>{BUSINESS.email}</a> from your registered address to export or
          delete your account; we act within 30 days, except billing records we must keep by law.
        </p>
      </Section>
      <Section id="rights" n={7} title="Your rights" icon={<ShieldCheck className="size-5" />}>
        <p>Under India&apos;s Digital Personal Data Protection Act and similar laws, you can ask us to:</p>
        <ul>
          <li>tell you what personal data we hold and how we use it;</li>
          <li>correct or update it;</li>
          <li>delete it, or withdraw consent for optional processing;</li>
          <li>raise a grievance and get a response.</li>
        </ul>
      </Section>
      <Section id="contact" n={8} title="Privacy contact" icon={<Mail className="size-5" />}>
        <p>
          For privacy questions or grievances, email <a href={`mailto:${BUSINESS.email}`}>{BUSINESS.email}</a>. Security or data-protection concerns can also go to{" "}
          <a href={`mailto:${cto.email}`}>{cto.email}</a> ({cto.name}, {cto.role}). We reply within 2 business days. See also our <Link href="/terms">Terms</Link>.
        </p>
      </Section>
    </PolicyShell>
  );
}
