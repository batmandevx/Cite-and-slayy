"use client";

import clsx from "clsx";
import { ArrowLeft, Eye, EyeOff, Lock, Mail, ShieldCheck, Sparkles, User } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Logo } from "../Logo";
import { Button } from "../ui";
import { useAuth } from "./AuthProvider";

declare global {
  interface Window {
    google?: { accounts: { id: {
      initialize: (o: { client_id: string; callback: (r: { credential: string }) => void }) => void;
      renderButton: (el: HTMLElement, o: Record<string, unknown>) => void;
    } } };
  }
}

function strength(pw: string): { score: number; label: string; color: string } {
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return [{ score: 0, label: "Too short", color: "bg-crit" }, { score: 1, label: "Weak", color: "bg-crit" }, { score: 2, label: "Fair", color: "bg-orange" },
    { score: 3, label: "Good", color: "bg-yellow" }, { score: 4, label: "Strong", color: "bg-lime" }, { score: 5, label: "Excellent", color: "bg-good" }][s];
}

function Field({ icon: Icon, children }: { icon: typeof Mail; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-2.5 rounded-xl border-[2.5px] border-edge bg-surface px-3.5 shadow-[3px_3px_0_var(--shadow-c)] focus-within:shadow-[5px_5px_0_var(--pink)] focus-within:-translate-x-px focus-within:-translate-y-px transition">
      <Icon className="size-4 shrink-0 text-muted" />{children}
    </label>
  );
}

