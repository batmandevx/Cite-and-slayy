"use client";

import clsx from "clsx";
import { Check, ClipboardCopy, RefreshCw, ShieldAlert, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { api, toast } from "@/lib/api";
import { Button, Card } from "./ui";

interface Claim {
  claim_id: string; item: string; item_name: string; amount_inr: number; amount_usd?: number; method?: string; utr: string; email: string; uid?: string | null;
  status: "pending_verification" | "approved" | "rejected"; created_at: string; decided_at?: string; note?: string;
}

/** Owner-only: confirm UPI payments against your bank app, then activate the customer's plan or Paper Pack. */
export function AdminPaymentsTab() {
  const [status, setStatus] = useState<"pending_verification" | "approved" | "rejected" | "all">("pending_verification");
  const [rows, setRows] = useState<Claim[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => {
    api.get<Claim[]>(`/api/admin/upi-claims?status=${status}`).then(setRows).catch((e: Error) => { setRows([]); toast({ title: "Couldn't load claims", body: e.message, tone: "crit" }); });
  }, [status]);
  useEffect(() => {
    let alive = true;
    api.get<Claim[]>(`/api/admin/upi-claims?status=${status}`).then((r) => alive && setRows(r)).catch(() => alive && setRows([]));
    return () => { alive = false; };
  }, [status]);
  const decide = async (c: Claim, d: "approve" | "reject") => {
    const ask = c.method === "paypal_me"
      ? `Confirm you received $${c.amount_usd} in PayPal with transaction ID ${c.utr}?`
      : `Confirm you received ₹${c.amount_inr.toLocaleString("en-IN")} with UTR ${c.utr} in your bank / UPI app?`;
    if (d === "approve" && !confirm(ask)) return;
    setBusy(c.claim_id);
    try {
      await api.post(`/api/admin/upi-claims/${c.claim_id}/${d}`, { note: "" });
      toast({ title: d === "approve" ? `Activated ${c.item_name} for ${c.email || "customer"}` : "Claim rejected", tone: d === "approve" ? "good" : "accent" });
      load();
    } catch (e) {
      toast({ title: "Action failed", body: (e as Error).message, tone: "crit" });
    } finally { setBusy(null); }
  };
  return (
    <div className="space-y-5">
      <Card className="flex flex-wrap items-center gap-3 p-5">
        <ShieldAlert className="size-7 text-pink" />
        <div className="flex-1 text-sm text-ink-2">
          <b className="text-ink">Only approve after the money shows in your bank or UPI app</b> with the same UTR and amount.
          Approving a plan activates it for 30 days; a Paper Pack adds its credits.
        </div>
        <Button className="!py-1.5 text-xs" onClick={load}><RefreshCw className="size-3.5" />Refresh</Button>
      </Card>
      <div className="flex flex-wrap gap-1.5">
        {(["pending_verification", "approved", "rejected", "all"] as const).map((s) => (
          <button key={s} onClick={() => setStatus(s)} className="relative rounded-full border-2 border-edge px-3 py-1 text-xs font-extrabold capitalize">
            {status === s && <motion.span layoutId="pay-filter" className="absolute inset-0 rounded-full bg-yellow" />}
            <span className={clsx("relative", status === s && "text-[#121212]")}>{s === "pending_verification" ? "Pending" : s}</span>
          </button>
        ))}
      </div>
      {rows === null ? <div className="shimmer h-40 rounded-2xl" /> : rows.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted">No {status === "all" ? "" : status.replace("_", " ")} claims.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          <AnimatePresence>
            {rows.map((c, i) => (
              <motion.div key={c.claim_id} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} transition={{ delay: i * 0.03 }}
                className="card p-4">
                <div className="flex items-center gap-2">
                  <span className="font-display text-2xl font-extrabold">{c.method === "paypal_me" ? `$${c.amount_usd}` : `₹${c.amount_inr.toLocaleString("en-IN")}`}</span>
                  {c.method === "paypal_me" && <span className="rounded-full border-2 border-edge bg-blue px-2 text-[11px] font-extrabold text-white">PayPal.me</span>}
                  <span className="rounded-full border-2 border-edge bg-pink px-2 text-[11px] font-extrabold text-[#121212]">{c.item_name}</span>
                  <span className={clsx("ml-auto rounded-full border-2 border-edge px-2 text-[10px] font-extrabold uppercase",
                    c.status === "approved" ? "bg-lime text-[#121212]" : c.status === "rejected" ? "bg-crit text-white" : "bg-yellow text-[#121212]")}>
                    {c.status.replace("_", " ")}</span>
                </div>
                <div className="mt-2 space-y-0.5 text-sm">
                  <div className="flex items-center gap-2"><span className="w-12 text-xs font-bold text-muted">{c.method === "paypal_me" ? "Txn" : "UTR"}</span><code className="font-mono">{c.utr}</code>
                    <button onClick={() => { navigator.clipboard.writeText(c.utr); toast({ title: "UTR copied", tone: "good" }); }} className="opacity-50 hover:opacity-100"><ClipboardCopy className="size-3.5" /></button></div>
                  <div><span className="inline-block w-12 text-xs font-bold text-muted">Email</span>{c.email || "—"}</div>
                  <div><span className="inline-block w-12 text-xs font-bold text-muted">When</span>{new Date(c.created_at).toLocaleString()}</div>
                  {!c.uid && <div className="text-xs font-bold text-crit-ink">No account attached: ask the customer to sign in and resubmit.</div>}
                </div>
                {c.status === "pending_verification" && (
                  <div className="mt-3 flex gap-2">
                    <Button variant="lime" className="!py-1.5 text-xs" loading={busy === c.claim_id} disabled={!c.uid} onClick={() => decide(c, "approve")}><Check className="size-3.5" />Approve & activate</Button>
                    <Button variant="danger" className="!py-1.5 text-xs" disabled={busy === c.claim_id} onClick={() => decide(c, "reject")}><X className="size-3.5" />Reject</Button>
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
