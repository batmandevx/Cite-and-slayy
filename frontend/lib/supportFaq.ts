// Help-centre questions, grouped by topic. Plain text answers (also used for search-engine FAQ markup).

export type FaqTopic = "account" | "payments" | "papers" | "checks" | "privacy";

export const TOPICS: { id: FaqTopic; label: string; emoji: string; color: string }[] = [
  { id: "account", label: "Account & sign-in", emoji: "👤", color: "bg-lime" },
  { id: "payments", label: "Plans & payments", emoji: "💳", color: "bg-yellow" },
  { id: "papers", label: "Papers & exports", emoji: "📄", color: "bg-mint" },
  { id: "checks", label: "Citations & checks", emoji: "🔍", color: "bg-pink" },
  { id: "privacy", label: "Privacy & data", emoji: "🔒", color: "bg-orange" },
];

export const FAQS: { topic: FaqTopic; q: string; a: string }[] = [
  { topic: "account", q: "How do I create an account?", a: "Open citeslayy.com/app and sign up with your email and a password. Everyone needs their own account; one person per account." },
  { topic: "account", q: "I forgot my password", a: "Email support from your account's email address and we'll reset it for you, usually the same day." },
  { topic: "account", q: "How do I change my display name?", a: "Click your name at the bottom of the sidebar to open your profile, then click the name to edit it." },
  { topic: "account", q: "How do I delete my account?", a: "Email support from your registered address. We delete your account and data within 30 days, except billing records the law requires us to keep." },

  { topic: "payments", q: "I paid but my plan didn't update", a: "Card and UPI checkout payments are confirmed automatically with Razorpay, usually within a minute. For UPI QR payments, your plan activates once we match your 12-digit UTR. Still nothing? Email us your payment ID or UTR." },
  { topic: "payments", q: "What's the difference between Free, Pro and Max?", a: "Free lets you try the app with a paper preview and a few Azora AI chats a day. Pro and Max unlock full papers, exports, checks, decks and more, with larger monthly allowances on Max. See the pricing page for details." },
  { topic: "payments", q: "What is a Paper Pack?", a: "A one-time purchase that adds a finished paper and extra revisions, checks and decks on top of any plan, valid for the period shown when you buy." },
  { topic: "payments", q: "How do I cancel my subscription?", a: "Open your profile from the sidebar and choose Cancel subscription. You keep your plan until the end of the period you paid for and won't be charged again." },
  { topic: "payments", q: "Can I get a refund?", a: "Yes in several cases: duplicate or wrong charges, and within 7 days of your first payment if you've generated at most one paper. Failed papers and checks are returned to your allowance automatically. See the refund policy." },
  { topic: "payments", q: "Do prices include GST?", a: "Yes, prices shown in INR include GST where applicable." },

  { topic: "papers", q: "How long does a paper take?", a: "Most papers are ready in a few minutes. Longer monographs with experiments and figures can take longer; you can keep using the app (or play in the Arcade) while it works." },
  { topic: "papers", q: "Which formats can I download?", a: "IEEE or Springer LaTeX as a .zip that opens in Overleaf, Word with embedded figures, and PDF. Paid plans can also turn a paper into a slide deck." },
  { topic: "papers", q: "A paper failed. Do I lose a credit?", a: "No. If a paper, revision, audit or verdict fails, its use goes back to your monthly allowance automatically. Try again in a few minutes." },
  { topic: "papers", q: "Can I submit the generated paper as my own?", a: "Treat it as a strong first draft: check claims against the sources, add your own analysis, and follow your university's and the publisher's rules on AI assistance and disclosure." },
  { topic: "papers", q: "Can I use my own papers as sources?", a: "Yes. Upload the PDFs you've studied and the agents will read and cite them alongside what they find." },

  { topic: "checks", q: "Are the citations real?", a: "Yes. References come from OpenAlex, Crossref, arXiv and Semantic Scholar, each with a DOI or link you can open, and retracted papers are flagged." },
  { topic: "checks", q: "Is the plagiarism check the same as Turnitin?", a: "No. It is an independent check against the scholarly sources and related literature. Your institution may run its own tools, and results can differ." },
  { topic: "checks", q: "What does the AI-likeness score mean?", a: "It is an estimate of machine-like writing to help you revise. It is not proof either way, and it is not designed to help anyone hide AI use." },
  { topic: "checks", q: "I found a wrong or missing citation", a: "Send us the paper title and a screenshot. We fix reference issues quickly and use reports to improve the checks." },

  { topic: "privacy", q: "Who can see my papers?", a: "Only you. Your papers, notes and chats are tied to your account and hidden from everyone else." },
  { topic: "privacy", q: "Do you sell my data?", a: "Never. We don't sell data and we don't show ads." },
  { topic: "privacy", q: "Is my uploaded paper added to a database?", a: "No. Uploads are used only to run your checks and features, never added to a public or shared database." },
  { topic: "privacy", q: "Where can I report a security issue?", a: "Please email ayush@citeslayy.com privately before sharing it anywhere. We take every report seriously." },
];
