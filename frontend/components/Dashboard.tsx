"use client";

import clsx from "clsx";
import { ArrowLeft, BookOpen, Wand2, Compass, FilePen, Gamepad2, Gavel, LayoutDashboard, NotebookPen, ShieldCheck, Zap } from "lucide-react";
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
import { useAuth } from "@/components/auth/AuthProvider";
import { AccountCard, UpgradeModal } from "@/components/billing/AccountWidgets";
import { StudioWatcher } from "@/components/StudioWatcher";
import { PlayTab } from "@/components/PlayTab";
import { Logo, LogoMark } from "@/components/Logo";
import { SlayModal } from "@/components/SlayModal";
import { Toaster } from "@/components/Toaster";
import { ThemeProvider, ThemeToggle } from "@/components/theme";
import { Badge } from "@/components/ui";
import { VerdictTab } from "@/components/VerdictTab";
import { API, api, usePersistent, writePersistent } from "@/lib/api";
import type { Health } from "@/lib/types";

type Tab = "home" | "studio" | "explore" | "draft" | "audit" | "verdict" | "notes" | "library" | "play";
const VALID_TABS = new Set<string>(["home", "studio", "explore", "draft", "audit", "verdict", "notes", "library", "play"]);
const TABS: { id: Tab; n: number; label: string; q: string; icon: typeof Compass; color: string }[] = [
  { id: "explore", n: 1, label: "Explore gaps", q: "What should I research?", icon: Compass, color: "bg-lime" },
  { id: "draft", n: 2, label: "Draft", q: "AI drafts the paper", icon: FilePen, color: "bg-blue text-white" },
  { id: "audit", n: 3, label: "Audit", q: "Can I trust it?", icon: ShieldCheck, color: "bg-yellow" },
  { id: "verdict", n: 4, label: "Verdict", q: "Is it ready?", icon: Gavel, color: "bg-pink" },
];
const WORK: { id: Tab; label: string; q: string; icon: typeof Compass; color: string }[] = [
  { id: "studio", label: "Paper Studio", q: "Topic in, full paper out", icon: Wand2, color: "bg-pink" },
  { id: "notes", label: "Notes", q: "Pages, stickies, to-dos, export", icon: NotebookPen, color: "bg-yellow" },
  { id: "library", label: "Library", q: "Trending papers, books, ideas", icon: BookOpen, color: "bg-mint" },
  { id: "play", label: "Arcade", q: "3D games & research games", icon: Gamepad2, color: "bg-orange" },
];

function UpgradeNudge() {
  const { me, config, openUpgrade } = useAuth();
  if (!config?.auth_required || !me || me.plan !== "free") return null;
  return (
    <motion.button onClick={() => openUpgrade()} whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }}
      className="btn-brut flex w-full items-center gap-2 rounded-2xl bg-[linear-gradient(120deg,var(--pink),var(--yellow))] px-3 py-2 text-left text-[#121212]">
      <Zap className="size-4" /><span className="flex-1 text-sm font-extrabold">Go Pro</span><span className="text-[11px] font-bold">₹2,499/mo</span>
    </motion.button>
  );
}

function StatusChips({ health, offline }: { health: Health | null; offline: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {offline && <Badge tone="crit">Backend offline · {API || "same origin"}</Badge>}
      {health && (
        <>
          <Badge tone={health.llm.available ? "good" : "warn"}>
            {health.llm.available ? "Azora engine online" : "AI offline: checklist only"}
          </Badge>
          {health.demo_mode && <Badge tone="warn">Demo mode</Badge>}
          <Badge tone={health.s2_key ? "good" : "neutral"}>{health.s2_key ? "S2 key" : "S2 unkeyed"}</Badge>
        </>
      )}
    </div>
  );
}

