"use client";

import clsx from "clsx";
import { animate, motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import { useEffect, useRef, type ReactNode } from "react";

/** Counts up to `value` (respects reduced motion). */
export function AnimatedNumber({ value, decimals = 0, className }: { value: number; decimals?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduced = useReducedMotion();
  const from = useRef(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduced) {
      el.textContent = value.toFixed(decimals);
      from.current = value;
      return;
    }
    const controls = animate(from.current, value, {
      duration: 1.1,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => { el.textContent = v.toFixed(decimals); },
    });
    from.current = value;
    return () => controls.stop();
  }, [value, decimals, reduced]);
  return <span ref={ref} className={clsx("tabular", className)}>{(0).toFixed(decimals)}</span>;
}

/** Fade-and-rise when scrolled into view. */
export function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 18, filter: "blur(4px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

/** Card that tilts toward the pointer in 3D, with a moving highlight. */
export function TiltCard({ children, className, max = 7 }: { children: ReactNode; className?: string; max?: number }) {
  const reduced = useReducedMotion();
  const mx = useMotionValue(0.5);
  const my = useMotionValue(0.5);
  const rx = useSpring(useTransform(my, [0, 1], [max, -max]), { stiffness: 220, damping: 18 });
  const ry = useSpring(useTransform(mx, [0, 1], [-max, max]), { stiffness: 220, damping: 18 });
  const glare = useTransform([mx, my], ([x, y]: number[]) =>
    `radial-gradient(420px circle at ${x * 100}% ${y * 100}%, rgba(255,255,255,0.14), transparent 45%)`);
  return (
    <motion.div
      className={clsx("relative [transform-style:preserve-3d]", className)}
      style={reduced ? undefined : { rotateX: rx, rotateY: ry, transformPerspective: 900 }}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        mx.set((e.clientX - r.left) / r.width);
        my.set((e.clientY - r.top) / r.height);
      }}
      onPointerLeave={() => { mx.set(0.5); my.set(0.5); }}
      whileHover={reduced ? undefined : { y: -3 }}
    >
      {children}
      {!reduced && <motion.div aria-hidden className="pointer-events-none absolute inset-0 rounded-[inherit]" style={{ background: glare }} />}
    </motion.div>
  );
}

/** Aceternity / 21st.dev-inspired Spotlight Bento Card with pointer-tracking radial aura. */
export function SpotlightCard({
  children, className, glow = "rgba(255, 79, 163, 0.16)", pop = false,
}: {
  children: ReactNode; className?: string; glow?: string; pop?: boolean;
}) {
  const reduced = useReducedMotion();
  const px = useMotionValue(-300);
  const py = useMotionValue(-300);
  const op = useMotionValue(0);
  const bg = useTransform([px, py], ([x, y]: number[]) =>
    `radial-gradient(360px circle at ${x}px ${y}px, ${glow}, transparent 65%)`);

  return (
    <div
      className={clsx("card relative overflow-hidden", pop && "card-pop", className)}
      onPointerMove={(e) => {
        if (reduced) return;
        const r = e.currentTarget.getBoundingClientRect();
        px.set(e.clientX - r.left);
        py.set(e.clientY - r.top);
        op.set(1);
      }}
      onPointerLeave={() => op.set(0)}
    >
      {!reduced && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0 transition-opacity duration-300"
          style={{ background: bg, opacity: op }}
        />
      )}
      <div className="relative">{children}</div>
    </div>
  );
}

/** Animated circular gauge for the integrity score. */
export function ScoreRing({ value, max = 100, tone, size = 168 }: { value: number; max?: number; tone: "good" | "warn" | "crit" | "neutral" | "accent" | "serious"; size?: number }) {
  const stroke = 12;
  const r = (size - stroke) / 2;
  const color = { good: "var(--good)", warn: "var(--warn)", crit: "var(--crit)", serious: "var(--serious)", neutral: "var(--muted)", accent: "var(--accent)" }[tone];
  const pct = Math.max(0, Math.min(1, value / max));
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <div className="absolute inset-3 rounded-full blur-2xl" style={{ background: color, opacity: 0.18 }} />
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          initial={{ pathLength: 0 }} animate={{ pathLength: pct }} transition={{ duration: 1.3, ease: [0.22, 1, 0.36, 1] }}
          style={{ filter: `drop-shadow(0 0 8px ${color})` }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <AnimatedNumber value={value} className="text-5xl font-semibold tracking-tight" />
          <div className="-mt-1 text-xs text-muted">/ {max}</div>
        </div>
      </div>
    </div>
  );
}

/** Stagger container + item for lists. */
export const stagger = {
  container: { hidden: {}, show: { transition: { staggerChildren: 0.06, delayChildren: 0.05 } } },
  item: { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] as const } } },
};
