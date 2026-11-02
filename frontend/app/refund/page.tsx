import { ArrowDownUp, BadgeIndianRupee, CalendarX, CheckCircle2, Clock, CreditCard, Mail, Package, RotateCcw, Undo2, XCircle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Callout, Faq, PolicyShell, Section } from "@/components/legal/PolicyShell";
import { BUSINESS } from "@/lib/business";

export const metadata: Metadata = {
  title: "Cancellation & Refunds",
  description: "How to cancel a Cite & Slayy subscription, when you can get a refund, Paper Packs, UPI payments and how long refunds take.",
  alternates: { canonical: "/refund" },
};

const TOC = [
  ["cancel", "How to cancel"], ["after", "What happens after you cancel"], ["refunds", "When you can get a refund"], ["packs", "Paper Packs"],
  ["auto", "Automatic credit returns"], ["changes", "Upgrades & downgrades"], ["request", "How to request a refund"], ["timeline", "Refund timelines"], ["faq", "Questions"],
].map(([id, title]) => ({ id, title }));

const STEPS = [
  { t: "Open the app", d: "Sign in at citeslayy.com/app." },
  { t: "Go to Account", d: "Click your name or avatar at the bottom of the sidebar." },
  { t: "Cancel subscription", d: "Confirm. You'll see the date your plan ends." },
];

