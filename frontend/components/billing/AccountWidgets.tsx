"use client";

import clsx from "clsx";
import { Crown, Lock, LogOut, Pencil, Settings, X, Zap } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { api, toast } from "@/lib/api";
import { useAuth, type Me } from "../auth/AuthProvider";
import { Button } from "../ui";
import { MemberPass } from "../MemberPass";
import { TierBadge, type Tier } from "./TierBadge";
import { Pricing, startCheckout, startPackCheckout, type PlanInfo } from "./Pricing";

const LABEL: Record<string, string> = {
  papers: "Papers", revisions: "Revisions", reviews: "Verdicts", audits: "Audits", scans: "Field scans", drafts: "Drafts",
  integrity_scans: "AI & Plag scans", humanize_fixes: "AI & Plag rewrites",
  chats_day: "Azora messages today", assists_day: "AI assists today",
};
const PLAN_COLOR = { free: "bg-surface-2", pro: "bg-pink text-[#121212]", max: "bg-yellow text-[#121212]" };
const RING: Record<Tier, string> = {
  founder: "border-[#e3b341] bg-[linear-gradient(135deg,#8a6a1f,#e3b341)] shadow-[0_0_0_2px_#f6d36b55]",
  max: "border-[#7b5cff] bg-[linear-gradient(135deg,#7b5cff,#ff5fa2)]", pro: "border-edge bg-pink", pack: "border-edge bg-orange", free: "border-edge bg-violet",
};

function Meter({ k, me }: { k: string; me: Me }) {
  const used = me.usage[k] ?? 0, lim = me.limits[k] ?? 0;
  const pct = lim ? Math.min(1, used / lim) : 0;
  return (
    <div>
      <div className="flex justify-between text-[11px] font-bold"><span>{LABEL[k] ?? k}</span><span className="tabular-nums">{used}/{lim}</span></div>
      <div className="mt-0.5 h-2 overflow-hidden rounded-full border border-edge bg-surface-2">
        <motion.div className={clsx("h-full", pct >= 1 ? "bg-crit" : pct > 0.75 ? "bg-orange" : "bg-good")} initial={{ width: 0 }} animate={{ width: `${pct * 100}%` }} />
      </div>
    </div>
  );
}

function usePackBuyer() {
  const { me, refresh, config } = useAuth();
  return async (): Promise<boolean> => {
    if (!config?.payments) { toast({ title: "Payments are launching soon", body: "The Paper Pack can't be purchased on this server yet.", tone: "accent" }); return false; }
    try {
      const ok = await startPackCheckout(me);
      if (ok) { await refresh(); toast({ title: "Paper Pack added 🎉", body: "Open Paper Studio and tell us your topic.", tone: "good" }); }
      return ok;
    } catch (e) {
      toast({ title: "Couldn't start checkout", body: (e as Error).message, tone: "crit" });
      return false;
    }
  };
}

function usePlanChooser() {
  const { me, refresh, config } = useAuth();
  return async (p: PlanInfo): Promise<boolean> => {
    if (p.id === "free") return false;
    if (!config?.payments) { toast({ title: "Payments are launching soon", body: "Plans can't be purchased on this server yet.", tone: "accent" }); return false; }
    try {
      const ok = await startCheckout(p.id, me);
      if (ok) { await refresh(); toast({ title: `Welcome to ${p.name}! 🎉`, body: "Your Pro engine is active.", tone: "good" }); }
      return ok;
    } catch (e) {
      toast({ title: "Couldn't start checkout", body: (e as Error).message, tone: "crit" });
      return false;
    }
  };
}

