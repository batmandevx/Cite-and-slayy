"use client";

import clsx from "clsx";
import { AlertTriangle, CheckCircle2, CircleHelp, ExternalLink, Info, Loader2, OctagonX, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import type { JobState } from "@/lib/api";

export function Card({ children, className, pop, ...rest }: { children: ReactNode; className?: string; pop?: boolean } & React.HTMLAttributes<HTMLDivElement>) {
  return <div className={clsx("card", pop && "card-pop", className)} {...rest}>{children}</div>;
}

export function SectionTitle({ eyebrow, title, children, right }: { eyebrow?: string; title: string; children?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        {eyebrow && (
          <div className="mb-2 inline-flex items-center rounded-full border-2 border-edge bg-yellow px-2.5 py-0.5 font-display text-[11px] font-extrabold uppercase tracking-wider text-[#121212]">
            {eyebrow}
          </div>
        )}
        <h2 className="font-display text-2xl font-extrabold tracking-tight text-ink md:text-[28px]">{title}</h2>
        {children && <p className="mt-1.5 max-w-3xl text-[15px] text-ink-2">{children}</p>}
      </div>
      {right}
    </div>
  );
}

type BtnVariant = "primary" | "secondary" | "ghost" | "danger" | "lime" | "blue";
export function Button({
  children, variant = "secondary", loading, className, ...rest
}: { variant?: BtnVariant; loading?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const ghost = variant === "ghost";
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 font-display text-sm font-bold",
        "focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-blue disabled:cursor-not-allowed disabled:opacity-50",
        !ghost && "btn-brut",
        variant === "primary" && "bg-pink text-[#121212]",
        variant === "lime" && "bg-lime text-[#121212]",
        variant === "blue" && "bg-blue text-white",
        variant === "secondary" && "bg-surface text-ink",
        variant === "danger" && "bg-crit text-white",
        ghost && "rounded-xl text-ink-2 transition hover:bg-surface-2 hover:text-ink",
        className,
      )}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

const fieldCls = "w-full rounded-xl border-[2.5px] border-edge bg-surface px-3.5 py-2.5 text-sm text-ink placeholder:text-muted shadow-[3px_3px_0_var(--shadow-c)] transition focus:outline-none focus:translate-x-[-1px] focus:translate-y-[-1px] focus:shadow-[5px_5px_0_var(--accent)]";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={clsx(fieldCls, props.className)} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={clsx(fieldCls, "font-medium", props.className)} />;
}

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={clsx("block", className)}>
      <span className="mb-1.5 block font-display text-xs font-bold uppercase tracking-wide text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-muted">{hint}</span>}
    </label>
  );
}

export type Tone = "good" | "warn" | "serious" | "crit" | "neutral" | "accent";
const toneCls: Record<Tone, string> = {
  good: "bg-good-soft text-good-ink",
  warn: "bg-warn-soft text-warn-ink",
  serious: "bg-serious-soft text-serious-ink",
  crit: "bg-crit-soft text-crit-ink",
  neutral: "bg-surface-2 text-ink-2",
  accent: "bg-accent-soft text-accent-ink",
};
const toneIcon: Record<Tone, ReactNode> = {
  good: <CheckCircle2 className="size-3.5" />,
  warn: <AlertTriangle className="size-3.5" />,
  serious: <AlertTriangle className="size-3.5" />,
  crit: <OctagonX className="size-3.5" />,
  neutral: <CircleHelp className="size-3.5" />,
  accent: <Info className="size-3.5" />,
};

/** Status chip: always icon + label, never colour alone. */
export function Badge({ tone = "neutral", children, icon = true, className }: { tone?: Tone; children: ReactNode; icon?: boolean; className?: string }) {
  return (
    <span className={clsx("inline-flex items-center gap-1 whitespace-nowrap rounded-full border-2 border-edge px-2 py-0.5 text-[11px] font-bold", toneCls[tone], className)}>
      {icon && toneIcon[tone]}
      {children}
    </span>
  );
}

export function Callout({ tone = "accent", title, children }: { tone?: Tone; title?: string; children: ReactNode }) {
  return (
    <div className={clsx("flex gap-3 rounded-2xl border-[2.5px] border-edge p-4 text-sm shadow-[4px_4px_0_var(--shadow-c)]", toneCls[tone])}>
      <div className="mt-0.5 shrink-0">{toneIcon[tone]}</div>
      <div className="min-w-0">
        {title && <div className="mb-0.5 font-display font-extrabold">{title}</div>}
        <div className="opacity-90">{children}</div>
      </div>
    </div>
  );
}

