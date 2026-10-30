"use client";

import clsx from "clsx";
import { Check, Crown, Rocket, Sparkles } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { api, toast } from "@/lib/api";
import { Confetti } from "../Confetti";

export interface PlanInfo { id: "free" | "pro" | "max"; name: string; price_inr: number; perks: string[]; engine: string }

declare global {
  interface Window {
    Razorpay?: new (opts: Record<string, unknown>) => { open: () => void; on: (ev: string, cb: (r: unknown) => void) => void };
  }
}

const STYLE = {
  free: { color: "bg-surface", icon: Sparkles, tag: null },
  pro: { color: "bg-pink", icon: Rocket, tag: "Most popular" },
  max: { color: "bg-yellow", icon: Crown, tag: "Best for labs" },
} as const;

function loadCheckout() {
  return new Promise<void>((ok, bad) => {
    if (window.Razorpay) { ok(); return; }
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => ok(); s.onerror = () => bad(new Error("Couldn't load the payment window"));
    document.body.appendChild(s);
  });
}

/** Opens Razorpay Checkout for a subscription; resolves true when the payment is verified by our server. */
export async function startCheckout(plan: "pro" | "max", user: { email?: string; name?: string } | null): Promise<boolean> {
  await loadCheckout();
  const { subscription_id, key_id } = await api.post<{ subscription_id: string; key_id: string }>("/api/billing/subscribe", { plan });
  return new Promise((resolve) => {
    const rzp = new window.Razorpay!({
      key: key_id, subscription_id, name: "Cite & Slayy", description: `${plan === "pro" ? "Pro" : "Max"} plan · monthly`,
      prefill: { email: user?.email ?? "", name: user?.name ?? "" }, theme: { color: "#ff4fa3" },
      handler: async (resp: { razorpay_payment_id: string; razorpay_subscription_id: string; razorpay_signature: string }) => {
        try {
          await api.post("/api/billing/verify", resp);
          resolve(true);
        } catch (e) {
          toast({ title: "Payment received but not verified yet", body: `${(e as Error).message}. It will update within a few minutes.`, tone: "crit" });
          resolve(false);
        }
      },
      modal: { ondismiss: () => resolve(false) },
    });
    rzp.on("payment.failed", () => toast({ title: "Payment failed", body: "No money was taken. Try another method.", tone: "crit" }));
    rzp.open();
  });
}

export interface PackInfo { id: "pack"; name: string; price_inr: number; perks: string[]; days: number }

/** One-time Paper Pack via Razorpay Orders. */
export async function startPackCheckout(user: { email?: string; name?: string } | null): Promise<boolean> {
  await loadCheckout();
  const o = await api.post<{ order_id: string; key_id: string; amount: number; currency: string }>("/api/billing/pack");
  return new Promise((resolve) => {
    const rzp = new window.Razorpay!({
      key: o.key_id, order_id: o.order_id, amount: o.amount, currency: o.currency, name: "Cite & Slayy",
      description: "Paper Pack · one publish-ready paper", prefill: { email: user?.email ?? "", name: user?.name ?? "" }, theme: { color: "#ff4fa3" },
      handler: async (resp: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => {
        try { await api.post("/api/billing/pack/verify", resp); resolve(true); }
        catch (e) { toast({ title: "Payment received but not verified yet", body: `${(e as Error).message}. It will update within a few minutes.`, tone: "crit" }); resolve(false); }
      },
      modal: { ondismiss: () => resolve(false) },
    });
    rzp.on("payment.failed", () => toast({ title: "Payment failed", body: "No money was taken. Try another method.", tone: "crit" }));
    rzp.open();
  });
}

function PackCard({ pack, onBuy }: { pack: PackInfo; onBuy: () => Promise<boolean> }) {
  const [busy, setBusy] = useState(false);
  const [party, setParty] = useState(0);
  return (
    <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ type: "spring", stiffness: 140 }}
      className="relative mt-10 overflow-hidden rounded-[28px] border-[3px] border-edge p-[3px] shadow-[8px_8px_0_var(--shadow-c)]">
      {party > 0 && <Confetti key={party} />}
      <motion.div className="absolute inset-[-50%] bg-[conic-gradient(var(--pink),var(--yellow),var(--lime),var(--blue),var(--violet),var(--pink))]"
        animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 8, ease: "linear" }} />
      <div className="relative grid gap-6 rounded-[24px] bg-ink p-7 text-bg md:grid-cols-[1.1fr_1fr] md:p-9">
        <div>
          <span className="sticker bg-yellow text-[#121212]">Done for you · one-time</span>
          <h3 className="mt-4 font-display text-4xl font-extrabold leading-tight md:text-5xl">One paper. <span className="gradient-text">Publish-ready.</span></h3>
          <p className="mt-3 max-w-md text-sm opacity-80">Tell us your topic, or share the papers you&apos;ve studied. Our agent team researches, writes, cites,
            draws the figures and formats it for IEEE or Springer. Then you just say what to change.</p>
          <div className="mt-6 flex items-end gap-2">
            <span className="font-display text-6xl font-extrabold tracking-tight">₹{pack.price_inr.toLocaleString("en-IN")}</span>
            <span className="mb-2 text-sm font-bold opacity-70">per paper · incl. GST</span>
          </div>
          <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.96 }} disabled={busy}
            onClick={async () => { setBusy(true); try { if (await onBuy()) setParty((n) => n + 1); } finally { setBusy(false); } }}
            className="btn-brut mt-6 inline-flex items-center gap-2 rounded-2xl bg-pink px-7 py-4 font-display text-xl font-extrabold text-[#121212]">
            <Rocket className="size-5" />{busy ? "Opening…" : "Get my paper"}
          </motion.button>
        </div>
        <ul className="space-y-2.5 self-center text-sm">
          {pack.perks.map((x, i) => (
            <motion.li key={x} initial={{ opacity: 0, x: 20 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: 0.15 + i * 0.07 }}
              className="flex gap-2.5 rounded-xl border-2 border-bg/20 bg-bg/5 px-3 py-2"><Check className="mt-0.5 size-4 shrink-0 text-lime" strokeWidth={3} />{x}</motion.li>
          ))}
        </ul>
      </div>
    </motion.div>
  );
}