const PITCH: Record<string, { title: string; sub: string }> = {
  exports: { title: "Your paper is ready. Take it with you.", sub: "Download submission-ready Word, LaTeX (.zip with figures) and print-perfect PDF in IEEE, Springer or plain layouts, or open it straight in Overleaf." },
  decks: { title: "Present it tomorrow.", sub: "Turn any paper into a 16-slide talk with native charts, an architecture diagram, speaker notes and six designer themes." },
  vision: { title: "Show Azora AI what you see.", sub: "Upload figures, whiteboard photos, screenshots or charts and get them read, explained and cited in context." },
  kits: { title: "Submit with confidence.", sub: "Cover letter, highlights, graphical-abstract brief, reviewer suggestions and a venue checklist, generated from your paper." },
  integrity_scans: { title: "Know before the editor does.", sub: "Line-highlighted AI and similarity reports for your own manuscript, with the sources that triggered each line." },
  humanize_fixes: { title: "Polish every flagged line.", sub: "Rewrite the passages your report flags, with a before and after score for each pass." },
  reviews: { title: "Get the verdict before peer review.", sub: "Four expert reviewer personas read your paper and give you a decision, scores and a fix list." },
  latex: { title: "Write like it's Overleaf.", sub: "See your page compile to IEEE, Springer or plain LaTeX live as you type, then open it in Overleaf with one click." },
  default: { title: "Do your best research, faster.", sub: "Full papers on the Pro engine, downloads in every format, slides, reports and an AI lab that reads images." },
};
const UNLOCKS: [string, string][] = [
  ["📄", "Publish-ready papers on the Pro engine with verified references"],
  ["⬇️", "Word, LaTeX .zip, PDF and one-click Overleaf"],
  ["🎤", "Presentation decks with charts, diagrams and 6 themes"],
  ["🔍", "AI & plagiarism reports with highlighted lines"],
  ["🧑‍⚖️", "Reviewer verdicts, submission kits and AI revisions"],
  ["🖼️", "Azora AI with image upload, voice and higher daily limits"],
];

export function UpgradeModal() {
  const { upgrade, closeUpgrade, me } = useAuth();
  const choose = usePlanChooser();
  const buyPack = usePackBuyer();
  return (
    <AnimatePresence>
      {upgrade && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={closeUpgrade}
          className="fixed inset-0 z-[80] grid place-items-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm">
          <motion.div initial={{ y: 40, scale: 0.95 }} animate={{ y: 0, scale: 1 }} exit={{ y: 40, scale: 0.95 }} onClick={(e) => e.stopPropagation()}
            className="card relative my-8 w-full max-w-5xl p-6 md:p-8">
            <button onClick={closeUpgrade} className="absolute right-4 top-4 rounded-lg p-1 hover:bg-surface-2"><X className="size-5" /></button>
            {(() => {
              const r = typeof upgrade === "object" ? upgrade : null;
              const pitch = (r && PITCH[r.feature]) || PITCH.default;
              const locked = r?.code === "paid_only";
              return (
                <div className="mb-6 grid items-center gap-6 md:grid-cols-[1.1fr_1fr]">
                  <div>
                    <span className="inline-flex items-center gap-1.5 rounded-full border-2 border-edge bg-yellow px-3 py-0.5 text-[11px] font-extrabold uppercase tracking-wider text-[#121212]">
                      <Lock className="size-3" />{locked ? "Pro feature" : r ? "Limit reached" : "Upgrade"}</span>
                    <h2 className="mt-3 font-display text-3xl font-extrabold leading-tight md:text-4xl">{pitch.title}</h2>
                    <p className="mt-2 text-sm text-ink-2">{r && !locked ? r.message : pitch.sub}</p>
                  </div>
                  <ul className="space-y-2 rounded-2xl border-[2.5px] border-edge bg-surface-2 p-4 text-sm">
                    {UNLOCKS.map(([icon, t], i) => (
                      <motion.li key={t} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.05 * i }} className="flex items-start gap-2.5">
                        <span className="text-base leading-5">{icon}</span><span>{t}</span>
                      </motion.li>
                    ))}
                  </ul>
                </div>
              );
            })()}
            <Pricing current={me?.plan} onChoose={async (p) => { const ok = await choose(p); if (ok) closeUpgrade(); return ok; }}
              onBuyPack={async () => { const ok = await buyPack(); if (ok) closeUpgrade(); return ok; }} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function SecurityPanel() {
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState("");
  const [nw, setNw] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api.post("/api/account/password", { current: cur, new: nw });
      setCur(""); setNw(""); setOpen(false);
      toast({ title: "Password changed", body: "Other devices have been signed out.", tone: "good" });
    } catch (e) { toast({ title: "Couldn't change password", body: (e as Error).message, tone: "crit" }); }
    finally { setBusy(false); }
  };
  const everywhere = async () => {
    if (!confirm("Sign out of every device, including this one?")) return;
    await api.post("/api/account/logout-all");
    window.location.href = "/app";
  };
  return (
    <div className="mt-4 rounded-2xl border-2 border-edge p-3">
      <div className="flex items-center gap-2 text-sm font-extrabold">🔐 Security
        <button onClick={() => setOpen(!open)} className="ml-auto text-xs font-bold text-pink hover:underline">{open ? "Close" : "Change password"}</button></div>
      {open && (
        <div className="mt-2 space-y-2">
          <input type="password" value={cur} onChange={(e) => setCur(e.target.value)} placeholder="Current password (leave empty if you never set one)" autoComplete="current-password"
            className="w-full rounded-xl border-2 border-edge bg-surface px-2.5 py-1.5 text-xs outline-none" />
          <input type="password" value={nw} onChange={(e) => setNw(e.target.value)} placeholder="New password (8+ letters & numbers)" autoComplete="new-password"
            className="w-full rounded-xl border-2 border-edge bg-surface px-2.5 py-1.5 text-xs outline-none" />
          <Button variant="primary" className="!px-3 !py-1 text-xs" loading={busy} disabled={nw.length < 8} onClick={save}>Save password</Button>
        </div>
      )}
      <button onClick={everywhere} className="mt-2 text-[11px] font-bold text-muted hover:text-crit-ink">Sign out of all devices</button>
    </div>
  );
}

