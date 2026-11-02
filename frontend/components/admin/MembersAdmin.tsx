"use client";

import clsx from "clsx";
import { Ban, CalendarX, Crown, RefreshCw, Search, Users } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { api, toast } from "@/lib/api";
import { Button, Card } from "../ui";

interface Member {
  uid: string; email: string; name?: string | null; plan: string; source?: "razorpay" | "upi" | null;
  renews_at?: string | null; plan_expires?: string | null; cancel_at_period_end: boolean; pack_credits: number;
  created_at?: string | null; is_founder: boolean; removed_at?: string | null;
}

const PLAN_STYLE: Record<string, string> = { max: "bg-pink", pro: "bg-lime", founder: "bg-yellow", free: "bg-surface-2" };
const day = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "");

/** Owner-only: find members and end their subscription now, or stop it renewing at the end of the paid period. */
export function MembersAdmin() {
  const [q, setQ] = useState("");
  const [show, setShow] = useState<"paid" | "all">("paid");
  const [rows, setRows] = useState<Member[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async (query: string, which: "paid" | "all") => {
    try { setRows(await api.get<Member[]>(`/api/admin/members?show=${which}&q=${encodeURIComponent(query)}`)); }
    catch (e) { setRows([]); toast({ title: "Couldn't load members", body: (e as Error).message, tone: "crit" }); }
  }, []);
  useEffect(() => {
    const t = window.setTimeout(() => { void load(q, show); }, 250);
    return () => window.clearTimeout(t);
  }, [q, show, load]);

  const remove = async (m: Member, when: "now" | "period_end") => {
    const what = when === "now"
      ? `Remove ${m.email}'s ${m.plan.toUpperCase()} plan NOW?\n\nBilling stops immediately and they drop to Free. This can't be undone (they would need to subscribe again).`
      : `Stop ${m.email}'s ${m.plan.toUpperCase()} plan from renewing?\n\nThey keep access until the end of the period they paid for, then drop to Free.`;
    if (!confirm(what)) return;
    const removePack = m.pack_credits > 0 && confirm(`Also remove their ${m.pack_credits} unused Paper Pack credits?`);
    const note = prompt("Reason (saved in the admin log, optional):", "") ?? "";
    setBusy(m.uid);
    try {
      const upd = await api.post<Member>(`/api/admin/members/${m.uid}/remove-plan`, { when, remove_pack: removePack, note });
      setRows((r) => r?.map((x) => (x.uid === m.uid ? upd : x)) ?? null);
      toast({ title: when === "now" ? `${m.email} is now on Free` : `${m.email} won't renew`, tone: "good" });
    } catch (e) {
      toast({ title: "Couldn't change the plan", body: (e as Error).message, tone: "crit" });
    } finally { setBusy(null); }
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b-[2.5px] border-edge bg-violet px-5 py-4 text-white">
        <Users className="size-7" />
        <div className="flex-1">
          <div className="font-display text-xl font-extrabold">Members &amp; subscriptions</div>
          <div className="text-xs opacity-85">Find a member and end their plan now, or stop it renewing. Founders can&apos;t be changed.</div>
        </div>
        <Button className="!py-1.5 text-xs" onClick={() => load(q, show)}><RefreshCw className="size-3.5" />Refresh</Button>
      </div>
      <div className="space-y-3 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by email or name"
              className="w-full rounded-xl border-[2.5px] border-edge bg-surface py-2 pl-9 pr-3 text-sm font-semibold outline-none" />
          </div>
          {(["paid", "all"] as const).map((s) => (
            <button key={s} onClick={() => setShow(s)}
              className={clsx("rounded-full border-2 border-edge px-3 py-1 text-xs font-extrabold", show === s ? "bg-yellow text-[#121212]" : "bg-surface")}>
              {s === "paid" ? "Paying members" : "Everyone"}
            </button>
          ))}
        </div>

        {rows === null ? <div className="shimmer h-32 rounded-2xl" /> : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">{q ? `No members match “${q}”.` : show === "paid" ? "No paying members yet." : "No members yet."}</p>
        ) : (
          <div className="space-y-2">
            <AnimatePresence initial={false}>
              {rows.map((m) => (
                <motion.div key={m.uid} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  className="flex flex-wrap items-center gap-3 rounded-2xl border-2 border-edge bg-surface p-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate font-display font-extrabold">{m.name || m.email}</span>
                      <span className={clsx("inline-flex items-center gap-0.5 rounded-full border-2 border-edge px-2 text-[10px] font-extrabold uppercase text-[#121212]", PLAN_STYLE[m.plan] ?? "bg-surface-2")}>
                        {m.is_founder && <Crown className="size-2.5" />}{m.plan}
                      </span>
                      {m.source && <span className="rounded-full border-2 border-edge bg-surface-2 px-2 text-[10px] font-extrabold uppercase">{m.source === "razorpay" ? "Razorpay" : "UPI"}</span>}
                      {m.cancel_at_period_end && <span className="rounded-full border-2 border-edge bg-warn-soft px-2 text-[10px] font-extrabold uppercase text-warn-ink">Won&apos;t renew</span>}
                      {m.pack_credits > 0 && <span className="rounded-full border-2 border-edge bg-mint px-2 text-[10px] font-extrabold uppercase text-[#121212]">Pack · {m.pack_credits} credits</span>}
                    </div>
                    <div className="mt-0.5 text-xs text-muted">
                      {m.email}
                      {m.renews_at && ` · renews ${day(m.renews_at)}`}
                      {!m.renews_at && m.plan_expires && ` · active until ${day(m.plan_expires)}`}
                      {m.created_at && ` · joined ${day(m.created_at)}`}
                      {m.removed_at && ` · plan changed by owner ${day(m.removed_at)}`}
                    </div>
                  </div>
                  {!m.is_founder && (m.plan !== "free" || m.pack_credits > 0) && (
                    <div className="flex flex-wrap gap-1.5">
                      {!m.cancel_at_period_end && m.plan !== "free" && (
                        <Button className="!py-1 text-xs" disabled={busy === m.uid} onClick={() => remove(m, "period_end")}>
                          <CalendarX className="size-3.5" />Stop renewal
                        </Button>
                      )}
                      <Button variant="primary" className="!bg-crit !py-1 text-xs !text-white" disabled={busy === m.uid} onClick={() => remove(m, "now")}>
                        <Ban className="size-3.5" />Remove now
                      </Button>
                    </div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </Card>
  );
}
