"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

type PayPalNS = {
  Buttons: (opts: {
    style?: Record<string, unknown>;
    createOrder: () => Promise<string>;
    onApprove: (data: { orderID: string }) => Promise<void>;
    onCancel?: () => void;
    onError?: (err: unknown) => void;
  }) => { render: (el: HTMLElement) => Promise<void>; close?: () => void };
};
declare global {
  interface Window { paypal?: PayPalNS }
}

export type PayPalConfig = { enabled: boolean; client_id: string | null; env: string; currency: string; paypal_me?: string | null };

let sdk: Promise<void> | null = null;
function loadSdk(clientId: string, currency: string): Promise<void> {
  if (window.paypal) return Promise.resolve();
  sdk ??= new Promise((ok, fail) => {
    const s = document.createElement("script");
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=${currency}&intent=capture&components=buttons`;
    s.onload = () => ok();
    s.onerror = () => { sdk = null; fail(new Error("PayPal could not load")); };
    document.body.appendChild(s);
  });
  return sdk;
}

export function usePayPalConfig() {
  const [cfg, setCfg] = useState<PayPalConfig | null>(null);
  useEffect(() => { api.get<PayPalConfig>("/api/paypal/config").then(setCfg).catch(() => setCfg(null)); }, []);
  return cfg;
}

/** PayPal Smart Buttons. Our server creates and captures the order; the browser only collects the buyer's approval. */
export function PayPalButtons({ cfg, createOrder, onApproved, onError, disabled }: {
  cfg: PayPalConfig;
  createOrder: () => Promise<string>;
  onApproved: (orderId: string) => Promise<void>;
  onError?: (msg: string) => void;
  disabled?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const latest = useRef({ createOrder, onApproved, onError });
  useEffect(() => { latest.current = { createOrder, onApproved, onError }; });
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (!cfg.enabled || !cfg.client_id || !box.current) return;
    let cancelled = false;
    const el = box.current;
    loadSdk(cfg.client_id, cfg.currency)
      .then(() => {
        if (cancelled || !window.paypal) return;
        el.innerHTML = "";
        return window.paypal.Buttons({
          style: { layout: "horizontal", shape: "pill", label: "paypal", height: 42, tagline: false },
          createOrder: () => latest.current.createOrder(),
          onApprove: ({ orderID }) => latest.current.onApproved(orderID),
          onError: (e) => latest.current.onError?.(e instanceof Error ? e.message : "PayPal checkout failed"),
        }).render(el);
      })
      .catch((e: Error) => setFailed(e.message));
    return () => { cancelled = true; el.innerHTML = ""; };
  }, [cfg.enabled, cfg.client_id, cfg.currency]);

  if (!cfg.enabled) return <p className="text-xs font-bold text-muted">PayPal isn&apos;t configured on this server (set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET).</p>;
  if (failed) return <p className="text-xs font-bold text-crit">{failed}</p>;
  return <div ref={box} className={disabled ? "pointer-events-none opacity-50" : undefined} aria-label="Pay with PayPal" />;
}
