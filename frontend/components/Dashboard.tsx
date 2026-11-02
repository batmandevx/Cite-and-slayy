"use client";


import clsx from "clsx";
import { ArrowLeft, BookOpen, IndianRupee, Landmark, Menu, ScanSearch, Wand2, Wrench, Compass, FilePen, Gamepad2, Gavel, LayoutDashboard, NotebookPen, ShieldCheck, X, Zap } from "lucide-react";
import Link from "next/link";
import { AnimatePresence, motion, MotionConfig, useScroll, useSpring } from "motion/react";
import { useEffect, useState } from "react";
import { AuditTab } from "@/components/AuditTab";
import { DraftTab } from "@/components/DraftTab";
import { AuroraChat, AuroraLauncher, type AppLink } from "@/components/aurora/AuroraChat";
import { AuroraOrb } from "@/components/aurora/AuroraOrb";
import { ExploreTab } from "@/components/ExploreTab";
import { HomeTab, type OpenTarget } from "@/components/HomeTab";
import { LibraryTab } from "@/components/LibraryTab";
import { NotesTab } from "@/components/notes/NotesTab";
import { PaperStudioTab } from "@/components/PaperStudioTab";
import { PinBoard } from "@/components/PinBoard";
import { Sidebar, useRailWidth } from "@/components/Sidebar";
import { ToolboxTab } from "@/components/ToolboxTab";
import { AdminPaymentsTab } from "@/components/AdminPaymentsTab";
import { TurnitinTab } from "@/components/TurnitinTab";
import { VenuesTab } from "@/components/VenuesTab";
import { useAuth, usePaid } from "@/components/auth/AuthProvider";
import { AccountCard, UpgradeModal } from "@/components/billing/AccountWidgets";
import { StudioWatcher } from "@/components/StudioWatcher";
import { PlayTab } from "@/components/PlayTab";
import { Logo, LogoMark } from "@/components/Logo";
import { SlayModal } from "@/components/SlayModal";
import { Toaster } from "@/components/Toaster";
import { ThemeProvider, ThemeToggle } from "@/components/theme";
import { Badge } from "@/components/ui";
import { VerdictTab } from "@/components/VerdictTab";
import { LockedTab } from "@/components/billing/ProLock";
import { API, api, usePersistent, writePersistent } from "@/lib/api";
import type { Health } from "@/lib/types";

type Tab = "home" | "studio" | "turnitin" | "venues" | "explore" | "draft" | "audit" | "verdict" | "notes" | "library" | "toolbox" | "play" | "admin";
const VALID_TABS = new Set<string>(["home", "studio", "turnitin", "venues", "explore", "draft", "audit", "verdict", "notes", "library", "toolbox", "play", "admin"]);
const ADMIN: { id: Tab; label: string; q: string; icon: typeof Compass; color: string; badge?: string }[] = [
  { id: "admin", label: "Payments", q: "Approve UPI payments", icon: IndianRupee, color: "bg-yellow" },
];
const TABS: { id: Tab; n: number; label: string; q: string; icon: typeof Compass; color: string }[] = [
  { id: "explore", n: 1, label: "Explore gaps", q: "What should I research?", icon: Compass, color: "bg-lime" },
  { id: "draft", n: 2, label: "Draft", q: "AI drafts the paper", icon: FilePen, color: "bg-blue text-white" },
  { id: "audit", n: 3, label: "Audit", q: "Can I trust it?", icon: ShieldCheck, color: "bg-yellow" },
  { id: "verdict", n: 4, label: "Verdict", q: "Is it ready?", icon: Gavel, color: "bg-pink" },
];
const CREATE: { id: Tab; label: string; q: string; icon: typeof Compass; color: string; badge?: string }[] = [
  { id: "studio", label: "Paper Studio", q: "Topic in, full paper out", icon: Wand2, color: "bg-pink", badge: "new" },
  { id: "turnitin", label: "AI & Plag Check", q: "Turnitin report & reducer", icon: ScanSearch, color: "bg-violet text-white", badge: "pro" },
  { id: "venues", label: "Find a venue", q: "Right journal or conference", icon: Landmark, color: "bg-blue text-white", badge: "new" },
];
const WORK: { id: Tab; label: string; q: string; icon: typeof Compass; color: string; badge?: string }[] = [
  { id: "notes", label: "Notes", q: "Pages, stickies, to-dos, export", icon: NotebookPen, color: "bg-yellow" },
  { id: "library", label: "Library", q: "Trending papers, books, ideas", icon: BookOpen, color: "bg-mint" },
  { id: "toolbox", label: "Research toolbox", q: "40 trusted tools", icon: Wrench, color: "bg-lime" },
  { id: "play", label: "Arcade", q: "3D games & research games", icon: Gamepad2, color: "bg-orange" },
];

