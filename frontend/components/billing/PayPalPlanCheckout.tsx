"use client";

import clsx from "clsx";
import { Globe } from "lucide-react";
import { useState } from "react";
import { api, toast } from "@/lib/api";
import { PayPalButtons, usePayPalConfig } from "@/components/agentpay/PayPalButtons";
import type { PackInfo, PlanInfo } from "./Pricing";

type Item = { id: "pro" | "max" | "pack"; label: string; usd: number; note: string };

/** Outside India: buy a 30-day plan or the Paper Pack in USD with PayPal. Renders nothing if PayPal isn't configured. */
export function PayPalPlanCheckout({ plans, pack, onPaid }: { plans: PlanInfo[]; pack: PackInfo | null; onPaid: () => void }) {
  const cfg = usePayPalConfig();
  const items: Item[] = [
    ...plans.filter((p) => p.id !== "free" && p.price_usd).map((p) => ({ id: p.id as "pro" | "max", label: p.name, usd: p.price_usd ?? 0, note: "30 days, no auto-renew" })),
    ...(pack?.price_usd ? [{ id: "pack" as const, label: pack.name, usd: pack.price_usd, note: `one-time · ${pack.days} days` }] : []),
  ];
  const [pick, setPick] = useState<Item["id"]>("pro");
  if (!cfg?.enabled || !items.length) return null;
  const chosen = items.find((i) => i.id === pick) ?? items[0];

  return (
    <div className="card mt-8 grid items-center gap-6 bg-surface p-6 md:grid-cols-[1fr_320px] md:p-8">
      <div>
        <span className="sticker bg-blue text-white"><Globe className="size-3.5" /> Outside India? Pay in USD</span>
        <h4 className="mt-2.5 font-display text-2xl font-extrabold">Checkout with PayPal</h4>
        <p className="mt-1 text-sm text-ink-2">PayPal balance, cards and bank accounts in 200+ markets. Your plan switches on the moment PayPal confirms the payment.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {items.map((i) => (
            <button key={i.id} type="button" onClick={() => setPick(i.id)}
              className={clsx("btn-brut rounded-xl px-3.5 py-2 text-left font-display text-sm font-extrabold", pick === i.id ? "bg-lime text-[#121212]" : "bg-surface-2")}>
              {i.label} · ${i.usd}<span className="block text-[10px] font-bold opacity-70">{i.note}</span>
            </button>
          ))}
        </div>
      </div>
      <div>
        <PayPalButtons cfg={cfg}
          createOrder={async () => (await api.post<{ order_id: string }>("/api/billing/paypal/order", { item: chosen.id })).order_id}
          onApproved={async (id) => {
            await api.post(`/api/billing/paypal/order/${id}/capture`);
            toast({ title: `${chosen.label} is active`, body: "Paid with PayPal. Enjoy!", tone: "good" });
            onPaid();
          }}
          onError={(msg) => toast({ title: "PayPal checkout failed", body: msg, tone: "crit" })} />
        <p className="mt-2 text-center text-[11px] font-bold text-muted">${chosen.usd} USD · {chosen.note}</p>
      </div>
    </div>
  );
}
