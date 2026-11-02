"use client";

import clsx from "clsx";
import { Check, ChevronDown, Copy, Mail, Search, Send, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import { BUSINESS } from "@/lib/business";
import { FAQS, TOPICS, type FaqTopic } from "@/lib/supportFaq";

/** Searchable, filterable FAQ with animated answers and a "was this helpful?" prompt. */
export function HelpCenter() {
  const [q, setQ] = useState("");
  const [topic, setTopic] = useState<FaqTopic | "all">("all");
  const [open, setOpen] = useState<string | null>(FAQS[4].q);
  const [voted, setVoted] = useState<Record<string, "up" | "down">>({});
  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return FAQS.filter((f) => (topic === "all" || f.topic === topic)
      && words.every((w) => `${f.q} ${f.a}`.toLowerCase().includes(w)));
  }, [q, topic]);
  // while searching, the best match opens by itself
  const current = q.trim() && !shown.some((f) => f.q === open) ? shown[0]?.q ?? null : open;

  return (
    <div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 z-10 size-5 -translate-y-1/2 text-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search help: “refund”, “UPI”, “LaTeX”, “delete account”…"
          aria-label="Search help articles"
          className="w-full rounded-2xl border-[3px] border-edge bg-surface py-4 pl-12 pr-12 text-base font-semibold shadow-[4px_4px_0_var(--shadow-c)] outline-none transition focus:-translate-y-0.5 focus:shadow-[6px_6px_0_var(--shadow-c)]" />
        {q && <button onClick={() => setQ("")} aria-label="Clear search" className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted hover:bg-surface-2"><X className="size-4" /></button>}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {[{ id: "all" as const, label: "All topics", emoji: "✨", color: "bg-surface" }, ...TOPICS].map((t) => (
          <button key={t.id} onClick={() => setTopic(t.id)}
            className={clsx("rounded-full border-2 border-edge px-3.5 py-1.5 text-sm font-bold transition hover:-translate-y-0.5",
              topic === t.id ? `${t.color} text-[#121212] shadow-[2px_2px_0_var(--shadow-c)]` : "bg-surface")}>
            <span className="mr-1">{t.emoji}</span>{t.label}
            <span className="ml-1.5 text-xs opacity-60">{t.id === "all" ? FAQS.length : FAQS.filter((f) => f.topic === t.id).length}</span>
          </button>
        ))}
      </div>

      {q.trim() && <div className="mt-4 text-xs font-bold text-muted">{shown.length} {shown.length === 1 ? "answer" : "answers"} for “{q.trim()}”</div>}
      <div className="mt-3 space-y-2.5">
        <AnimatePresence initial={false}>
          {shown.map((f) => {
            const isOpen = current === f.q, t = TOPICS.find((x) => x.id === f.topic)!;
            return (
              <motion.div key={f.q} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98 }}
                className={clsx("overflow-hidden rounded-2xl border-2 border-edge bg-surface transition", isOpen && "shadow-[4px_4px_0_var(--shadow-c)]")}>
                <button onClick={() => setOpen(isOpen ? null : f.q)} aria-expanded={isOpen}
                  className="flex w-full items-center gap-3 px-4 py-3.5 text-left">
                  <span className={clsx("grid size-8 shrink-0 place-items-center rounded-lg border-2 border-edge text-base", t.color)}>{t.emoji}</span>
                  <span className="flex-1 font-display font-extrabold">{f.q}</span>
                  <ChevronDown className={clsx("size-5 shrink-0 transition", isOpen && "rotate-180")} />
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.22 }}>
                      <div className="px-4 pb-4 pl-[60px] text-[15px] leading-relaxed text-ink-2">
                        {f.a}
                        <div className="mt-3 flex items-center gap-2 text-xs font-bold text-muted">
                          {voted[f.q] ? <span className="text-ink">Thanks for the feedback! {voted[f.q] === "down" && "Write to us below and we'll help."}</span> : <>
                            Was this helpful?
                            <button onClick={() => setVoted((v) => ({ ...v, [f.q]: "up" }))} className="rounded-lg border-2 border-edge bg-surface px-2 py-0.5 hover:bg-lime" aria-label="Yes"><ThumbsUp className="size-3.5" /></button>
                            <button onClick={() => setVoted((v) => ({ ...v, [f.q]: "down" }))} className="rounded-lg border-2 border-edge bg-surface px-2 py-0.5 hover:bg-pink" aria-label="No"><ThumbsDown className="size-3.5" /></button>
                          </>}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </AnimatePresence>
        {shown.length === 0 && (
          <div className="rounded-2xl border-2 border-dashed border-line p-8 text-center">
            <div className="text-3xl">🤔</div>
            <div className="mt-2 font-display text-lg font-extrabold">No answers for “{q}” yet</div>
            <p className="text-sm text-ink-2">Ask us directly with the form below; we reply within 2 business days.</p>
          </div>
        )}
      </div>
    </div>
  );
}

