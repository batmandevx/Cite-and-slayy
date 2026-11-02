import { AlertTriangle, Ban, BookOpenCheck, CreditCard, FileText, Gavel, Globe, Handshake, KeyRound, Scale, ScrollText, ShieldCheck, Sparkles, UserCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Callout, PolicyShell, Section } from "@/components/legal/PolicyShell";
import { BUSINESS } from "@/lib/business";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms for using Cite & Slayy, the AI research paper writer and citation checker: accounts, plans, fair use, AI content and your responsibilities.",
  alternates: { canonical: "/terms" },
};

const TOC = [
  ["agreement", "Agreeing to these terms"], ["service", "What the Service does"], ["eligibility", "Who can use it"], ["accounts", "Your account"],
  ["ai", "AI content & your responsibility"], ["integrity", "Academic integrity"], ["plans", "Plans, billing & fair use"], ["acceptable", "Acceptable use"],
  ["content", "Your content & ours"], ["thirdparty", "Third-party data & tools"], ["availability", "Availability & changes"], ["termination", "Suspension & termination"],
  ["disclaimer", "Disclaimers & liability"], ["law", "Governing law & disputes"], ["changes", "Changes to these terms"],
].map(([id, title]) => ({ id, title }));

export default function Terms() {
  return (
    <PolicyShell current="/terms" eyebrow="Legal" title="Terms of Service" heroColor="bg-mint" icon={<ScrollText className="size-12" />} toc={TOC}
      intro={<>The rules for using {BUSINESS.brand}, written in plain language. Please read them: by creating an account you agree to them.</>}
      glance={[
        { icon: <Sparkles className="size-5" />, title: "AI drafts need your review", text: "You verify and take responsibility for what you submit.", color: "bg-yellow" },
        { icon: <BookOpenCheck className="size-5" />, title: "Follow your institution's rules", text: "Disclose AI assistance where required.", color: "bg-lime" },
        { icon: <CreditCard className="size-5" />, title: "Monthly plans, cancel anytime", text: "Billed in advance in INR via Razorpay.", color: "bg-pink" },
        { icon: <ShieldCheck className="size-5" />, title: "Your work stays yours", text: "You own what you upload and the papers made for you.", color: "bg-surface" },
      ]}>

      <Section id="agreement" n={1} title="Agreeing to these terms" icon={<Handshake className="size-5" />}>
        <p>
          These Terms of Service (&ldquo;Terms&rdquo;) are an agreement between you and {BUSINESS.brand} (&ldquo;we&rdquo;, &ldquo;us&rdquo;), the team that runs the
          website <a href={BUSINESS.website}>citeslayy.com</a> and its apps (the &ldquo;Service&rdquo;). By creating an account or using the Service you agree to these Terms
          and to our <Link href="/privacy">Privacy Policy</Link> and <Link href="/refund">Cancellation &amp; Refund Policy</Link>.
        </p>
      </Section>

      <Section id="service" n={2} title="What the Service does" icon={<FileText className="size-5" />}>
        <p>{BUSINESS.brand} is an AI-assisted research workspace. Depending on your plan it can:</p>
        <ul>
          <li>find research gaps and suggest topics from real publication data;</li>
          <li>draft research papers with references drawn from public scholarly databases, plus figures, equations and small pilot experiments;</li>
          <li>check references, retractions, claim support and originality, and give a readiness verdict;</li>
          <li>export to LaTeX, Word, PDF and slides, and suggest matching journals and conferences;</li>
          <li>provide notes, a library of open-access papers and books, and an AI assistant (Azora AI).</li>
        </ul>
      </Section>

      <Section id="eligibility" n={3} title="Who can use it" icon={<UserCheck className="size-5" />}>
        <ul>
          <li>You must be at least 18, or have permission from a parent or guardian who agrees to these Terms for you.</li>
          <li>You must give accurate sign-up details and be allowed to use the Service under the laws that apply to you.</li>
        </ul>
      </Section>

      <Section id="accounts" n={4} title="Your account" icon={<KeyRound className="size-5" />}>
        <ul>
          <li>An account is for one person. Don&apos;t share it or sell access to it.</li>
          <li>Keep your password safe. You&apos;re responsible for activity on your account; tell us at once if you think someone else has used it.</li>
          <li>We may ask you to verify your email or identity to protect your account, payments or the Service.</li>
        </ul>
      </Section>

      <Section id="ai" n={5} title="AI content & your responsibility" icon={<Sparkles className="size-5" />}>
        <ul>
          <li>Drafts, summaries, checks and suggestions are produced with AI and <b>may contain mistakes</b>. You must read, verify and take responsibility for anything you submit, publish or rely on.</li>
          <li>We check references against public databases, but you should still open and confirm the sources you cite.</li>
          <li>Pilot experiments are small, illustrative runs. Results the Service did not actually produce are shown as a plan (&ldquo;to be measured&rdquo;). Never report results you have not obtained.</li>
          <li>Similarity and AI-likeness indicators are estimates to help you revise. They are not a guarantee of any score in another tool.</li>
        </ul>
      </Section>

      <Section id="integrity" n={6} title="Academic integrity" icon={<BookOpenCheck className="size-5" />}>
        <p>You are responsible for following your university&apos;s, employer&apos;s and publisher&apos;s rules on AI assistance, authorship, citation and disclosure.</p>
        <ul>
          <li>The Service can add an AI-assistance acknowledgment to your paper; keep it if your venue requires disclosure.</li>
          <li>You may not use the Service to fabricate data or results, plagiarise, or disguise how your work was produced.</li>
          <li>We do not guarantee acceptance by any journal, conference, examiner or institution.</li>
        </ul>
        <Callout tone="yellow">Use {BUSINESS.brand} to write better, well-sourced research, not to hide how it was made.</Callout>
      </Section>

      <Section id="plans" n={7} title="Plans, billing & fair use" icon={<CreditCard className="size-5" />}>
        <ul>
          <li><b>Plans.</b> The Free plan lets you try the Service with limits. Paid plans (Pro and Max) and one-time Paper Packs are described with current prices on the <Link href="/pricing">pricing page</Link>.</li>
          <li><b>Billing.</b> Subscriptions are billed monthly in advance in Indian Rupees through Razorpay and renew automatically until cancelled. Prices include GST where applicable.</li>
          <li><b>Verification.</b> Every payment is confirmed with Razorpay before your plan activates. Payments by UPI QR activate once we match your UTR reference.</li>
          <li><b>Limits and fair use.</b> Each plan has monthly allowances and a fair-use budget for AI processing. When one is used up, the related feature pauses until your next billing month or an upgrade.</li>
          <li><b>Paper Packs</b> are one-time purchases that add allowances on top of your plan and are valid for the period shown when you buy.</li>
          <li><b>Price changes.</b> We&apos;ll give at least 30 days&apos; notice by email before a price change; it applies from your next billing period.</li>
          <li><b>Cancelling and refunds</b> follow our <Link href="/refund">Cancellation &amp; Refund Policy</Link>.</li>
        </ul>
      </Section>

      <Section id="acceptable" n={8} title="Acceptable use" icon={<Ban className="size-5" />}>
        <p>You agree not to:</p>
        <ul>
          <li>fabricate data or results, plagiarise, or impersonate anyone;</li>
          <li>upload content you don&apos;t have the right to use, or anything illegal, hateful or harmful;</li>
          <li>attack, probe, scrape, overload or reverse-engineer the Service, or bypass its limits, paywalls or security;</li>
          <li>resell, share or automate access to the Service without our written permission;</li>
          <li>use the Service to build a competing product or to train other AI models.</li>
        </ul>
      </Section>

      <Section id="content" n={9} title="Your content & ours" icon={<ShieldCheck className="size-5" />}>
        <ul>
          <li><b>Yours:</b> you keep all rights to what you upload and to the papers, notes and exports generated for you.</li>
          <li><b>Licence to us:</b> you let us store and process your content only to provide, secure and support the Service for you. We don&apos;t sell it or publish it.</li>
          <li><b>Ours:</b> the Service, its software, design, brand and Azora AI belong to us. Don&apos;t copy or reuse them without permission.</li>
          <li><b>Feedback:</b> if you send ideas or suggestions, we may use them freely to improve the Service.</li>
        </ul>
      </Section>

      <Section id="thirdparty" n={10} title="Third-party data & tools" icon={<Globe className="size-5" />}>
        <p>
          Reference metadata comes from public scholarly databases (such as OpenAlex, Crossref, arXiv, Semantic Scholar and Open Library) under their
          own terms. Links to outside tools and sites (for example Overleaf, Consensus or Elicit) are provided for convenience; those services are run by others and
          their terms apply. Payments are processed by Razorpay.
        </p>
      </Section>

      <Section id="availability" n={11} title="Availability & changes" icon={<AlertTriangle className="size-5" />}>
        <p>
          We work hard to keep the Service running, but it may sometimes be slow or unavailable, for example during maintenance or when an outside database is busy.
          We may add, change or remove features. If we remove a paid feature you rely on, we&apos;ll tell you and, where fair, offer a pro-rated refund.
        </p>
      </Section>

      <Section id="termination" n={12} title="Suspension & termination" icon={<Ban className="size-5" />}>
        <ul>
          <li>You can stop using the Service and delete your account at any time (see <Link href="/about#faq">support</Link>).</li>
          <li>We may suspend or close accounts that break these Terms, abuse the Service, commit payment fraud or put other users at risk. Where reasonable, we&apos;ll warn you first.</li>
          <li>Sections about content, disclaimers, liability and governing law continue after your account ends.</li>
        </ul>
      </Section>

      <Section id="disclaimer" n={13} title="Disclaimers & liability" icon={<Scale className="size-5" />}>
        <ul>
          <li>The Service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;, without warranties of any kind, to the extent the law allows.</li>
          <li>We are not liable for indirect or consequential losses, such as lost marks, grades, publications, opportunities or data.</li>
          <li>Our total liability for any claim is limited to the fees you paid us in the three months before the claim.</li>
          <li>Nothing in these Terms limits rights you have under consumer-protection law that cannot be excluded.</li>
        </ul>
      </Section>

      <Section id="law" n={14} title="Governing law & disputes" icon={<Gavel className="size-5" />}>
        <p>
          These Terms are governed by the laws of {BUSINESS.country}. If something goes wrong, please contact us first at{" "}
          <a href={`mailto:${BUSINESS.email}`}>{BUSINESS.email}</a> so we can try to fix it. Unresolved disputes will be handled by the competent courts in {BUSINESS.country}.
        </p>
      </Section>

      <Section id="changes" n={15} title="Changes to these terms" icon={<ScrollText className="size-5" />}>
        <p>
          We may update these Terms as the Service grows. For important changes we&apos;ll email you or show a notice in the app before they take effect.
          The date at the top shows the latest version. Continuing to use the Service after a change means you accept the updated Terms.
        </p>
      </Section>
    </PolicyShell>
  );
}