function Dashboard() {
  const [tab, setTab] = usePersistent<Tab>("tab", "home");
  const { me } = useAuth();
  const [savedName] = usePersistent<string>("displayName", "");
  const name = savedName || me?.name?.split(" ")[0] || "Ayush";
  const [auroraOpen, setAuroraOpen] = useState(() => new URLSearchParams(window.location.search).get("aurora") === "1");
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
  const work = WORK.find((t) => t.id === safeTab);

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative min-h-screen">
        <ScrollProgress />

        {/* ---------- sidebar (desktop) ---------- */}
        <aside className="fixed inset-y-0 left-0 z-30 hidden w-[272px] flex-col border-r-[2.5px] border-edge bg-surface lg:flex">
          <div className="border-b-[2.5px] border-edge px-5 py-5"><Logo /></div>
          <nav className="flex-1 space-y-2.5 overflow-y-auto px-4 py-5">
            <motion.button onClick={() => go("home")} whileTap={{ scale: 0.97 }}
              className={clsx("flex w-full items-center gap-3 rounded-2xl border-[2.5px] px-3 py-2.5 text-left transition-all",
                tab === "home" ? "border-edge bg-violet text-white shadow-[4px_4px_0_var(--shadow-c)]" : "border-transparent hover:border-edge hover:bg-surface-2")}>
              <span className={clsx("grid size-9 shrink-0 place-items-center rounded-xl border-2 border-edge", tab === "home" ? "bg-surface text-ink" : "bg-surface-2")}>
                <LayoutDashboard className="size-4" />
              </span>
              <span className="font-display text-[15px] font-extrabold">Home</span>
            </motion.button>
            <div className="px-1 pb-1 pt-3 font-display text-[11px] font-extrabold uppercase tracking-widest text-muted">The pipeline</div>
            {TABS.map((t) => {
              const active = tab === t.id;
              return (
                <motion.button key={t.id} onClick={() => go(t.id)} whileTap={{ scale: 0.97 }}
                  className={clsx("group flex w-full items-center gap-3 rounded-2xl border-[2.5px] px-3 py-2.5 text-left transition-all",
                    active ? clsx("border-edge shadow-[4px_4px_0_var(--shadow-c)]", t.color, !t.color.includes("text-white") && "text-[#121212]")
                      : "border-transparent hover:border-edge hover:bg-surface-2")}>
                  <span className={clsx("grid size-9 shrink-0 place-items-center rounded-xl border-2 border-edge font-display text-sm font-extrabold",
                    active ? "bg-surface text-ink" : "bg-surface-2 text-ink")}>
                    {active ? <t.icon className="size-4" /> : t.n}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-display text-[15px] font-extrabold leading-tight">{t.label}</span>
                    <span className={clsx("block truncate text-xs", active ? "opacity-80" : "text-muted")}>{t.q}</span>
                  </span>
                </motion.button>
              );
            })}
            <div className="px-1 pb-1 pt-3 font-display text-[11px] font-extrabold uppercase tracking-widest text-muted">Workspace</div>
            {WORK.map((t) => {
              const active = tab === t.id;
              return (
                <motion.button key={t.id} onClick={() => go(t.id)} whileTap={{ scale: 0.97 }} whileHover={!active ? { x: 3 } : {}}
                  className={clsx("flex w-full items-center gap-3 rounded-2xl border-[2.5px] px-3 py-2 text-left transition-all",
                    active ? clsx("border-edge text-[#121212] shadow-[4px_4px_0_var(--shadow-c)]", t.color) : "border-transparent hover:border-edge hover:bg-surface-2")}>
                  <span className={clsx("grid size-9 shrink-0 place-items-center rounded-xl border-2 border-edge", active ? "bg-surface text-ink" : "bg-surface-2")}>
                    <t.icon className="size-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-display text-[15px] font-extrabold leading-tight">{t.label}</span>
                    <span className={clsx("block truncate text-xs", active ? "opacity-80" : "text-muted")}>{t.q}</span>
                  </span>
                </motion.button>
              );
            })}
            <motion.button onClick={() => setSlayOpen(true)} whileHover={{ rotate: -1.5 }} whileTap={{ scale: 0.96 }}
              className="btn-brut mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-pink px-4 py-3.5 font-display text-lg font-extrabold text-[#121212]">
              <Zap className="size-5" /> Slay it
              <kbd className="ml-1 rounded-md border-2 border-[#121212] bg-white/70 px-1.5 text-[11px]">S</kbd>
            </motion.button>
            <p className="px-1 text-center text-[11px] text-muted">Draft → audit → verdict in one click</p>
            <motion.button onClick={() => setAuroraOpen(true)} whileTap={{ scale: 0.97 }}
              className="btn-brut mt-3 flex w-full items-center gap-3 rounded-2xl bg-surface px-3 py-2.5 text-left">
              <AuroraOrb size={34} />
              <span>
                <span className="block font-display text-[15px] font-extrabold leading-tight">Ask Azora AI</span>
                <span className="block text-xs text-muted">agent · brainstorm &amp; run tools</span>
              </span>
              <kbd className="ml-auto rounded-md border-2 border-edge px-1.5 text-[11px]">A</kbd>
            </motion.button>
          </nav>
          <div className="space-y-3 border-t-[2.5px] border-edge px-4 py-4">
            <UpgradeNudge />
            <AccountCard />
            <StatusChips health={health} offline={offline} />
            <div className="flex items-center justify-between">
              <Link href="/" className="inline-flex items-center gap-1 text-xs font-bold text-ink-2 hover:text-ink">
                <ArrowLeft className="size-3.5" /> Home
              </Link>
              <ThemeToggle />
            </div>
          </div>
        </aside>

        {/* ---------- top bar (mobile) ---------- */}
        <header className="sticky top-0 z-30 flex items-center justify-between border-b-[2.5px] border-edge bg-surface px-4 py-3 lg:hidden">
          <Link href="/"><Logo compact /></Link>
          <div className="flex items-center gap-2">
            <button onClick={() => setSlayOpen(true)} className="btn-brut inline-flex items-center gap-1.5 rounded-xl bg-pink px-3 py-2 font-display text-sm font-extrabold text-[#121212]">
              <Zap className="size-4" /> Slay it
            </button>
            <ThemeToggle />
            <AccountCard compact />
          </div>
        </header>

        <main className="px-4 pb-28 pt-6 sm:px-6 lg:ml-[272px] lg:px-10 lg:pb-12 lg:pt-8">
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
              <span className={clsx("grid size-11 place-items-center rounded-2xl border-[2.5px] border-edge text-[#121212] shadow-[3px_3px_0_var(--shadow-c)]", work.color)}><work.icon className="size-5" /></span>
              <div>
                <div className="font-display text-xs font-extrabold uppercase tracking-widest text-muted">Workspace</div>
                <div className="font-display text-xl font-extrabold">{work.label}</div>
              </div>
            </div>}
            <AnimatePresence mode="wait">
              <motion.div key={safeTab} initial={{ opacity: 0, y: 22, rotate: -0.4 }} animate={{ opacity: 1, y: 0, rotate: 0 }}
                exit={{ opacity: 0, y: -12 }} transition={{ type: "spring", stiffness: 260, damping: 26 }}>
                {safeTab === "home" && <HomeTab onOpen={open} onSlay={() => setSlayOpen(true)} onAurora={() => setAuroraOpen(true)} />}
                {safeTab === "explore" && <ExploreTab runId={gapRun} setRunId={setGapRun} onSendTopic={(q) => { setTopic(q); go("draft"); }} />}
                {safeTab === "draft" && <DraftTab topic={topic} setTopic={setTopic} health={health}
                  onAudit={(id) => { setDocumentId(id); setAuditId(null); setReviewId(null); go("audit"); }} />}
                {safeTab === "audit" && <AuditTab documentId={documentId} setDocumentId={(id) => { setDocumentId(id); if (id !== documentId) { setAuditId(null); setReviewId(null); } }} auditId={auditId} setAuditId={setAuditId}
                  onVerdict={() => go("verdict")} />}
                {safeTab === "verdict" && <VerdictTab documentId={documentId} auditId={auditId} reviewId={reviewId} setReviewId={setReviewId}
                  health={health} goAudit={() => go("audit")} />}
                {safeTab === "studio" && <PaperStudioTab onPlay={() => go("play")} onAudit={() => go("audit")} />}
                {safeTab === "notes" && <NotesTab />}
                {safeTab === "library" && <LibraryTab />}
                {safeTab === "play" && <PlayTab />}
              </motion.div>
            </AnimatePresence>
            <footer className="mt-12 border-t-2 border-dashed border-line pt-5 text-xs text-muted">
              <span className="mr-2 hidden sm:inline">Shortcuts: <kbd className="rounded border-2 border-edge px-1">1</kbd>–<kbd className="rounded border-2 border-edge px-1">4</kbd> steps · <kbd className="rounded border-2 border-edge px-1">S</kbd> slay it · <kbd className="rounded border-2 border-edge px-1">A</kbd> Azora AI · <kbd className="rounded border-2 border-edge px-1">H</kbd> home ·</span>
              Data: OpenAlex, arXiv, Semantic Scholar, Crossref (incl. Retraction Watch).
            </footer>
          </div>
        </main>

        {/* ---------- bottom nav (mobile) ---------- */}
        <nav className="fixed inset-x-0 bottom-0 z-30 flex gap-1 overflow-x-auto border-t-[2.5px] border-edge bg-surface p-2 lg:hidden">
          <button onClick={() => go("home")} className={clsx("flex min-w-16 flex-1 flex-col items-center gap-0.5 rounded-xl border-2 py-1.5 text-[11px] font-bold",
            tab === "home" ? "border-edge bg-violet text-white" : "border-transparent text-ink-2")}><LayoutDashboard className="size-4" />Home</button>
          {[...TABS, ...WORK].map((t) => (
            <button key={t.id} onClick={() => go(t.id)}
              className={clsx("flex min-w-16 flex-1 flex-col items-center gap-0.5 rounded-xl border-2 py-1.5 text-[11px] font-bold",
                tab === t.id ? clsx("border-edge", t.color, !t.color.includes("text-white") && "text-[#121212]") : "border-transparent text-ink-2")}>
              <t.icon className="size-4" />{t.label.split(" ")[0]}
            </button>
          ))}
        </nav>

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