const KINDS = [
  { id: "payment", label: "Payment or plan", hint: "Payment ID (pay_…) or 12-digit UPI UTR, date and amount" },
  { id: "refund", label: "Cancel or refund", hint: "Payment ID or UTR and the reason" },
  { id: "paper", label: "A paper or export", hint: "Paper title and what went wrong (attach a screenshot)" },
  { id: "citation", label: "Wrong citation or check", hint: "Paper title, the reference, and what you expected" },
  { id: "account", label: "Account or sign-in", hint: "What you were trying to do" },
  { id: "other", label: "Something else", hint: "Tell us anything" },
];

/** Builds a well-structured support email and opens it in the user's mail app. */
export function ContactComposer() {
  const [kind, setKind] = useState(KINDS[0].id);
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState("");
  const [copied, setCopied] = useState(false);
  const k = KINDS.find((x) => x.id === kind)!;
  const subject = `[Support] ${k.label}`;
  const body = `Account email: ${email || "(your registered email)"}\nTopic: ${k.label}\n\n${msg || `(${k.hint})`}\n\n— sent from citeslayy.com/support`;
  const href = `mailto:${BUSINESS.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  const copy = () => navigator.clipboard?.writeText(BUSINESS.email).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); });

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
      <div className="space-y-3">
        <div>
          <div className="mb-1.5 text-xs font-extrabold uppercase tracking-wider text-muted">What do you need help with?</div>
          <div className="flex flex-wrap gap-2">
            {KINDS.map((x) => (
              <button key={x.id} onClick={() => setKind(x.id)}
                className={clsx("rounded-xl border-2 border-edge px-3 py-1.5 text-sm font-bold transition", kind === x.id ? "bg-lime text-[#121212] shadow-[2px_2px_0_var(--shadow-c)]" : "bg-surface hover:-translate-y-0.5")}>{x.label}</button>
            ))}
          </div>
        </div>
        <label className="block">
          <span className="mb-1.5 block text-xs font-extrabold uppercase tracking-wider text-muted">Your account email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@university.edu"
            className="w-full rounded-xl border-[2.5px] border-edge bg-surface px-3 py-2.5 text-sm shadow-[3px_3px_0_var(--shadow-c)] outline-none" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-extrabold uppercase tracking-wider text-muted">Message</span>
          <textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={5} placeholder={k.hint}
            className="w-full resize-y rounded-xl border-[2.5px] border-edge bg-surface px-3 py-2.5 text-sm shadow-[3px_3px_0_var(--shadow-c)] outline-none" />
        </label>
        <a href={href} className="btn-brut inline-flex no-underline items-center gap-2 rounded-2xl bg-pink px-6 py-3 font-display text-lg font-extrabold text-[#121212]">
          <Send className="size-5" /> Open in my email app
        </a>
        <p className="text-xs text-muted">This opens your email app with everything filled in. Nothing is sent until you press send there.</p>
      </div>
      <div className="space-y-3 rounded-2xl border-2 border-edge bg-surface-2 p-4">
        <div className="font-display font-extrabold">Prefer to write yourself?</div>
        <div className="flex items-center gap-2 rounded-xl border-2 border-edge bg-surface px-3 py-2">
          <Mail className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-sm font-bold">{BUSINESS.email}</span>
          <button onClick={copy} className="rounded-lg border-2 border-edge px-2 py-0.5 text-xs font-bold hover:bg-lime" aria-label="Copy email address">
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          </button>
        </div>
        <ul className="list-none space-y-1.5 pl-0 text-sm text-ink-2">
          <li>✅ Write from your registered email</li>
          <li>🧾 Include payment ID or UTR for billing</li>
          <li>📸 A screenshot helps a lot</li>
          <li>⏱️ Reply within 2 business days</li>
        </ul>
        <div className="rounded-xl border-2 border-edge bg-mint px-3 py-2 text-xs font-bold text-[#121212]">We never ask for your password, card number or UPI PIN.</div>
      </div>
    </div>
  );
}