function UpgradeNudge() {
  const { me, openUpgrade } = useAuth();
  if (me && (me.is_owner || me.is_paid || me.plan !== "free")) return null;
  return (
    <motion.button onClick={() => openUpgrade()} whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }}
      className="btn-brut flex w-full items-center gap-2 rounded-2xl bg-[linear-gradient(120deg,var(--pink),var(--yellow))] px-3 py-2 text-left text-[#121212]">
      <Zap className="size-4" /><span className="flex-1 text-sm font-extrabold">Go Pro</span><span className="text-[11px] font-bold">₹6,999/mo</span>
    </motion.button>
  );
}

function StatusChips({ health, offline }: { health: Health | null; offline: boolean }) {
  const { me, config } = useAuth();
  const diag = !config?.auth_required || !!me?.is_owner;   // engine diagnostics are for founders only; users see a chip only when something is wrong
  return (
    <div className="flex flex-wrap gap-1.5">
      {offline && <Badge tone="crit">Backend offline · {API || "same origin"}</Badge>}
      {health && !health.llm.available && <Badge tone="warn">AI offline: checklist only</Badge>}
      {health && diag && (
        <>
          {health.llm.available && <Badge tone="good">Admin · AI online</Badge>}
          {health.demo_mode && <Badge tone="neutral">Admin · Draft defaults to demo</Badge>}
          {!health.s2_key && <Badge tone="neutral">Admin · Semantic Scholar key missing</Badge>}
        </>
      )}
    </div>
  );
}