export function AccountCard({ compact }: { compact?: boolean }) {
  const { me, logout, openUpgrade, refresh, config } = useAuth();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  if (!me) return null;
  if (!config?.auth_required && compact) return null;
  const tier: Tier = me.tier ?? (me.is_owner ? "founder" : me.plan === "max" ? "max" : me.plan === "pro" ? "pro" : "free");
  const saveName = async () => {
    try { await api.post("/api/account/profile", { name: nameDraft }); await refresh(); setEditing(false); toast({ title: "Name updated", tone: "good" }); }
    catch (e) { toast({ title: "Couldn't save your name", body: (e as Error).message, tone: "crit" }); }
  };

  const cancel = async () => {
    if (!confirm("Cancel your subscription? You keep your plan until the end of the current billing period.")) return;
    try { await api.post("/api/billing/cancel"); await refresh(); toast({ title: "Subscription cancelled", body: "You keep your plan until the period ends.", tone: "accent" }); }
    catch (e) { toast({ title: "Couldn't cancel", body: (e as Error).message, tone: "crit" }); }
  };
  return (
    <>
      <button onClick={() => setOpen(true)} className={clsx("flex w-full items-center gap-2.5 rounded-2xl border-[2.5px] border-edge bg-surface px-2.5 py-2 text-left hover:bg-surface-2", compact && "w-auto")}>
        {me.picture ? <img src={me.picture} alt="" className="size-8 rounded-full border-2 border-edge" referrerPolicy="no-referrer" /> // eslint-disable-line @next/next/no-img-element
          : <span className={clsx("grid size-8 place-items-center rounded-full border-2 font-display font-extrabold text-white", RING[tier])}>{(me.name || me.email)[0]?.toUpperCase()}</span>}
        {!compact && <span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold">{me.name || me.email}</span>
          <TierBadge tier={tier} size="xs" /></span>}
        {!compact && <Settings className="size-4 text-muted" />}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)}
            className="fixed inset-0 z-[70] grid place-items-center overflow-y-auto bg-black/40 p-3 backdrop-blur-sm sm:p-4">
            <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }} onClick={(e) => e.stopPropagation()}
              className="card relative my-6 grid w-full max-w-3xl overflow-hidden p-0 md:grid-cols-[300px_1fr]">
              <div className="relative border-b-[2.5px] border-edge bg-[radial-gradient(circle_at_50%_0%,var(--surface-2),var(--surface))] md:border-b-0 md:border-r-[2.5px]">
                <div className="absolute left-3 top-3 z-10 rounded-full border-2 border-edge bg-surface px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider">Your pass</div>
                <MemberPass tier={tier === "pack" ? "pro" : tier}
                  name={me.name || me.email.split("@")[0]} seed={me.uid} height={380} />
                {!me.is_paid && !me.is_owner && (
                  <button onClick={() => { setOpen(false); openUpgrade(); }}
                    className="absolute bottom-3 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-full border-2 border-edge bg-[linear-gradient(120deg,var(--pink),var(--yellow))] px-3 py-1 text-[11px] font-extrabold text-[#121212] shadow-[3px_3px_0_var(--shadow-c)]">
                    <Zap className="size-3.5" />Get the holographic Pro pass
                  </button>
                )}
              </div>
              <div className="relative p-5 sm:p-6">
              <button onClick={() => setOpen(false)} className="absolute right-3 top-3 rounded-lg p-1 hover:bg-surface-2"><X className="size-5" /></button>
              <div className="flex items-center gap-3">
                <span className={clsx("grid size-12 shrink-0 place-items-center rounded-full border-[3px] font-display text-xl font-extrabold text-white", RING[tier])}>{(me.name || me.email)[0]?.toUpperCase()}</span>
                <div className="min-w-0 flex-1 pr-6">
                  {editing ? (
                    <form onSubmit={(e) => { e.preventDefault(); saveName(); }} className="flex gap-1.5">
                      <input autoFocus value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} maxLength={60} placeholder="Your full name"
                        className="min-w-0 flex-1 rounded-lg border-2 border-edge bg-surface px-2 py-1 font-display text-sm font-extrabold outline-none" />
                      <button className="rounded-lg border-2 border-edge bg-lime px-2 text-xs font-extrabold text-[#121212]">Save</button>
                    </form>
                  ) : (
                    <button onClick={() => { setNameDraft(me.name || ""); setEditing(true); }} className="group flex max-w-full items-center gap-1.5 text-left" title="Edit your name">
                      <span className="truncate font-display text-lg font-extrabold">{me.name || me.email.split("@")[0]}</span>
                      <Pencil className="size-3.5 shrink-0 opacity-40 group-hover:opacity-100" />
                    </button>
                  )}
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5"><TierBadge tier={tier} /><span className="truncate text-xs text-muted">{me.email}</span></div>
                </div>
              </div>
              <div className={clsx("mt-4 flex items-center gap-2 rounded-2xl border-[2.5px] border-edge px-4 py-3", tier === "founder" ? "bg-[linear-gradient(110deg,#f6d36b,#fff2bf,#e3b341)] text-[#2a1d05]" : me.is_owner ? "bg-lime text-[#121212]" : PLAN_COLOR[me.plan])}>
                <Crown className="size-5" />
                <div className="flex-1">
                  <div className="font-display font-extrabold">{me.plan_name}</div>
                  <div className="text-xs opacity-80">{me.is_owner ? "All paid features & unlimited quotas enabled" : `${me.engine}${me.renews_at ? ` · ${me.cancel_at_period_end ? "ends" : "renews"} ${new Date(me.renews_at).toLocaleDateString()}` : ""}`}</div>
                </div>
                {!me.is_owner && me.plan !== "max" && <Button variant="primary" className="!px-3 !py-1.5 text-xs" onClick={() => { setOpen(false); openUpgrade(); }}><Zap className="size-3.5" />Upgrade</Button>}
              </div>
              {me.pack && (
                <div className="mt-3 rounded-2xl border-[2.5px] border-edge bg-ink px-4 py-2.5 text-sm text-bg">
                  <b>Paper Pack:</b> {me.pack.credits.papers ?? 0} paper · {me.pack.credits.revisions ?? 0} revisions left · until {new Date(me.pack.expires * 1000).toLocaleDateString()}
                </div>
              )}
              {!me.is_owner && (
                <div className="mt-4 space-y-2.5">
                  {["papers", "revisions", "integrity_scans", "humanize_fixes", "reviews", "audits", "chats_day"].map((k) => <Meter key={k} k={k} me={me} />)}
                  <div>
                    <div className="flex justify-between text-[11px] font-bold"><span>Fair-use AI allowance</span><span>{Math.round(me.ai_budget_used * 100)}%</span></div>
                    <div className="mt-0.5 h-2 overflow-hidden rounded-full border border-edge bg-surface-2"><motion.div className="h-full bg-violet" animate={{ width: `${me.ai_budget_used * 100}%` }} /></div>
                  </div>
                </div>
              )}
              {config?.auth_required && <SecurityPanel />}
              <div className="mt-5 flex flex-wrap gap-2">
                {!me.is_owner && me.plan !== "free" && !me.cancel_at_period_end && <Button className="!py-1.5 text-xs" onClick={cancel}>Cancel subscription</Button>}
                {config?.auth_required && <Button variant="ghost" className="ml-auto !py-1.5 text-xs" onClick={logout}><LogOut className="size-3.5" />Sign out</Button>}
              </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

export { usePackBuyer, usePlanChooser };
