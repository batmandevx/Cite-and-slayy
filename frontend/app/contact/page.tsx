import { Biz, LegalPage } from "@/components/LegalPage";

export const metadata = { title: "Contact · Cite & Slayy" };

export default function Contact() {
  return (
    <LegalPage title="Contact us">
      <p><b>Operator:</b> <Biz k="operator" /></p>
      <p><b>Address:</b> <Biz k="address" /></p>
      <p><b>Email:</b> <Biz k="email" /></p>
      <p><b>Phone:</b> <Biz k="phone" /></p>
      <p><b>GSTIN:</b> <Biz k="gstin" /></p>
      <p>We reply within 2 business days.</p>
    </LegalPage>
  );
}
