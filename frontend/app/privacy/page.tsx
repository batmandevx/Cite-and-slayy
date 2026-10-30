import { Biz, LegalPage } from "@/components/LegalPage";

export const metadata = { title: "Privacy Policy · Cite & Slayy" };

export default function Privacy() {
  return (
    <LegalPage title="Privacy Policy">
      <p><Biz k="operator" /> (“we”) runs Cite &amp; Slayy. This policy explains what we collect and why.</p>
      <h2>What we collect</h2>
      <ul>
        <li><b>Account:</b> your email, name and profile picture (from Google sign-in, if you use it).</li>
        <li><b>Your work:</b> papers you upload, papers generated for you, notes, to-dos and chats with Azora AI.</li>
        <li><b>Usage:</b> counts of features used and AI usage, to apply plan limits.</li>
        <li><b>Payments:</b> handled by Razorpay. We receive subscription and payment IDs and status, never your card or UPI details.</li>
      </ul>
      <h2>How we use it</h2>
      <p>To provide the Service, apply plan limits, prevent abuse, and contact you about your account or billing. We do not sell your data.</p>
      <h2>Processors</h2>
      <p>Your text is sent to AI model providers and to public scholarly APIs only as needed to produce your results. Data is stored on our cloud servers. Payments are processed by Razorpay.</p>
      <h2>Your data is private</h2>
      <p>Your papers, notes and chats are visible only to your account.</p>
      <h2>Retention and deletion</h2>
      <p>We keep your data while your account is active. Email <Biz k="email" /> to export or delete your account and data; we will act within 30 days, except where law requires us to keep billing records.</p>
      <h2>Cookies</h2>
      <p>We use one essential cookie to keep you signed in. No advertising cookies.</p>
      <h2>Contact</h2>
      <p>Grievance and privacy contact: <Biz k="email" />, <Biz k="address" />.</p>
    </LegalPage>
  );
}