function Dashboard() {
  const [tab, setTab] = usePersistent<Tab>("tab", "home");
  const { me, config: authCfg } = useAuth();
  const authCfgRequired = !!authCfg?.auth_required;
  const { paid } = usePaid();
  const PRO_TABS = new Set<Tab>(["explore", "draft", "audit", "verdict", "venues", "turnitin"]);
  const proBadges = <T extends { id: Tab; badge?: string }>(xs: T[]): T[] => (paid ? xs : xs.map((x) => (PRO_TABS.has(x.id) ? { ...x, badge: "🔒 pro" } : x)));
  const [savedName] = usePersistent<string>("displayName", "");
  const name = savedName || me?.name?.split(" ")[0] || "researcher";
  const [auroraOpen, setAuroraOpen] = useState(() => new URLSearchParams(window.location.search).get("aurora") === "1");
  const [, setStudioPaper] = usePersistent<string | null>("studioPaper", null);
  const [turnitinTarget, setTurnitinTarget] = useState<{ paperId?: string | null; documentId?: string | null }>({});
  const [gapRun, setGapRun] = usePersistent<string | null>("gapRun", null);
  const [topic, setTopic] = usePersistent<string>("topic", "Gradient-spectral rank allocation for LoRA fine-tuning under a fixed parameter budget");
  const [documentId, setDocumentId] = usePersistent<string | null>("documentId", null);
  const [auditId, setAuditId] = usePersistent<string | null>("auditId", null);
  const [reviewId, setReviewId] = usePersistent<string | null>("reviewId", null);
  const [health, setHealth] = useState<Health | null>(null);
  const [offline, setOffline] = useState(false);
  const [slayOpen, setSlayOpen] = useState(() => new URLSearchParams(window.location.search).get("slay") === "1");

  useEffect(() => {
    const load = () => api.get<Health>("/api/health").then((h) => { setHealth(h); setOffline(false); }).catch(() => setOffline(true));
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  const safeTab: Tab = VALID_TABS.has(tab) ? tab : "home";
  const go = (t: Tab) => { setTab(VALID_TABS.has(t) ? t : "home"); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const open = (t: OpenTarget | AppLink) => {
    if ("paper" in t && t.paper) setStudioPaper(t.paper);
    if (t.gap) setGapRun(t.gap);
    if (t.doc) {
      setDocumentId(t.doc);
      setAuditId(t.audit ?? null);
      setReviewId(t.review ?? null);
    } else {
      if (t.audit) setAuditId(t.audit);
      if (t.review) setReviewId(t.review);
    }
    if (t.chat) writePersistent("auroraChat", t.chat);
    if (t.notesView) writePersistent("notesView", t.notesView);
    if (t.noteId) writePersistent("notesActive", t.noteId);
    if (t.tab && VALID_TABS.has(t.tab)) go(t.tab as Tab);
  };

  // Keyboard: 1-4 switch steps, S opens "Slay it" (ignored while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable) return;
      const idx = ["1", "2", "3", "4"].indexOf(e.key);
      if (idx >= 0) { setTab(TABS[idx].id); window.scrollTo({ top: 0, behavior: "smooth" }); }
      if (e.key.toLowerCase() === "s") { e.preventDefault(); setSlayOpen(true); }
      if (e.key.toLowerCase() === "a") { e.preventDefault(); setAuroraOpen(true); }
      if (e.key.toLowerCase() === "h") { setTab("home"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setTab]);

  const current = TABS.find((t) => t.id === safeTab);
  const work = [...CREATE, ...WORK, ...ADMIN].find((t) => t.id === safeTab);
  const sbw = useRailWidth();
  const [drawer, setDrawer] = useState(false);
  const groups = [
    { id: "create", title: "Create & publish", items: proBadges(CREATE) },
    { id: "pipeline", title: "The pipeline", items: proBadges(TABS) },
    { id: "workspace", title: "Workspace", items: WORK },
    ...(me?.is_owner && authCfgRequired ? [{ id: "owner", title: "Owner", items: ADMIN }] : []),
  ];
  const goMobile = (id: Tab) => { setDrawer(false); go(id); };

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative min-h-screen overflow-x-clip" style={{ ["--sbw" as string]: `${sbw}px` }}>
        <ScrollProgress />

        {/* ---------- sidebar (desktop) ---------- */}
        <Sidebar tab={safeTab} go={(id) => go(id as Tab)} onSlay={() => setSlayOpen(true)} onAzora={() => setAuroraOpen(true)}
          groups={groups}
          footer={<><UpgradeNudge /><AccountCard /><StatusChips health={health} offline={offline} /></>} />

        {/* ---------- top bar (mobile) ---------- */}
        <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b-[2.5px] border-edge bg-surface/95 px-3 py-2.5 backdrop-blur lg:hidden">
          <div className="flex items-center gap-2">
            <button onClick={() => setDrawer(true)} aria-label="Open menu" className="grid size-10 place-items-center rounded-xl border-2 border-edge bg-surface-2"><Menu className="size-5" /></button>
            <Link href="/"><Logo compact /></Link>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setSlayOpen(true)} className="btn-brut inline-flex items-center gap-1.5 rounded-xl bg-pink px-3 py-2 font-display text-sm font-extrabold text-[#121212]">
              <Zap className="size-4" /><span className="hidden min-[400px]:inline">Slay it</span>
            </button>
            <ThemeToggle />
            <AccountCard compact />
          </div>
        </header>

        <main className="px-3 pb-44 pt-5 min-[400px]:px-4 transition-[margin] duration-300 sm:px-6 lg:ml-[var(--sbw)] lg:px-10 lg:pb-12 lg:pt-8">
          <div className="mx-auto max-w-[1280px]">
            {current && <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className={clsx("grid size-11 place-items-center rounded-2xl border-[2.5px] border-edge font-display text-lg font-extrabold shadow-[3px_3px_0_var(--shadow-c)]",
                  current.color, !current.color.includes("text-white") && "text-[#121212]")}>{current.n}</span>
                <div>
                  <div className="font-display text-xs font-extrabold uppercase tracking-widest text-muted">Step {current.n} of 4</div>
                  <div className="font-display text-xl font-extrabold">{current.label}</div>
                </div>
              </div>
              <div className="lg:hidden"><StatusChips health={health} offline={offline} /></div>
            </div>}
            {work && <div className="mb-6 flex items-center gap-3">
              <span className={clsx("grid size-11 place-items-center rounded-2xl border-[2.5px] border-edge shadow-[3px_3px_0_var(--shadow-c)]", work.color, !work.color.includes("text-white") && "text-[#121212]")}><work.icon className="size-5" /></span>
              <div>
                <div className="font-display text-xs font-extrabold uppercase tracking-widest text-muted">{CREATE.some((c) => c.id === work.id) ? "Create & publish" : "Workspace"}</div>
                <div className="font-display text-xl font-extrabold">{work.label}</div>
              </div>
            </div>}
            <AnimatePresence mode="wait">
              <motion.div key={safeTab} initial={{ opacity: 0, y: 22, rotate: -0.4 }} animate={{ opacity: 1, y: 0, rotate: 0 }}
                exit={{ opacity: 0, y: -12 }} transition={{ type: "spring", stiffness: 260, damping: 26 }}>
                {safeTab === "home" && <HomeTab onOpen={open} onSlay={() => setSlayOpen(true)} onAurora={() => setAuroraOpen(true)} />}
                {safeTab === "explore" && <LockedTab feature="scans" title="Find the gap nobody has filled yet" perks={["Cluster thousands of real papers into a live map of your field", "See rising, saturated and under-explored topics with growth numbers", "Turn any gap into grounded research questions in one click"]}><ExploreTab runId={gapRun} setRunId={setGapRun} onSendTopic={(q) => { setTopic(q); go("draft"); }} /></LockedTab>}
                {safeTab === "draft" && <LockedTab feature="drafts" title="Let the research agents draft it" perks={["Multi-agent drafting from real literature and real data", "Figures, tables and a full reference list", "Send it straight to audit and review"]}><DraftTab topic={topic} setTopic={setTopic} health={health}
                  onAudit={(id) => { setDocumentId(id); setAuditId(null); setReviewId(null); go("audit"); }} onStudio={() => go("studio")} /></LockedTab>}
                {safeTab === "audit" && <LockedTab feature="audits" title="Catch citation problems before reviewers do" perks={["Every reference checked against OpenAlex and Crossref", "Retracted papers and mismatched claims flagged", "One-click fixes for overlap hotspots"]}><AuditTab documentId={documentId} setDocumentId={(id) => { setDocumentId(id); if (id !== documentId) { setAuditId(null); setReviewId(null); } }} auditId={auditId} setAuditId={setAuditId}
                  onVerdict={() => go("verdict")}
                  onOriginality={(docId) => { setTurnitinTarget({ documentId: docId, paperId: null }); go("turnitin"); }} /></LockedTab>}
                {safeTab === "verdict" && <LockedTab feature="reviews" title="Get the verdict before peer review" perks={["Four expert reviewer personas score your paper", "Accept / revise / reject call with reasons", "A prioritised fix list you can act on today"]}><VerdictTab documentId={documentId} auditId={auditId} reviewId={reviewId} setReviewId={setReviewId}
                  health={health} goAudit={() => go("audit")} /></LockedTab>}
                {safeTab === "studio" && (
                  <PaperStudioTab
                    onPlay={() => go("play")}
                    onAudit={() => go("audit")}
                    onAuditDoc={(id) => { setDocumentId(id); setAuditId(null); setReviewId(null); go("audit"); }}
                    onOriginality={(pid) => { setTurnitinTarget({ paperId: pid, documentId: null }); go("turnitin"); }}
                  />
                )}
                {safeTab === "turnitin" && (
                  <TurnitinTab
                    initialPaperId={turnitinTarget.paperId}
                    initialDocumentId={turnitinTarget.documentId}
                    onOpenStudio={(pid) => { setStudioPaper(pid); go("studio"); }}
                  />
                )}
                {safeTab === "venues" && <LockedTab feature="venues" title="Find the right journal or conference" perks={["Ranked venues matched to your title and abstract", "Scope fit, open-access options and Microsoft CMT conferences", "Feeds straight into your submission kit"]}><VenuesTab /></LockedTab>}
                {safeTab === "toolbox" && <ToolboxTab />}
                {safeTab === "admin" && me?.is_owner && <AdminPaymentsTab />}
                {safeTab === "notes" && <NotesTab />}
                {safeTab === "library" && <LibraryTab />}
                {safeTab === "play" && <PlayTab />}
              </motion.div>
            </AnimatePresence>
            <footer className="mt-12 border-t-2 border-dashed border-line pt-5 text-xs text-muted">
              <span className="mr-2 hidden sm:inline">Shortcuts: <kbd className="rounded border-2 border-edge px-1">1</kbd>–<kbd className="rounded border-2 border-edge px-1">4</kbd> steps · <kbd className="rounded border-2 border-edge px-1">S</kbd> slay it · <kbd className="rounded border-2 border-edge px-1">A</kbd> Azora AI · <kbd className="rounded border-2 border-edge px-1">H</kbd> home ·</span>
              Data: OpenAlex, arXiv, Semantic Scholar, Crossref (incl. Retraction Watch). <a href="/support" target="_blank" rel="noopener" className="font-bold underline">Help &amp; support</a> · <a href="/about" target="_blank" rel="noopener" className="underline">About us</a>
            </footer>
          </div>
        </main>

        {/* ---------- bottom nav (mobile): 4 favourites + menu ---------- */}
        <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 gap-1 border-t-[2.5px] border-edge bg-surface/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur lg:hidden">
          {([["home", "Home", LayoutDashboard, "bg-violet text-white"], ["studio", "Paper", Wand2, "bg-pink"], ["notes", "Notes", NotebookPen, "bg-yellow"], ["play", "Arcade", Gamepad2, "bg-orange"]] as const).map(([id, label, Icon, color]) => (
            <button key={id} onClick={() => goMobile(id)}
              className={clsx("relative flex flex-col items-center gap-0.5 rounded-xl py-1.5 text-[11px] font-bold", safeTab === id ? "text-[#121212]" : "text-ink-2")}>
              {safeTab === id && <motion.span layoutId="mnav" className={clsx("absolute inset-0 rounded-xl border-2 border-edge", color)} transition={{ type: "spring", stiffness: 400, damping: 32 }} />}
              <Icon className={clsx("relative size-5", safeTab === id && color.includes("text-white") && "text-white")} />
              <span className={clsx("relative", safeTab === id && color.includes("text-white") && "text-white")}>{label}</span>
            </button>
          ))}
          <button onClick={() => setDrawer(true)} className="flex flex-col items-center gap-0.5 rounded-xl py-1.5 text-[11px] font-bold text-ink-2">
            <Menu className="size-5" />More
          </button>
        </nav>

        {/* ---------- menu drawer (mobile) ---------- */}
        <AnimatePresence>
          {drawer && (
            <>
              <motion.div className="fixed inset-0 z-[55] bg-black/40 backdrop-blur-sm lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setDrawer(false)} />
              <motion.aside className="fixed inset-y-0 left-0 z-[56] flex w-[86vw] max-w-[340px] flex-col border-r-[2.5px] border-edge bg-surface lg:hidden"
                initial={{ x: "-100%" }} animate={{ x: 0 }} exit={{ x: "-100%" }} transition={{ type: "spring", stiffness: 320, damping: 34 }}
                drag="x" dragConstraints={{ left: 0, right: 0 }} dragElastic={{ left: 0.4, right: 0 }} onDragEnd={(_, i) => { if (i.offset.x < -80) setDrawer(false); }}>
                <div className="flex items-center justify-between border-b-2 border-dashed border-line px-4 py-3">
                  <Logo compact />
                  <button onClick={() => setDrawer(false)} aria-label="Close menu" className="grid size-9 place-items-center rounded-xl border-2 border-edge"><X className="size-4" /></button>
                </div>
                <div className="flex-1 space-y-4 overflow-y-auto px-3 py-3">
                  <button onClick={() => goMobile("home")} className={clsx("flex w-full items-center gap-3 rounded-2xl border-2 px-3 py-2 text-left", safeTab === "home" ? "border-edge bg-violet text-white" : "border-transparent")}>
                    <LayoutDashboard className="size-5" /><span className="font-display font-extrabold">Home</span>
                  </button>
                  {groups.map((g) => (
                    <div key={g.id}>
                      <div className="mb-1 px-2 text-[11px] font-extrabold uppercase tracking-wider text-muted">{g.title}</div>
                      {g.items.map((it) => (
                        <button key={it.id} onClick={() => goMobile(it.id)}
                          className={clsx("flex w-full items-center gap-3 rounded-2xl border-2 px-3 py-2 text-left", safeTab === it.id ? clsx("border-edge", it.color, !it.color.includes("text-white") && "text-[#121212]") : "border-transparent hover:bg-surface-2")}>
                          <span className="grid size-9 shrink-0 place-items-center rounded-xl border-2 border-edge bg-surface text-ink"><it.icon className="size-4" /></span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5 font-display text-[15px] font-extrabold leading-tight">{it.label}
                              {"badge" in it && it.badge && <span className="rounded-full border border-edge bg-yellow px-1.5 text-[9px] font-extrabold uppercase text-[#121212]">{it.badge}</span>}</span>
                            <span className="block truncate text-xs opacity-75">{it.q}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
                <div className="space-y-2 border-t-2 border-dashed border-line p-3"><UpgradeNudge /><AccountCard /><StatusChips health={health} offline={offline} /></div>
              </motion.aside>
            </>
          )}
        </AnimatePresence>

        <SlayModal open={slayOpen} onClose={() => setSlayOpen(false)} health={health} defaultTopic={topic} defaultDocumentId={documentId}
          onOpenResult={(r, t) => {
            setDocumentId(r.document_id); setAuditId(r.audit_id); setReviewId(r.review_id);
            setSlayOpen(false); go(t);
          }} />
        {!auroraOpen && <AuroraLauncher onClick={() => setAuroraOpen(true)} />}
        <AuroraChat open={auroraOpen} onClose={() => setAuroraOpen(false)} name={name}
          onOpenLink={(l) => { open(l); if (window.innerWidth < 1024) setAuroraOpen(false); }} />
        <PinBoard screen={safeTab} />
        <UpgradeModal />
        <StudioWatcher active={safeTab === "studio"} onOpen={() => go("studio")} />
        <Toaster />
      </div>
    </MotionConfig>
  );
}

// Deep links: /app?tab=audit&doc=<id>&audit=<id>&gap=<runId>&review=<id>&slay=1
const URL_KEYS: Record<string, string> = { tab: "tab", gap: "gapRun", doc: "documentId", audit: "auditId", review: "reviewId", chat: "auroraChat" };

function seedFromUrl() {
  const params = new URLSearchParams(window.location.search);
  for (const [param, key] of Object.entries(URL_KEYS)) {
    const v = params.get(param);
    if (!v) continue;
    if (param === "tab" && !VALID_TABS.has(v)) continue;
    localStorage.setItem(`slayy:${key}`, JSON.stringify(v));
  }
}

function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 200, damping: 30, restDelta: 0.001 });
  return <motion.div className="scroll-progress" style={{ scaleX }} aria-hidden />;
}

export default function DashboardApp() {
  useState(seedFromUrl); // runs once, before children read localStorage
  return (
    <ThemeProvider>
      <Dashboard />
    </ThemeProvider>
  );
}

export { LogoMark };
