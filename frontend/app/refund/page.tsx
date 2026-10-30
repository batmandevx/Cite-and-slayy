import { Biz, LegalPage } from "@/components/LegalPage";

export const metadata = { title: "Cancellation & Refunds · Cite & Slayy" };

export default function Refund() {
  return (
    <LegalPage title="Cancellation & Refund Policy">
      <h2>Cancelling</h2>
      <p>Cancel any time from <b>Account → Cancel subscription</b>. You keep your plan until the end of the period you paid for, and you won&apos;t be charged again.</p>
      <h2>Refunds</h2>
      <ul>
        <li><b>Failed generations:</b> if a paper, revision, audit or verdict fails, its use is returned to your monthly allowance automatically.</li>
        <li><b>Duplicate or wrong charges:</b> refunded in full. Email <Biz k="email" /> with your payment ID; refunds reach your original payment method in 5–7 business days.</li>
        <li><b>Within 7 days of your first payment:</b> if you generated no more than one paper, you can ask for a full refund.</li>
        <li>Otherwise, payments for a billing period that has started are not refundable, except where required by law.</li>
      </ul>
      <h2>Plan changes</h2>
      <p>Upgrading starts the new plan immediately and stops the old subscription. Downgrades take effect when you cancel and re-subscribe.</p>
      <p>Questions: <Biz k="email" /> · <Biz k="phone" /></p>
    </LegalPage>
  );
}
