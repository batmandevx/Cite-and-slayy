"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { AuthProvider, useAuth } from "@/components/auth/AuthProvider";
import { Pricing } from "@/components/billing/Pricing";
import { usePackBuyer, usePlanChooser } from "@/components/billing/AccountWidgets";
import { Logo } from "@/components/Logo";
import { Toaster } from "@/components/Toaster";

const subscribe = () => () => {};

function Inner() {
  const { me } = useAuth();
  const choose = usePlanChooser();
  const buyPack = usePackBuyer();
  return (
    <main className="mx-auto max-w-6xl px-5 py-10">
      <div className="flex items-center justify-between"><Link href="/"><Logo /></Link><Link href="/app" className="btn-brut rounded-xl bg-surface px-4 py-2 font-display font-extrabold">Open app</Link></div>
      <div className="my-10 text-center">
        <h1 className="font-display text-5xl font-extrabold">Pick your plan</h1>
        <p className="mx-auto mt-2 max-w-xl text-ink-2">From topic to a fully referenced, export-ready research paper. Start free, upgrade when you need the Pro engine.</p>
      </div>
      <Pricing current={me?.plan} onChoose={async (p) => {
        if (!me) { window.location.href = "/app"; return false; }
        return choose(p);
      }} onBuyPack={async () => { if (!me) { window.location.href = "/app"; return false; } return buyPack(); }} />
      <Toaster />
    </main>
  );
}

export default function PricingPage() {
  const isClient = useSyncExternalStore(subscribe, () => true, () => false);
  if (!isClient) return null;
  return <AuthProvider><Inner /></AuthProvider>;
}
