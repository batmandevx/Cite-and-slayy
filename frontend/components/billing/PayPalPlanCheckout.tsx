"use client";

import clsx from "clsx";
import { ExternalLink, Globe } from "lucide-react";
import { useState } from "react";
import { api, toast } from "@/lib/api";
import { PayPalButtons, usePayPalConfig } from "@/components/agentpay/PayPalButtons";
import type { PackInfo, PlanInfo } from "./Pricing";

type Item = { id: "pro" | "max" | "pack"; label: string; usd: number; note: string };

/** Outside India: buy a 30-day plan or the Paper Pack in USD with PayPal.
 *  Instant checkout when the PayPal API is configured; a PayPal.me link + owner-approved claim works either way. */
export function PayPalPlanCheckout({ plans, pack, onPaid }: { plans: PlanInfo[]; pack: PackInfo | null; onPaid: () => void }) {
  const cfg = usePayPalConfig();
  const items: Item[] = [
    ...plans.filter((p) => p.id !== "free" && p.price_usd).map((p) => ({ id: p.id as "pro" | "max", label: p.name, usd: p.price_usd ?? 0, note: "30 days, no auto-renew" })),
    ...(pack?.price_usd ? [{ id: "pack" as const, label: pack.name, usd: pack.price_usd, note: `one-time · ${pack.days} days` }] : []),
  ];
  const [pick, setPick] = useState<Item["id"]>("pro");
  const [txn, setTxn] = useState("");
  const [sending, setSending] = useState(false);
  const [claimed, setClaimed] = useState<string | null>(null);
  if (!cfg || (!cfg.enabled && !cfg.paypal_me) || !items.length) return null;
  const chosen = items.find((i) => i.id === pick) ?? items[0];
  const meLink = cfg.paypal_me ? `${cfg.paypal_me.replace(/\/$/, "")}/${chosen.usd}USD` : null;

  const claim = async () => {
    setSending(true);
    try {
      await api.post("/api/billing/paypal-me-claim", { item: chosen.id, txn_id: txn });
      setClaimed(chosen.label);
      setTxn("");
      toast({ title: "Payment submitted", body: "We'll check it in PayPal and switch your plan on, usually within a few hours.", tone: "good" });
    } catch (e) {
      toast({ title: "Couldn't submit", body: e instanceof Error ? e.message : String(e), tone: "crit" });
    } finally { setSending(false); }
  };

  return (
    <div className="card mt-8 grid items-start gap-6 bg-surface p-6 md:grid-cols-[1fr_340px] md:p-8">
      <div>
        <span className="sticker bg-blue text-white"><Globe className="size-3.5" /> Outside India? Pay in USD</span>
        <h4 className="mt-2.5 font-display text-2xl font-extrabold">Pay with PayPal</h4>
        <p className="mt-1 text-sm text-ink-2">PayPal balance, cards and bank accounts in 200+ markets.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {items.map((i) => (
            <button key={i.id} type="button" onClick={() => setPick(i.id)}
              className={clsx("btn-brut rounded-xl px-3.5 py-2 text-left font-display text-sm font-extrabold", pick === i.id ? "bg-lime text-[#121212]" : "bg-surface-2")}>
              {i.label} · ${i.usd}<span className="block text-[10px] font-bold opacity-70">{i.note}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-4">
        {cfg.enabled && (
          <div>
            <PayPalButtons cfg={cfg}
              createOrder={async () => (await api.post<{ order_id: string }>("/api/billing/paypal/order", { item: chosen.id })).order_id}
              onApproved={async (id) => {
                await api.post(`/api/billing/paypal/order/${id}/capture`);
                toast({ title: `${chosen.label} is active`, body: "Paid with PayPal. Enjoy!", tone: "good" });
                onPaid();
              }}
              onError={(msg) => toast({ title: "PayPal checkout failed", body: msg, tone: "crit" })} />
            <p className="mt-1 text-center text-[11px] font-bold text-muted">${chosen.usd} USD · activates instantly</p>
          </div>
        )}
        {meLink && (
          <div className={clsx(cfg.enabled && "border-t-2 border-edge/20 pt-4")}>
            <a href={meLink} target="_blank" rel="noopener noreferrer"
              className="btn-brut flex items-center justify-center gap-2 rounded-xl bg-[#ffc439] px-4 py-3 font-display text-base font-extrabold text-[#121212]">
              {cfg.enabled ? "Or pay" : "Pay"} ${chosen.usd} via PayPal.me <ExternalLink className="size-4" />
            </a>
            <p className="mt-2 text-xs text-ink-2">After paying, paste the <b>transaction ID</b> from your PayPal receipt. We switch your plan on once we see the payment.</p>
            <div className="mt-2 flex gap-2">
              <input value={txn} onChange={(e) => setTxn(e.target.value)} placeholder="e.g. 5TY05013RG002845M" maxLength={40}
                className="min-w-0 flex-1 rounded-xl border-2 border-edge bg-surface px-3 py-2 font-mono text-xs focus:outline-none" />
              <button type="button" disabled={sending || txn.trim().length < 12} onClick={claim}
                className="btn-brut rounded-xl bg-ink px-3 py-2 font-display text-xs font-extrabold text-bg disabled:opacity-50">
                {sending ? "Sending…" : "Submit"}
              </button>
            </div>
            {claimed && <p className="mt-2 text-xs font-bold text-good">{claimed} payment submitted for review.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