export default function Refund() {
  return (
    <PolicyShell current="/refund" eyebrow="Billing" title="Cancellation & Refund Policy" heroColor="bg-pink" icon={<RotateCcw className="size-12" />} toc={TOC}
      intro={<>Cancel in a few clicks, keep what you paid for, and get your money back when something isn&apos;t right. Here&apos;s exactly how it works.</>}
      glance={[
        { icon: <CalendarX className="size-5" />, title: "Cancel any time", text: "No calls, no forms. Your plan stays active until the period ends.", color: "bg-lime" },
        { icon: <Undo2 className="size-5" />, title: "7-day first-payment refund", text: "Full refund within 7 days if you've generated at most one paper.", color: "bg-yellow" },
        { icon: <RotateCcw className="size-5" />, title: "Failures don't cost you", text: "Failed papers and checks return to your allowance automatically.", color: "bg-mint" },
        { icon: <BadgeIndianRupee className="size-5" />, title: "Double-charged? 100% back", text: "Duplicate or wrong charges are refunded in full.", color: "bg-surface" },
      ]}>

      <Section id="cancel" n={1} title="How to cancel" icon={<CalendarX className="size-5" />}>
        <div className="grid gap-3 sm:grid-cols-3">
          {STEPS.map((s, i) => (
            <div key={s.t} className="rounded-2xl border-2 border-edge bg-surface-2 p-4">
              <span className="grid size-8 place-items-center rounded-full border-2 border-edge bg-lime font-display font-extrabold text-[#121212]">{i + 1}</span>
              <div className="mt-2 font-display font-extrabold text-ink">{s.t}</div>
              <div className="text-sm">{s.d}</div>
            </div>
          ))}
        </div>
        <p>Can&apos;t sign in? Email <a href={`mailto:${BUSINESS.email}`}>{BUSINESS.email}</a> from your registered address and we&apos;ll cancel it for you.</p>
      </Section>

      <Section id="after" n={2} title="What happens after you cancel" icon={<Clock className="size-5" />}>
        <ul>
          <li>You <b>won&apos;t be charged again</b>. Razorpay stops the subscription at the end of the current billing period.</li>
          <li>You <b>keep your paid plan and its remaining allowances</b> until that date.</li>
          <li>After it ends you move to the Free plan. Your papers, notes and exports stay in your account.</li>
          <li>You can subscribe again at any time.</li>
        </ul>
      </Section>

      <Section id="refunds" n={3} title="When you can get a refund" icon={<BadgeIndianRupee className="size-5" />}>
        <div className="not-prose overflow-x-auto">
          <table>
            <thead><tr><th>Situation</th><th>Refund</th></tr></thead>
            <tbody>
              <tr><td>Charged twice, or charged the wrong amount</td><td><CheckCircle2 className="mr-1 inline size-4 text-good" /> Full refund of the extra charge</td></tr>
              <tr><td>Within 7 days of your <b>first</b> payment, with at most one paper generated</td><td><CheckCircle2 className="mr-1 inline size-4 text-good" /> Full refund</td></tr>
              <tr><td>A paper, revision, audit or verdict failed</td><td><CheckCircle2 className="mr-1 inline size-4 text-good" /> Its use is returned to your allowance automatically</td></tr>
              <tr><td>We removed a paid feature you were using</td><td><CheckCircle2 className="mr-1 inline size-4 text-good" /> Fair, pro-rated refund</td></tr>
              <tr><td>You changed your mind after a billing period started (outside the cases above)</td><td><XCircle className="mr-1 inline size-4 text-crit" /> Not refundable, except where the law requires; cancel to stop future charges</td></tr>
              <tr><td>Account suspended for breaking the <Link href="/terms">Terms</Link></td><td><XCircle className="mr-1 inline size-4 text-crit" /> Not refundable</td></tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="packs" n={4} title="Paper Packs" icon={<Package className="size-5" />}>
        <ul>
          <li>A Paper Pack is a <b>one-time purchase</b>, not a subscription, so there&apos;s nothing to cancel and no renewal.</li>
          <li>Its allowances are added on top of your plan and stay valid for the period shown at purchase.</li>
          <li>The 7-day rule applies: if you haven&apos;t generated the pack&apos;s paper yet, ask within 7 days of buying for a full refund.</li>
        </ul>
      </Section>

      <Section id="auto" n={5} title="Automatic credit returns" icon={<RotateCcw className="size-5" />}>
        <p>
          You never pay for our failures. If a paper, revision, audit or verdict can&apos;t be completed, for example because a scholarly database is busy,
          its use goes straight back to your monthly allowance. You don&apos;t need to ask.
        </p>
      </Section>

      <Section id="changes" n={6} title="Upgrades & downgrades" icon={<ArrowDownUp className="size-5" />}>
        <ul>
          <li><b>Upgrade</b> (for example Pro to Max): the new plan starts immediately and the old subscription stops, so you&apos;re never billed for both.</li>
          <li><b>Downgrade:</b> cancel your current plan, then subscribe to the lower plan after it ends.</li>
        </ul>
      </Section>

      <Section id="request" n={7} title="How to request a refund" icon={<Mail className="size-5" />}>
        <p>Email <a href={`mailto:${BUSINESS.email}`}>{BUSINESS.email}</a> from your registered address with:</p>
        <ul>
          <li>the email address of your {BUSINESS.brand} account;</li>
          <li>your Razorpay payment ID (starts with <code>pay_</code>) or, for UPI QR payments, your 12-digit UTR;</li>
          <li>the date, amount and a short reason.</li>
        </ul>
        <Callout tone="mint">We&apos;ll confirm within 2 business days whether the refund is approved.</Callout>
      </Section>

      <Section id="timeline" n={8} title="Refund timelines" icon={<CreditCard className="size-5" />}>
        <ul>
          <li>Approved refunds are issued through Razorpay to your <b>original payment method</b>.</li>
          <li>They usually reach you in <b>5–7 business days</b>, depending on your bank, card issuer or UPI app.</li>
          <li>UPI QR payments are refunded to the UPI ID or bank account they came from.</li>
        </ul>
      </Section>

      <Section id="faq" n={9} title="Questions" icon={<CheckCircle2 className="size-5" />}>
        <div className="space-y-3">
          <Faq q="Will I lose my papers if I cancel?" open>No. Everything you created stays in your account on the Free plan.</Faq>
          <Faq q="I cancelled but was charged again">That shouldn&apos;t happen. Email us your payment ID and we&apos;ll refund the charge in full.</Faq>
          <Faq q="Can I pause instead of cancelling?">Not yet. Cancel now and subscribe again whenever you need it; your work stays saved.</Faq>
          <Faq q="Should I raise a chargeback with my bank?">Please contact us first. We resolve billing problems quickly, and chargebacks take much longer for everyone.</Faq>
        </div>
      </Section>
    </PolicyShell>
  );
}