export function ExtLink({ href, children, className }: { href?: string | null; children: ReactNode; className?: string }) {
  if (!href) return <span className={className}>{children}</span>;
  return (
    <a href={href} target="_blank" rel="noreferrer"
      className={clsx("inline-flex items-baseline gap-1 font-medium text-accent-ink underline decoration-2 underline-offset-2 hover:decoration-pink", className)}>
      <span>{children}</span>
      <ExternalLink className="size-3 shrink-0 translate-y-[1px]" />
    </a>
  );
}

export function Meter({ value, max = 100, tone = "accent", className }: { value: number; max?: number; tone?: Tone; className?: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const bar = { good: "bg-good", warn: "bg-warn", serious: "bg-serious", crit: "bg-crit", neutral: "bg-muted", accent: "bg-pink" }[tone];
  return (
    <div className={clsx("h-3 w-full overflow-hidden rounded-full border-2 border-edge bg-surface-2", className)}>
      <div className={clsx("h-full border-r-2 border-edge transition-[width] duration-700", bar)} style={{ width: `${pct}%` }} />
    </div>
  );
}

const tileBg: Record<Tone, string> = {
  good: "bg-lime", warn: "bg-yellow", serious: "bg-orange", crit: "bg-crit text-white", neutral: "bg-surface", accent: "bg-pink",
};
export function StatTile({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone }) {
  const t = tone ?? "neutral";
  const dark = t === "crit";
  return (
    <div className={clsx("h-full rounded-2xl border-[2.5px] border-edge px-4 py-3.5 shadow-[4px_4px_0_var(--shadow-c)]", tileBg[t], t !== "neutral" && !dark && "text-[#121212]")}>
      <div className={clsx("font-display text-[11px] font-extrabold uppercase tracking-wider", dark ? "text-white/85" : t === "neutral" ? "text-muted" : "text-[#121212]/70")}>{label}</div>
      <div className="mt-1 font-display text-3xl font-extrabold tracking-tight">{value}</div>
      {sub && <div className={clsx("mt-0.5 text-xs", dark ? "text-white/85" : t === "neutral" ? "text-ink-2" : "text-[#121212]/75")}>{sub}</div>}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-3xl border-[2.5px] border-dashed border-edge bg-surface/60 px-6 py-14 text-center">
      {icon && <div className="wobble mb-3 grid size-16 place-items-center rounded-2xl border-[2.5px] border-edge bg-yellow text-[#121212] shadow-[4px_4px_0_var(--shadow-c)]">{icon}</div>}
      <div className="font-display text-lg font-extrabold text-ink">{title}</div>
      {children && <div className="mt-1 max-w-md text-sm text-ink-2">{children}</div>}
    </div>
  );
}

/** Live progress for a backend job (driven by SSE events). */
export function JobProgress({ state, label }: { state: JobState; label: string }) {
  const last = state.events[state.events.length - 1];
  if (!state.running && !state.error) return null;
  if (state.error) return <Callout tone="crit" title={`${label} failed`}>{state.error}</Callout>;
  const pct = Math.round((last?.progress ?? 0) * 100);
  return (
    <div className="rise rounded-2xl border-[2.5px] border-edge bg-surface p-4 shadow-[4px_4px_0_var(--shadow-c)]">
      <div className="mb-2.5 flex items-center justify-between gap-3 text-sm">
        <div className="flex min-w-0 items-center gap-2">
          <Loader2 className="size-4 shrink-0 animate-spin text-pink" />
          <span className="font-display font-extrabold">{label}</span>
          <span className="truncate text-ink-2">{last?.message ?? "Starting…"}</span>
        </div>
        <span className="tabular font-display font-bold">{pct}%</span>
      </div>
      <div className="relative h-4 overflow-hidden rounded-full border-2 border-edge bg-surface-2">
        <div className="h-full rounded-full bg-[repeating-linear-gradient(45deg,var(--pink)_0_10px,var(--orange)_10px_20px)] transition-[width] duration-500"
          style={{ width: `${Math.max(pct, 4)}%` }} />
      </div>
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <code className="rounded-md border-2 border-edge bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-ink">{children}</code>;
}

export function StatusIcon({ tone }: { tone: Tone }) {
  const cls = "size-4 shrink-0";
  if (tone === "good") return <CheckCircle2 className={clsx(cls, "text-good")} />;
  if (tone === "crit") return <XCircle className={clsx(cls, "text-crit")} />;
  if (tone === "warn" || tone === "serious") return <AlertTriangle className={clsx(cls, tone === "warn" ? "text-warn" : "text-serious")} />;
  return <CircleHelp className={clsx(cls, "text-muted")} />;
}
