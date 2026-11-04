"use client";

import { track } from "@/lib/track";
import clsx from "clsx";
import { Check, CheckCircle2, Copy, Crown, ExternalLink, QrCode, Rocket, ShieldCheck, Sparkles, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { api, toast } from "@/lib/api";
import { Confetti } from "../Confetti";

export interface PlanInfo { id: "free" | "pro" | "max"; name: string; price_inr: number; perks: string[]; engine: string }
export interface PackInfo { id: "pack"; name: string; price_inr: number; perks: string[]; days: number }

interface UpiTarget {
  id: "pro" | "max" | "pack";
  name: string;
  price_inr: number;
  cadence: string;
}

const DEFAULT_UPI_ID = "8374579275@superyes";

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
  track("checkout_start");
  return new Promise((resolve) => {
    const rzp = new window.Razorpay!({
      key: key_id, subscription_id, name: "Cite & Slayy", description: `${plan === "pro" ? "Pro" : "Max"} plan · monthly`,
      prefill: { email: user?.email ?? "", name: user?.name ?? "" }, theme: { color: "#ff4fa3" },
      handler: async (resp: { razorpay_payment_id: string; razorpay_subscription_id: string; razorpay_signature: string }) => {
        try {
          await api.post("/api/billing/verify", resp);
          track("checkout_success");
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

/** One-time Paper Pack via Razorpay Orders. */
export async function startPackCheckout(user: { email?: string; name?: string } | null): Promise<boolean> {
  await loadCheckout();
  const o = await api.post<{ order_id: string; key_id: string; amount: number; currency: string }>("/api/billing/pack");
  return new Promise((resolve) => {
    const rzp = new window.Razorpay!({
      key: o.key_id, order_id: o.order_id, amount: o.amount, currency: o.currency, name: "Cite & Slayy",
      description: "Paper Pack · one publish-ready paper", prefill: { email: user?.email ?? "", name: user?.name ?? "" }, theme: { color: "#ff4fa3" },
      handler: async (resp: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => {
        try { await api.post("/api/billing/pack/verify", resp); track("pack_purchase"); resolve(true); }
        catch (e) { toast({ title: "Payment received but not verified yet", body: `${(e as Error).message}. It will update within a few minutes.`, tone: "crit" }); resolve(false); }
      },
      modal: { ondismiss: () => resolve(false) },
    });
    rzp.on("payment.failed", () => toast({ title: "Payment failed", body: "No money was taken. Try another method.", tone: "crit" }));
    rzp.open();
  });
}

function upiDeepLink(upiId: string, amount: number, label: string) {
  return `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent("Cite and Slayy")}&am=${amount}&cu=INR&tn=${encodeURIComponent(label)}`;
}

function CopyUpiPill({ upiId, dark }: { upiId: string; dark?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(upiId);
      setCopied(true);
      toast({ title: "UPI ID copied", body: upiId, tone: "good" });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "UPI ID", body: upiId, tone: "accent" });
    }
  };
  return (
    <button type="button" onClick={copy}
      className={clsx(
        "inline-flex items-center gap-2 rounded-xl border-2 px-3 py-1.5 font-mono text-xs font-bold transition-transform active:scale-95",
        dark ? "border-white/25 bg-white/10 text-[#fff5e6] hover:bg-white/20" : "border-edge bg-surface-2 text-ink hover:bg-yellow hover:text-[#121212]",
      )}>
      <span>{upiId}</span>
      {copied ? <Check className="size-3.5 text-good" strokeWidth={3} /> : <Copy className="size-3.5 opacity-75" />}
    </button>
  );
}

function UpiQrModal({ target, options, upiId, onSelect, onClose, onSubmitted }: {
  target: UpiTarget | null;
  options: UpiTarget[];
  upiId: string;
  onSelect: (t: UpiTarget) => void;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [utr, setUtr] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<{ claim_id: string; utr: string; item_name: string; amount_inr: number } | null>(null);

  if (!target) return null;

  const submitUtr = async (e: React.FormEvent) => {
    e.preventDefault();
    if (utr.trim().length < 6) {
      toast({ title: "Enter UTR / Ref No.", body: "Paste the 12-digit UPI transaction / UTR reference from your payment app.", tone: "crit" });
      return;
    }
    setSubmitting(true);
    try {
      const r = await api.post<{ claim_id: string; utr: string; item_name: string; amount_inr: number }>("/api/billing/upi-claim", {
        item: target.id,
        utr: utr.trim(),
        email: email.trim(),
      });
      track("upi_claim");
      setReceipt(r);
      onSubmitted();
      toast({ title: "Payment reference recorded 🎉", body: `Ref #${r.claim_id} logged for ${r.item_name}.`, tone: "good" });
    } catch (err) {
      toast({ title: "Couldn't save UTR", body: (err as Error).message, tone: "crit" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}
        className="fixed inset-0 z-[90] grid place-items-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm">
        <motion.div initial={{ scale: 0.92, y: 24 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.92, y: 24 }}
          onClick={(e) => e.stopPropagation()}
          className="card relative my-6 w-full max-w-2xl overflow-hidden bg-surface p-6 text-ink md:p-8">
          <button type="button" onClick={onClose} aria-label="Close payment modal"
            className="absolute right-4 top-4 rounded-xl border-2 border-edge bg-surface-2 p-1.5 hover:bg-pink hover:text-[#121212]">
            <X className="size-4" />
          </button>

          <div className="flex flex-wrap items-center gap-2">
            <span className="sticker bg-lime text-[#121212]"><QrCode className="size-3.5" /> Instant UPI QR</span>
            <span className="rounded-full border-2 border-edge bg-surface-2 px-2.5 py-0.5 text-[11px] font-bold">
              Zero gateway fee · GPay / PhonePe / Paytm / SuperMoney
            </span>
          </div>

          <h3 className="mt-3 font-display text-2xl font-extrabold md:text-3xl">
            Scan &amp; pay <span className="text-pink">₹{target.price_inr.toLocaleString("en-IN")}</span>{" "}
            <span className="text-base font-bold text-muted">for {target.name} ({target.cadence})</span>
          </h3>

          {options.length > 1 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {options.map((opt) => (
                <button key={opt.id} type="button" onClick={() => { onSelect(opt); setReceipt(null); }}
                  className={clsx(
                    "rounded-xl border-2 border-edge px-3 py-1 font-display text-xs font-extrabold transition-transform active:scale-95",
                    opt.id === target.id ? "bg-yellow text-[#121212] shadow-[2px_2px_0_var(--shadow-c)]" : "bg-surface-2 text-ink-2 hover:bg-surface",
                  )}>
                  {opt.name} · ₹{opt.price_inr.toLocaleString("en-IN")}
                </button>
              ))}
            </div>
          )}

          <div className="mt-5 grid items-center gap-6 md:grid-cols-[240px_1fr]">
            <div className="mx-auto flex flex-col items-center rounded-2xl border-[3px] border-[#121212] bg-white p-3 shadow-[5px_5px_0_var(--pink)]">
              <picture><source srcSet="/upi-qr.webp?v=1" type="image/webp" /><img src="/upi-qr.png?v=1" alt={`UPI QR for ${upiId}`} className="size-48 rounded-lg object-contain" loading="lazy" decoding="async" width={400} height={400} /></picture>
              <span className="mt-2 rounded-md bg-[#121212] px-2.5 py-0.5 font-mono text-[11px] font-bold text-[#fff5e6]">
                ₹{target.price_inr.toLocaleString("en-IN")} · INR
              </span>
            </div>

            <div className="space-y-4">
              <div>
                <div className="text-xs font-extrabold uppercase tracking-wider text-muted">UPI ID</div>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <CopyUpiPill upiId={upiId} />
                  <a href={upiDeepLink(upiId, target.price_inr, `Cite & Slayy ${target.name}`)}
                    className="btn-brut inline-flex items-center gap-1.5 rounded-xl bg-yellow px-3 py-1.5 font-display text-xs font-extrabold text-[#121212]">
                    Open UPI App <ExternalLink className="size-3.5" />
                  </a>
                </div>
              </div>

              {receipt ? (
                <div className="rounded-2xl border-[2.5px] border-edge bg-lime/25 p-4">
                  <div className="flex items-center gap-2 font-display text-base font-extrabold">
                    <CheckCircle2 className="size-5 text-good" /> UTR submitted · Ref #{receipt.claim_id}
                  </div>
                  <p className="mt-1 text-xs text-ink-2">
                    Logged UTR <b className="font-mono">{receipt.utr}</b> for <b>{receipt.item_name}</b> (₹{receipt.amount_inr.toLocaleString("en-IN")}).
                    Your upgrade will be activated right after UPI settlement verification.
                  </p>
                </div>
              ) : (
                <form onSubmit={submitUtr} className="space-y-2.5 rounded-2xl border-2 border-edge bg-surface-2 p-4">
                  <div className="flex items-center gap-1.5 font-display text-sm font-extrabold">
                    <ShieldCheck className="size-4 text-pink" /> Paid? Submit your 12-digit UTR to activate
                  </div>
                  <input type="text" required minLength={6} maxLength={40} value={utr} onChange={(e) => setUtr(e.target.value)}
                    placeholder="12-digit UPI Ref / UTR number (e.g. 430419283746)"
                    className="w-full rounded-xl border-2 border-edge bg-surface px-3 py-2 font-mono text-xs focus:outline-none" />
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                    placeholder="Your account email (optional if signed in)"
                    className="w-full rounded-xl border-2 border-edge bg-surface px-3 py-2 text-xs focus:outline-none" />
                  <button type="submit" disabled={submitting}
                    className="btn-brut w-full rounded-xl bg-pink px-4 py-2.5 font-display text-sm font-extrabold text-[#121212] disabled:opacity-60">
                    {submitting ? "Recording UTR…" : `Confirm ₹${target.price_inr.toLocaleString("en-IN")} payment`}
                  </button>
                </form>
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
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
      <div className="relative grid gap-6 rounded-[24px] bg-[#121212] p-7 text-[#fff5e6] md:grid-cols-[1.1fr_1fr] md:p-9">
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
              className="flex gap-2.5 rounded-xl border-2 border-white/15 bg-white/5 px-3 py-2"><Check className="mt-0.5 size-4 shrink-0 text-lime" strokeWidth={3} />{x}</motion.li>
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
  const [razorpay, setRazorpay] = useState(false);
  const [upiId, setUpiId] = useState(DEFAULT_UPI_ID);
  const [upiTarget, setUpiTarget] = useState<UpiTarget | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [party, setParty] = useState(0);

  useEffect(() => {
    api.get<{ plans: PlanInfo[]; pack?: PackInfo; payments?: boolean; upi_id?: string }>("/api/billing/plans")
      .then((r) => {
        setPlans(r.plans);
        setPack(r.pack ?? null);
        setRazorpay(Boolean(r.payments));
        if (r.upi_id) setUpiId(r.upi_id);
      })
      .catch(() => setPlans([]));
  }, []);

  if (!plans) return <div className="grid gap-5 md:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="shimmer h-96 rounded-3xl" />)}</div>;

  const upiOptions: UpiTarget[] = [
    ...plans.filter((p): p is PlanInfo & { id: "pro" | "max" } => p.id !== "free").map((p) => ({
      id: p.id,
      name: `${p.name} Plan`,
      price_inr: p.price_inr,
      cadence: "monthly",
    })),
    ...(pack ? [{ id: "pack" as const, name: pack.name, price_inr: pack.price_inr, cadence: "one-time · 60 days" }] : []),
  ];

  const handlePlanClick = async (p: PlanInfo): Promise<boolean> => {
    if (p.id === "free") return false;
    if (!razorpay) {
      setUpiTarget({ id: p.id, name: `${p.name} Plan`, price_inr: p.price_inr, cadence: "monthly" });
      return false;
    }
    return onChoose(p);
  };

  const handlePackClick = async (): Promise<boolean> => {
    if (!pack) return false;
    if (!razorpay) {
      setUpiTarget({ id: "pack", name: pack.name, price_inr: pack.price_inr, cadence: "one-time · 60 days" });
      return false;
    }
    return onBuyPack ? onBuyPack() : false;
  };

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
                onClick={async () => { setBusy(p.id); try { if (await handlePlanClick(p)) setParty((n) => n + 1); } finally { setBusy(null); } }}
                className={clsx("btn-brut mt-6 rounded-2xl px-4 py-3 font-display text-lg font-extrabold disabled:opacity-60",
                  p.id === "free" ? "bg-surface-2" : "bg-ink text-bg")}>
                {isCur ? "Your plan" : p.id === "free" ? "Included" : busy === p.id ? "Opening…" : !razorpay ? `Pay via UPI · ${p.name}` : `Get ${p.name}`}
              </motion.button>
            </motion.div>
          );
        })}
      </div>

      {pack && (onBuyPack || !razorpay) && <PackCard pack={pack} onBuy={handlePackClick} />}

      {!razorpay && !compact && (
        <motion.div initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
          className="card mt-8 grid items-center gap-6 bg-surface p-6 md:grid-cols-[200px_1fr] md:p-8">
          <div className="mx-auto flex flex-col items-center rounded-2xl border-[3px] border-[#121212] bg-white p-2.5 shadow-[4px_4px_0_var(--yellow)]">
            <picture><source srcSet="/upi-qr.webp?v=1" type="image/webp" /><img src="/upi-qr.png?v=1" alt={`Scan UPI QR (${upiId})`} className="size-40 rounded-lg object-contain" loading="lazy" decoding="async" width={400} height={400} /></picture>
            <span className="mt-1.5 font-mono text-[10px] font-bold text-[#121212]">Scan with any UPI app</span>
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="sticker bg-lime text-[#121212]"><QrCode className="size-3.5" /> Direct UPI Payment</span>
              <span className="text-xs font-bold text-muted">Razorpay auto-checkout coming soon · instant UPI active now</span>
            </div>
            <h4 className="mt-2.5 font-display text-2xl font-extrabold">
              Scan the QR or pay directly to <span className="text-pink">{upiId}</span>
            </h4>
            <p className="mt-1 max-w-2xl text-sm text-ink-2">
              Works with Google Pay, PhonePe, Paytm, BHIM, SuperMoney, and any bank UPI app. After paying for{" "}
              <b>Pro (₹6,999)</b>, <b>Paper Pack (₹9,999)</b>, or <b>Max (₹12,999)</b>, submit your 12-digit UTR number to activate your plan.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2.5">
              <CopyUpiPill upiId={upiId} />
              {upiOptions.map((opt) => (
                <button key={opt.id} type="button" onClick={() => setUpiTarget(opt)}
                  className="btn-brut inline-flex items-center gap-1.5 rounded-xl bg-yellow px-3.5 py-2 font-display text-xs font-extrabold text-[#121212]">
                  <QrCode className="size-3.5" /> {opt.name} · ₹{opt.price_inr.toLocaleString("en-IN")}
                </button>
              ))}
            </div>
          </div>
        </motion.div>
      )}

      <p className="mt-5 text-center text-xs text-muted">
        Every paper comes with real, verified references, an originality and citation report, and an optional AI-use acknowledgment.
        Fair use applies to the Pro engine. {razorpay ? "Payments by Razorpay (UPI, cards, netbanking)." : `Instant UPI payments active (${upiId}) · Razorpay gateway integration in progress.`}
      </p>

      <UpiQrModal
        target={upiTarget}
        options={upiOptions}
        upiId={upiId}
        onSelect={setUpiTarget}
        onClose={() => setUpiTarget(null)}
        onSubmitted={() => setParty((n) => n + 1)}
      />
    </div>
  );
}
