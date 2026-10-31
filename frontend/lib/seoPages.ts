// Content for the public, search-focused feature pages (/ai-research-paper-writer etc.).
// Keep every claim true to what the product does: no "undetectable", "AI-free" or "guaranteed acceptance" promises.

export interface Faq { q: string; a: string }
export interface SeoPage {
  slug: string;
  title: string;          // <title>, under ~60 characters
  description: string;    // meta description, under 160 characters
  h1: string;
  kicker: string;
  intro: string;
  steps: { t: string; d: string }[];
  features: { t: string; d: string }[];
  faqs: Faq[];
  cta: string;
}

export const SEO_PAGES: SeoPage[] = [
  {
    slug: "ai-research-paper-writer",
    title: "AI Research Paper Writer with Verified Citations",
    description: "Write a complete research paper from a topic: real, verified references, figures, equations and IEEE or Springer LaTeX, Word and PDF export.",
    h1: "AI research paper writer that cites real papers",
    kicker: "Topic in. Paper out.",
    intro:
      "Give Cite & Slayy a topic, or the papers you have already read. Azora AI's research agents search scholarly databases, plan the method, " +
      "write every section from abstract to conclusion and cite only papers that exist, each with a DOI or link you can open. " +
      "You get a draft you can edit, check and submit, formatted for IEEE or Springer.",
    steps: [
      { t: "Pick a topic", d: "Type a topic, brainstorm one with Azora AI, or upload the PDFs you have studied." },
      { t: "Agents research and write", d: "A scout finds sources, an architect designs the method, writers draft each section and a reviewer checks it." },
      { t: "Verify and export", d: "Every reference is checked against OpenAlex, Crossref, arXiv and Semantic Scholar. Export LaTeX, Word or PDF." },
    ],
    features: [
      { t: "Real references only", d: "Citations come from scholarly databases, with DOIs and retraction checks. No invented papers." },
      { t: "Figures and equations", d: "Trend charts computed from real publication data, architecture diagrams and numbered LaTeX equations." },
      { t: "Pilot experiments", d: "Small, sandboxed experiments with confusion matrices and significance tests, reported honestly as pilot results." },
      { t: "IEEE and Springer formats", d: "Download a LaTeX .zip with figures, a Word file with embedded figures, or a print-ready PDF." },
      { t: "Revise by chat", d: "Ask for changes in plain words. The agents rewrite and re-verify, and you can undo any edit." },
      { t: "Slides from your paper", d: "Turn the finished paper into a presentation deck with your results and charts." },
    ],
    faqs: [
      { q: "Does the AI make up citations?", a: "No. Every reference is a real paper pulled from OpenAlex, Crossref, arXiv or Semantic Scholar, and each one links to its source so you can check it yourself." },
      { q: "Can I submit the paper as it is?", a: "Treat it as a strong first draft. Read it, check the claims against the sources, add your own analysis and follow your institution's and the venue's rules on AI assistance." },
      { q: "Which formats can I export?", a: "IEEE or Springer LaTeX (a .zip with figures that opens in Overleaf), Word with embedded figures, and PDF." },
      { q: "Is there a free plan?", a: "Yes. The free plan includes a preview of a generated paper and a few Azora AI chats a day. Paid plans unlock full papers, exports and checks." },
    ],
    cta: "Write my paper",
  },
  {
    slug: "citation-checker",
    title: "Citation Checker: Verify References & Find Retractions",
    description: "Check every reference in your paper against real scholarly databases. Catch fake, mismatched and retracted citations before you submit.",
    h1: "Citation checker that catches fake and retracted references",
    kicker: "Cite it right.",
    intro:
      "Upload a paper or paste a reference list. Cite & Slayy looks up every citation in OpenAlex, Crossref, arXiv and Semantic Scholar, " +
      "flags references that do not exist or do not match their DOI, and checks Crossref's Retraction Watch data for retracted papers. " +
      "Each flag comes with the evidence, so you can fix it in minutes.",
    steps: [
      { t: "Upload your paper", d: "PDF, Word or pasted text. We extract the reference list automatically." },
      { t: "Every reference is looked up", d: "Titles, authors, years and DOIs are matched against several scholarly databases." },
      { t: "Fix what is flagged", d: "See which citations are missing, mismatched or retracted, with links to the correct record." },
    ],
    features: [
      { t: "Fake citation detection", d: "Finds references that cannot be matched to any real publication, a common problem with AI-written drafts." },
      { t: "Retraction alerts", d: "Checks Crossref and Retraction Watch data so you never cite a retracted paper by accident." },
      { t: "DOI and metadata match", d: "Catches wrong years, authors, venues and DOIs that point to a different paper." },
      { t: "Claim support", d: "Highlights sentences whose cited source does not appear to support the claim." },
      { t: "Evidence for every flag", d: "Each issue links to the database record we matched against." },
      { t: "Go / no-go verdict", d: "A clear, reasoned readiness verdict you can share with your supervisor." },
    ],
    faqs: [
      { q: "Which databases do you check against?", a: "OpenAlex, Crossref (including Retraction Watch data), arXiv and Semantic Scholar." },
      { q: "Can it find citations that ChatGPT made up?", a: "Yes. A reference that cannot be matched to a real publication is flagged as unverified, with the closest real matches if there are any." },
      { q: "Does it work for any citation style?", a: "It reads numbered (IEEE, Vancouver) and author-year (APA, Harvard) reference lists from PDFs, Word files or pasted text." },
    ],
    cta: "Check my citations",
  },
  {
    slug: "research-gap-finder",
    title: "Research Gap Finder: Find Underexplored Topics",
    description: "Find research gaps with real publication data: map a field, see rising, saturated and underexplored topics, and get research questions to pursue.",
    h1: "Find the research gap before you start writing",
    kicker: "Gap Radar.",
    intro:
      "Type a field or a rough idea. Gap Radar pulls hundreds of papers from OpenAlex, groups them into topic clusters and measures how fast each " +
      "one is growing and how much it is cited. You see which areas are rising, which are saturated and which are underexplored, then turn a gap into concrete research questions.",
    steps: [
      { t: "Describe your area", d: "A field, a keyword or a half-formed idea. Typos and vague terms are refined automatically." },
      { t: "See the map", d: "Topic clusters plotted by growth and citations, with a cluster-by-year heatmap." },
      { t: "Pick a gap", d: "Generate research questions for an underexplored cluster and start a paper from it." },
    ],
    features: [
      { t: "Real publication data", d: "Built from OpenAlex records, not guesses. Every cluster lists the papers behind it." },
      { t: "Rising vs saturated", d: "Growth rate and citations per year show where attention is moving." },
      { t: "Underexplored topics", d: "Spots clusters with growing interest but few papers: good places to contribute." },
      { t: "Research questions", d: "Azora AI turns a gap into specific, answerable research questions." },
      { t: "Straight into writing", d: "Send a gap to the paper writer with its sources already attached." },
      { t: "Literature review head start", d: "See the key papers in each cluster to seed your related-work section." },
    ],
    faqs: [
      { q: "How is a research gap identified?", a: "We cluster recent papers on your topic, then compare each cluster's growth in publications with its size and citation rate. Fast-growing, thinly covered clusters are flagged as underexplored." },
      { q: "How many papers does it analyse?", a: "Usually several hundred, depending on the topic. If too few papers match, the query is widened automatically." },
      { q: "Can I use it for a thesis topic?", a: "Yes. It is useful for choosing a thesis or dissertation topic and for justifying it with data in your proposal." },
    ],
    cta: "Find my research gap",
  },
  {
    slug: "plagiarism-checker",
    title: "Plagiarism & AI Writing Checker for Research Papers",
    description: "Check a research paper for copied text, close paraphrase and AI-like writing, sentence by sentence, and fix flagged lines with proper citations.",
    h1: "Plagiarism and AI writing check, line by line",
    kicker: "Originality report.",
    intro:
      "Upload your draft and Cite & Slayy compares it with the scholarly sources it cites and related literature. Copied passages, close paraphrases " +
      "and tortured phrases are highlighted sentence by sentence, alongside an AI-likeness estimate. For each flagged line you can quote and cite the source or rewrite it in your own words.",
    steps: [
      { t: "Upload your draft", d: "PDF, Word or pasted text." },
      { t: "Read the report", d: "A similarity score with every matching passage and its source, plus an AI-likeness estimate." },
      { t: "Fix flagged lines", d: "Quote and cite, or get a suggested rewrite you then edit in your own voice." },
    ],
    features: [
      { t: "Sentence-level matches", d: "See exactly which sentences overlap with which source, and the shared phrases." },
      { t: "Paraphrase detection", d: "Catches close rewording of a source, not only copy-paste." },
      { t: "Tortured phrases", d: "Flags odd synonym swaps that suggest automated paraphrasing." },
      { t: "AI-likeness estimate", d: "An indicator of machine-like writing to help you revise. It is an estimate, not proof." },
      { t: "Cite-or-rewrite fixes", d: "One click adds a proper citation; rewrites are suggestions for you to edit." },
      { t: "Report for your supervisor", d: "A clear originality summary you can share before submission." },
    ],
    faqs: [
      { q: "Is this the same as Turnitin?", a: "No. It is an independent check against scholarly sources and related literature. Your institution may still run its own tools, and results can differ." },
      { q: "Will it make my text pass AI detectors?", a: "That is not what it is for. It helps you find unoriginal or uncited text and improve your writing honestly. Follow your institution's rules on AI use." },
      { q: "Is my paper stored or shared?", a: "Your uploads are used only to run your checks and are never added to a public database. See our privacy policy." },
    ],
    cta: "Check my paper",
  },
  {
    slug: "journal-finder",
    title: "Journal Finder: Where to Publish Your Research Paper",
    description: "Find matching journals and conferences for your paper, with open access, DOAJ listing, APC and h-index details so you avoid predatory venues.",
    h1: "Find the right journal or conference for your paper",
    kicker: "Where to publish.",
    intro:
      "Paste your abstract or upload your paper. Cite & Slayy matches it to journals and conferences that publish similar work, " +
      "and shows whether each is open access, listed in DOAJ, what it charges in APCs and its h-index, so you can choose with confidence and avoid predatory venues.",
    steps: [
      { t: "Share your abstract", d: "Or upload the full paper for better matching." },
      { t: "Compare venues", d: "Ranked journals and conferences with scope fit and key facts side by side." },
      { t: "Submit with confidence", d: "Check the venue against Think. Check. Submit. and format your paper for it." },
    ],
    features: [
      { t: "Scope matching", d: "Venues ranked by how closely their published papers match yours." },
      { t: "Open access and DOAJ", d: "See which venues are open access and listed in the Directory of Open Access Journals." },
      { t: "APC and h-index", d: "Article processing charges and h-index shown up front." },
      { t: "Conference deadlines", d: "Links to calls for papers so you can plan your submission." },
      { t: "Predatory venue warning signs", d: "Pointers to Think. Check. Submit. so you can vet unfamiliar journals." },
      { t: "Format for the venue", d: "Export in IEEE or Springer style when the venue uses them." },
    ],
    faqs: [
      { q: "How are journals matched to my paper?", a: "We compare your abstract with recent papers indexed in OpenAlex and rank the venues that publish the closest work." },
      { q: "Does it show publication fees?", a: "Where the data is available, yes: APCs, open-access status and DOAJ listing are shown for each journal." },
      { q: "Can it guarantee acceptance?", a: "No tool can. It helps you shortlist venues whose scope fits your paper, which is one of the most common reasons for desk rejection." },
    ],
    cta: "Find my journal",
  },
];

export const FAQ_HOME = [
  { q: "What is Cite & Slayy?", a: "An AI research workspace that turns a topic into a complete research paper with real, verified citations, then checks citations, originality and readiness before you submit." },
  { q: "Are the citations real?", a: "Yes. Every reference comes from OpenAlex, Crossref, arXiv or Semantic Scholar and links to its source. Retracted papers are flagged." },
  { q: "Which formats can I download?", a: "IEEE or Springer LaTeX (a .zip that opens in Overleaf), Word with embedded figures, and PDF. You can also turn the paper into a slide deck." },
  { q: "Is Cite & Slayy free?", a: "There is a free plan with a paper preview and a few Azora AI chats a day. Paid plans in INR unlock full papers, exports and every check." },
  { q: "Should I disclose AI use?", a: "Yes, follow your university's and the publisher's policy. Cite & Slayy is built to help you write better, sourced research, not to hide how it was made." },
];
