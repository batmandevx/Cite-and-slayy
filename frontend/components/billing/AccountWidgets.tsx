"use client";

import clsx from "clsx";
import { Crown, KeyRound, LogOut, Settings, X, Zap } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { api, toast } from "@/lib/api";
import { useAuth, type Me } from "../auth/AuthProvider";
import { Button } from "../ui";
import { Pricing, startCheckout, startPackCheckout, type PlanInfo } from "./Pricing";

const LABEL: Record<string, string> = {
  papers: "Papers", revisions: "Revisions", reviews: "Verdicts", audits: "Audits", scans: "Field scans", drafts: "Drafts",
  integrity_scans: "AI & Plag scans", humanize_fixes: "AI & Plag rewrites",
  chats_day: "Azora messages today", assists_day: "AI assists today",
};
const PLAN_COLOR = { free: "bg-surface-2", pro: "bg-pink text-[#121212]", max: "bg-yellow text-[#121212]" };

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
            <div className="mb-6 text-center">
              <div className="text-5xl">🚀</div>
              <h2 className="mt-2 font-display text-3xl font-extrabold">{typeof upgrade === "object" ? "You've hit your plan limit" : "Upgrade your plan"}</h2>
              <p className="mx-auto mt-1 max-w-xl text-sm text-ink-2">
                {typeof upgrade === "object" ? upgrade.message : "Get full papers on the Pro engine, more revisions, verdicts and audits."}
              </p>
            </div>
            <Pricing current={me?.plan} onChoose={async (p) => { const ok = await choose(p); if (ok) closeUpgrade(); return ok; }}
              onBuyPack={async () => { const ok = await buyPack(); if (ok) closeUpgrade(); return ok; }} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function AccountCard({ compact }: { compact?: boolean }) {
  const { me, logout, openUpgrade, refresh, config } = useAuth();
  const [open, setOpen] = useState(false);
  const [ownerKey, setOwnerKey] = useState("");
  const [showKeyBox, setShowKeyBox] = useState(false);
  if (!me) return null;
  if (!config?.auth_required && compact) return null;
  const unlockOwner = async () => {
    if (!ownerKey.trim()) return;
    try {
      await api.post("/api/auth/owner-unlock", { key: ownerKey.trim() });
      await refresh();
      setOwnerKey("");
      setShowKeyBox(false);
      toast({ title: "Dev Owner Unlocked 👑", body: "Unlimited access enabled across all paid features.", tone: "good" });
    } catch (e) {
      toast({ title: "Invalid Dev Owner key", body: (e as Error).message, tone: "crit" });
    }
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
          : <span className="grid size-8 place-items-center rounded-full border-2 border-edge bg-violet font-display font-extrabold text-white">{(me.name || me.email)[0]?.toUpperCase()}</span>}
        {!compact && <span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold">{me.name || me.email}</span>
          <span className={clsx("inline-block rounded-full border-2 border-edge px-1.5 text-[10px] font-extrabold uppercase", me.is_owner ? "bg-lime text-[#121212]" : PLAN_COLOR[me.plan])}>{me.plan_name}</span></span>}
        {!compact && <Settings className="size-4 text-muted" />}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)}
            className="fixed inset-0 z-[70] grid place-items-center bg-black/40 p-4 backdrop-blur-sm">
            <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }} onClick={(e) => e.stopPropagation()}
              className="card relative w-full max-w-md p-6">
              <button onClick={() => setOpen(false)} className="absolute right-3 top-3 rounded-lg p-1 hover:bg-surface-2"><X className="size-5" /></button>
              <div className="flex items-center gap-3">
                <span className="grid size-12 place-items-center rounded-full border-[2.5px] border-edge bg-violet font-display text-xl font-extrabold text-white">{(me.name || me.email)[0]?.toUpperCase()}</span>
                <div className="min-w-0"><div className="truncate font-display text-lg font-extrabold">{me.name}</div><div className="truncate text-xs text-muted">{me.email}</div></div>
              </div>
              <div className={clsx("mt-4 flex items-center gap-2 rounded-2xl border-[2.5px] border-edge px-4 py-3", me.is_owner ? "bg-lime text-[#121212]" : PLAN_COLOR[me.plan])}>
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
              {!me.is_owner && (
                <div className="mt-3">
                  <button type="button" onClick={() => setShowKeyBox((v) => !v)} className="inline-flex items-center gap-1 text-[11px] font-bold text-muted underline hover:text-ink">
                    <KeyRound className="size-3" /> Dev / Owner access key
                  </button>
                  {showKeyBox && (
                    <div className="mt-1.5 flex gap-2">
                      <input type="password" value={ownerKey} onChange={(e) => setOwnerKey(e.target.value)} placeholder="OWNER_ACCESS_KEY…"
                        className="flex-1 rounded-xl border-2 border-edge bg-surface px-2.5 py-1 text-xs font-bold outline-none" />
                      <Button variant="blue" className="!px-3 !py-1 text-xs" onClick={unlockOwner}>Unlock</Button>
                    </div>
                  )}
                </div>
              )}
              <div className="mt-5 flex flex-wrap gap-2">
                {!me.is_owner && me.plan !== "free" && !me.cancel_at_period_end && <Button className="!py-1.5 text-xs" onClick={cancel}>Cancel subscription</Button>}
                {config?.auth_required && <Button variant="ghost" className="ml-auto !py-1.5 text-xs" onClick={logout}><LogOut className="size-3.5" />Sign out</Button>}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

export { usePackBuyer, usePlanChooser };
