"use client";

import { CheckCircle2, Loader2, Send } from "lucide-react";
import { useState } from "react";
import { API } from "@/lib/api";
import { track } from "@/lib/track";

const TOPICS = [
  ["support", "Help with my account or a paper"], ["billing", "Payments & billing"], ["partnership", "Partnership / institution"],
  ["press", "Press"], ["feedback", "Feedback or a feature idea"], ["other", "Something else"],
] as const;

const field = "w-full rounded-xl border-[2.5px] border-edge bg-surface px-3.5 py-2.5 text-[15px] text-ink outline-none transition placeholder:text-muted focus:shadow-[3px_3px_0_var(--shadow-c)]";

/** Contact form: saved on our server and emailed to the support inbox. */
export function ContactForm() {
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const [ref, setRef] = useState("");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form)) as Record<string, string>;
    setError(null); setState("sending");
    try {
      const r = await fetch(`${API}/api/contact`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        const d = body?.detail;
        throw new Error(typeof d === "string" ? d : Array.isArray(d) ? "Please check the form: the message needs at least 10 characters." : `Couldn't send (${r.status}).`);
      }
      setRef(body.id ?? ""); setState("sent"); form.reset(); track("contact_submit");
    } catch (err) {
      setError((err as Error).message || "Couldn't send. Please email us instead."); setState("idle");
    }
  }

  if (state === "sent") {
    return (
      <div role="status" className="card flex flex-col items-start gap-3 bg-lime p-6 text-[#121212]">
        <CheckCircle2 className="size-8" />
        <h3 className="font-display text-2xl font-extrabold">Message sent. Thank you!</h3>
        <p>A real person will reply to your email within 2 business days.{ref && <> Your reference is <b className="font-mono">{ref}</b>.</>}</p>
        <button type="button" onClick={() => setState("idle")} className="btn-brut rounded-xl bg-surface px-4 py-2 text-sm font-extrabold">Send another</button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="card space-y-4 p-6" noValidate={false}>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-extrabold">Your name
          <input name="name" required maxLength={120} autoComplete="name" className={`${field} mt-1.5 font-normal`} placeholder="Asha Rao" />
        </label>
        <label className="block text-sm font-extrabold">Email for our reply
          <input name="email" type="email" required maxLength={200} autoComplete="email" className={`${field} mt-1.5 font-normal`} placeholder="you@university.edu" />
        </label>
      </div>
      <label className="block text-sm font-extrabold">What&apos;s it about?
        <select name="topic" defaultValue="support" className={`${field} mt-1.5 font-normal`}>
          {TOPICS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      <label className="block text-sm font-extrabold">Message
        <textarea name="message" required minLength={10} maxLength={5000} rows={6} className={`${field} mt-1.5 resize-y font-normal`}
          placeholder="Tell us what happened. For payments, include the UTR or Razorpay ID." />
      </label>
      {/* honeypot: hidden from people and screen readers, bots fill it in */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
      </div>
      {error && <p role="alert" className="rounded-xl border-2 border-edge bg-crit-soft px-3 py-2 text-sm font-bold text-crit-ink">{error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={state === "sending"}
          className="btn-brut inline-flex items-center gap-2 rounded-2xl bg-pink px-6 py-3 font-display text-lg font-extrabold text-[#121212] disabled:opacity-60">
          {state === "sending" ? <Loader2 className="size-5 animate-spin" /> : <Send className="size-5" />} {state === "sending" ? "Sending…" : "Send message"}
        </button>
        <span className="text-xs text-muted">We only use your email to reply. See our <a href="/privacy" className="underline">Privacy Policy</a>.</span>
      </div>
    </form>
  );
}