export function Pricing({ current, onChoose, onBuyPack, compact }: {
  current?: string; onChoose: (plan: PlanInfo) => boolean | Promise<boolean>; onBuyPack?: () => Promise<boolean>; compact?: boolean;
}) {
  const [plans, setPlans] = useState<PlanInfo[] | null>(null);
  const [pack, setPack] = useState<PackInfo | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [party, setParty] = useState(0);
  useEffect(() => { api.get<{ plans: PlanInfo[]; pack?: PackInfo }>("/api/billing/plans").then((r) => { setPlans(r.plans); setPack(r.pack ?? null); }).catch(() => setPlans([])); }, []);
  if (!plans) return <div className="grid gap-5 md:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="shimmer h-96 rounded-3xl" />)}</div>;
  return (
    <div className="relative">
      {party > 0 && <Confetti key={party} />}
      <div className="grid gap-5 md:grid-cols-3">
        {plans.map((p, i) => {
          const st = STYLE[p.id];
          const isCur = current === p.id;
          return (
            <motion.div key={p.id} initial={{ opacity: 0, y: 30, rotate: i === 1 ? 0 : i === 0 ? -1.5 : 1.5 }} whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }} transition={{ delay: i * 0.1, type: "spring", stiffness: 160 }} whileHover={{ y: -8, rotate: i === 1 ? 0 : i === 0 ? -0.6 : 0.6 }}
              className={clsx("card relative flex flex-col p-6", st.color, p.id !== "free" && "text-[#121212]", p.id === "pro" && "md:-mt-4 md:scale-[1.03]")}>
              {st.tag && <span className="sticker absolute -top-4 right-5 bg-ink text-bg">{st.tag}</span>}
              <div className="flex items-center gap-2">
                <span className="grid size-10 place-items-center rounded-xl border-[2.5px] border-edge bg-surface text-ink"><st.icon className="size-5" /></span>
                <span className="font-display text-2xl font-extrabold">{p.name}</span>
              </div>
              <div className="mt-4 flex items-end gap-1">
                <span className="font-display text-5xl font-extrabold tracking-tight">{p.price_inr ? `₹${p.price_inr.toLocaleString("en-IN")}` : "₹0"}</span>
                <span className="mb-2 text-sm font-bold opacity-70">{p.price_inr ? "/ month" : "forever"}</span>
              </div>
              <div className="text-xs font-bold opacity-70">{p.price_inr ? "incl. GST · cancel anytime" : "no card needed"} · {p.engine}</div>
              {!compact && (
                <ul className="mt-5 flex-1 space-y-2 text-sm">
                  {p.perks.map((x) => (
                    <li key={x} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0" strokeWidth={3} />{x}</li>
                  ))}
                </ul>
              )}
              <motion.button whileTap={{ scale: 0.96 }} disabled={isCur || busy !== null || p.id === "free"}
                onClick={async () => { setBusy(p.id); try { if (await onChoose(p)) setParty((n) => n + 1); } finally { setBusy(null); } }}
                className={clsx("btn-brut mt-6 rounded-2xl px-4 py-3 font-display text-lg font-extrabold disabled:opacity-60",
                  p.id === "free" ? "bg-surface-2" : "bg-ink text-bg")}>
                {isCur ? "Your plan" : p.id === "free" ? "Included" : busy === p.id ? "Opening…" : `Get ${p.name}`}
              </motion.button>
            </motion.div>
          );
        })}
      </div>
      {pack && onBuyPack && <PackCard pack={pack} onBuy={onBuyPack} />}
      <p className="mt-5 text-center text-xs text-muted">
        Every paper comes with real, verified references, an originality and citation report, and an optional AI-use acknowledgment.
        Fair use applies to the Pro engine. Payments by Razorpay (UPI, cards, netbanking).
      </p>
    </div>
  );
}
