"use client";

import { ArrowLeft, Mail, ShieldCheck, Sparkles } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Logo } from "../Logo";
import { Button } from "../ui";
import { useAuth } from "./AuthProvider";

declare global {
  interface Window {
    google?: { accounts: { id: {
      initialize: (o: { client_id: string; callback: (r: { credential: string }) => void; ux_mode?: string }) => void;
      renderButton: (el: HTMLElement, o: Record<string, unknown>) => void;
    } } };
  }
}

function loadScript(src: string) {
  return new Promise<void>((ok, bad) => {
    if (document.querySelector(`script[src="${src}"]`)) { ok(); return; }
    const s = document.createElement("script");
    s.src = src; s.async = true; s.onload = () => ok(); s.onerror = () => bad(new Error("script load failed"));
    document.head.appendChild(s);
  });
}

export function LoginScreen() {
  const { config, refresh } = useAuth();
  const gBtn = useRef<HTMLDivElement>(null);
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const [devLink, setDevLink] = useState<string | null>(null);

  useEffect(() => {
    const id = config?.google_client_id;
    if (!id || !gBtn.current) return;
    loadScript("https://accounts.google.com/gsi/client").then(() => {
      window.google?.accounts.id.initialize({
        client_id: id,
        callback: async ({ credential }) => {
          try {
            await api.post("/api/auth/google", { credential });
            await refresh();
          } catch (e) {
            setMsg((e as Error).message);
          }
        },
      });
      if (gBtn.current) window.google?.accounts.id.renderButton(gBtn.current, { theme: "filled_black", size: "large", shape: "pill", text: "continue_with", width: 320 });
    }).catch(() => setMsg("Couldn't load Google sign-in. Check your connection or use email."));
  }, [config?.google_client_id, refresh]);

  const sendLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("sending"); setMsg(null);
    try {
      const r = await api.post<{ sent: boolean; dev_link?: string }>("/api/auth/email/start", { email });
      setState("sent");
      if (r.dev_link) setDevLink(r.dev_link);
    } catch (err) {
      setState("error"); setMsg((err as Error).message);
    }
  };

  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden px-4 py-10">
      <div className="pointer-events-none absolute -left-24 top-10 size-80 rounded-full bg-pink/40 blur-3xl" />
      <div className="pointer-events-none absolute -right-24 bottom-10 size-80 rounded-full bg-lime/40 blur-3xl" />
      <motion.div initial={{ opacity: 0, y: 30, rotate: -1 }} animate={{ opacity: 1, y: 0, rotate: 0 }} transition={{ type: "spring", stiffness: 160 }}
        className="card card-pop relative w-full max-w-md p-8">
        <Logo />
        <h1 className="mt-6 font-display text-3xl font-extrabold leading-tight">Sign in to start slaying <span className="inline-block wobble">💅</span></h1>
        <p className="mt-2 text-sm text-ink-2">Your papers, notes and audits are private to your account. The free plan includes one full paper every month.</p>

        {config?.google_client_id && <div className="mt-6 flex justify-center"><div ref={gBtn} /></div>}

        {config?.email_login && (
          <>
            {config.google_client_id && <div className="my-5 flex items-center gap-3 text-xs font-bold uppercase text-muted"><span className="h-0.5 flex-1 bg-line" />or<span className="h-0.5 flex-1 bg-line" /></div>}
            {state === "sent" ? (
              <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="rounded-2xl border-[2.5px] border-edge bg-lime p-4 text-[#121212]">
                <div className="flex items-center gap-2 font-display font-extrabold"><Mail className="size-5" />Check your inbox</div>
                <p className="mt-1 text-sm">We sent a sign-in link to <b>{email}</b>. It works for 15 minutes.</p>
                {devLink && <a href={devLink} className="mt-2 block break-all text-xs underline">Dev mode: open sign-in link</a>}
              </motion.div>
            ) : (
              <form onSubmit={sendLink} className="space-y-2.5">
                <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@university.edu"
                  className="w-full rounded-xl border-[2.5px] border-edge bg-surface px-3.5 py-3 text-sm shadow-[3px_3px_0_var(--shadow-c)] outline-none" />
                <Button variant="primary" type="submit" className="w-full" loading={state === "sending"}><Sparkles className="size-4" />Email me a sign-in link</Button>
              </form>
            )}
          </>
        )}
        {!config?.google_client_id && !config?.email_login && config && (
          <p className="mt-6 rounded-xl border-2 border-dashed border-line p-3 text-sm text-muted">Sign-in isn&apos;t configured on this server yet.</p>
        )}
        {msg && <p className="mt-3 rounded-xl border-2 border-crit bg-crit-soft px-3 py-2 text-sm text-crit-ink">{msg}</p>}

        <div className="mt-6 flex items-center gap-2 text-[11px] text-muted">
          <ShieldCheck className="size-4 shrink-0" />
          By continuing you agree to our <Link href="/terms" className="underline">Terms</Link> and <Link href="/privacy" className="underline">Privacy Policy</Link>.
        </div>
        <Link href="/" className="mt-4 inline-flex items-center gap-1 text-xs font-bold text-ink-2 hover:text-ink"><ArrowLeft className="size-3.5" />Back to home</Link>
      </motion.div>
    </div>
  );
}