export function LoginScreen() {
  const { config, refresh } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const gBtn = useRef<HTMLDivElement>(null);
  const st = strength(password);

  useEffect(() => {
    const id = config?.google_client_id;
    if (!id || !gBtn.current) return;
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client"; s.async = true;
    s.onload = () => {
      window.google?.accounts.id.initialize({ client_id: id, callback: async ({ credential }) => {
        try { await api.post("/api/auth/google", { credential }); await refresh(); } catch (e) { setMsg((e as Error).message); }
      } });
      if (gBtn.current) window.google?.accounts.id.renderButton(gBtn.current, { theme: "filled_black", size: "large", shape: "pill", text: "continue_with", width: 320 });
    };
    document.head.appendChild(s);
  }, [config?.google_client_id, refresh]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    if (mode === "signup" && st.score < 2) { setMsg("Choose a stronger password: at least 8 characters with letters and numbers."); return; }
    setBusy(true);
    try {
      if (mode === "signup") await api.post("/api/auth/register", { email, name, password });
      else await api.post("/api/auth/login", { email, password });
      await refresh();
    } catch (err) {
      setMsg((err as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden px-4 py-10">
      <motion.div className="pointer-events-none absolute -left-24 top-10 size-96 rounded-full bg-pink/40 blur-3xl" animate={{ x: [0, 40, 0], y: [0, 30, 0] }} transition={{ repeat: Infinity, duration: 12 }} />
      <motion.div className="pointer-events-none absolute -right-24 bottom-0 size-96 rounded-full bg-lime/40 blur-3xl" animate={{ x: [0, -30, 0], y: [0, -40, 0] }} transition={{ repeat: Infinity, duration: 14 }} />
      <div className="relative grid w-full max-w-5xl items-center gap-10 lg:grid-cols-[1fr_440px]">
        <motion.div initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} className="hidden lg:block">
          <Logo />
          <h1 className="mt-8 font-display text-5xl font-extrabold leading-[1.02]">Topic in.<br /><span className="gradient-text">Publish-ready paper</span> out.</h1>
          <ul className="mt-6 space-y-3 text-ink-2">
            {["Real, verified references and figures from real data", "LaTeX, Word, PDF and presentation slides", "Originality report, journal finder, submission kit"].map((t, i) => (
              <motion.li key={t} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 + i * 0.1 }} className="flex items-center gap-2.5">
                <span className="grid size-7 place-items-center rounded-lg border-2 border-edge bg-yellow text-[#121212]"><Sparkles className="size-3.5" /></span>{t}
              </motion.li>
            ))}
          </ul>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 30, rotate: -1 }} animate={{ opacity: 1, y: 0, rotate: 0 }} transition={{ type: "spring", stiffness: 160 }}
          className="card card-pop relative w-full p-7">
          <div className="lg:hidden"><Logo /></div>
          <div className="mt-2 grid grid-cols-2 rounded-2xl border-[2.5px] border-edge bg-surface-2 p-1 text-sm font-extrabold lg:mt-0">
            {(["signin", "signup"] as const).map((m) => (
              <button key={m} onClick={() => { setMode(m); setMsg(null); }} className="relative rounded-xl py-2">
                {mode === m && <motion.span layoutId="auth-tab" className="absolute inset-0 rounded-xl bg-pink" transition={{ type: "spring", stiffness: 400, damping: 30 }} />}
                <span className={clsx("relative", mode === m && "text-[#121212]")}>{m === "signin" ? "Sign in" : "Create account"}</span>
              </button>
            ))}
          </div>
          <AnimatePresence mode="wait">
            <motion.form key={mode} onSubmit={submit} initial={{ opacity: 0, x: mode === "signup" ? 20 : -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
              className="mt-5 space-y-3">
              <h2 className="font-display text-2xl font-extrabold">{mode === "signin" ? "Welcome back 👋" : "Start writing for free ✨"}</h2>
              {mode === "signup" && (
                <Field icon={User}><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" autoComplete="name"
                  className="w-full bg-transparent py-3 text-sm outline-none" /></Field>
              )}
              <Field icon={Mail}><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@university.edu" autoComplete="email"
                className="w-full bg-transparent py-3 text-sm outline-none" /></Field>
              <Field icon={Lock}>
                <input type={show ? "text" : "password"} required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === "signup" ? "Create a password (8+ letters & numbers)" : "Password"} autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  className="w-full bg-transparent py-3 text-sm outline-none" />
                <button type="button" onClick={() => setShow(!show)} className="text-muted hover:text-ink" aria-label={show ? "Hide password" : "Show password"}>
                  {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>
              </Field>
              {mode === "signup" && password && (
                <div className="flex items-center gap-2 text-[11px] font-bold">
                  <div className="flex flex-1 gap-1">{[0, 1, 2, 3, 4].map((i) => (
                    <motion.span key={i} className={clsx("h-1.5 flex-1 rounded-full", i < st.score ? st.color : "bg-surface-3")} animate={{ scaleY: i < st.score ? 1.3 : 1 }} />))}</div>
                  <span className="w-16 text-right">{st.label}</span>
                </div>
              )}
              {msg && <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border-2 border-crit bg-crit-soft px-3 py-2 text-sm text-crit-ink">{msg}</motion.p>}
              <Button variant="primary" type="submit" className="w-full !py-3 text-base" loading={busy}>{mode === "signin" ? "Sign in" : "Create my account"}</Button>
              {mode === "signin" && <p className="text-center text-xs text-muted">Forgot your password? Email support from the <Link href="/contact" className="underline">contact page</Link> and we&apos;ll reset it.</p>}
            </motion.form>
          </AnimatePresence>

          <div className="my-5 flex items-center gap-3 text-xs font-bold uppercase text-muted"><span className="h-0.5 flex-1 bg-line" />or<span className="h-0.5 flex-1 bg-line" /></div>
          {config?.google_client_id ? <div className="flex justify-center"><div ref={gBtn} /></div> : (
            <button disabled className="flex w-full cursor-not-allowed items-center justify-center gap-2.5 rounded-xl border-[2.5px] border-dashed border-line bg-surface-2 py-3 text-sm font-bold text-muted">
              <svg viewBox="0 0 48 48" className="size-5 opacity-60" aria-hidden><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.3-.4-3.5z"/></svg>
              Sign in with Google
              <span className="rounded-full border-2 border-edge bg-yellow px-2 text-[10px] font-extrabold uppercase text-[#121212]">Coming soon</span>
            </button>
          )}
          <div className="mt-6 flex items-center gap-2 text-[11px] text-muted">
            <ShieldCheck className="size-4 shrink-0 text-good" />
            Passwords are salted and hashed; never stored in plain text. By continuing you agree to our <Link href="/terms" className="underline">Terms</Link> and <Link href="/privacy" className="underline">Privacy Policy</Link>.
          </div>
          <Link href="/" className="mt-4 inline-flex items-center gap-1 text-xs font-bold text-ink-2 hover:text-ink"><ArrowLeft className="size-3.5" />Back to home</Link>
        </motion.div>
      </div>
    </div>
  );
}
