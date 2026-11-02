"use client";

import { Crown, Mail, Rocket, Sparkles } from "lucide-react";
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import Link from "next/link";
import type { PointerEvent as ReactPointerEvent } from "react";
import { BUSINESS } from "@/lib/business";

const THEMES = [
  { grad: "from-[#ff4fa3] via-[#ffd23f] to-[#ff8a3d]", glow: "#ff4fa3", core: "#ff8a3d", Icon: Rocket },
  { grad: "from-[#c6f24e] via-[#7ee8c8] to-[#4dc3ff]", glow: "#7ee8c8", core: "#4dc3ff", Icon: Crown },
];

function FounderCard({ i, compact }: { i: number; compact: boolean }) {
  const f = BUSINESS.team[i], t = THEMES[i], reduce = useReducedMotion();
  // 3D tilt and a glare spot that follow the pointer
  const mx = useMotionValue(0.5), my = useMotionValue(0.5);
  const rx = useSpring(useTransform(my, [0, 1], [9, -9]), { stiffness: 160, damping: 18 });
  const ry = useSpring(useTransform(mx, [0, 1], [-11, 11]), { stiffness: 160, damping: 18 });
  const glareX = useTransform(mx, (v) => `${v * 100}%`), glareY = useTransform(my, (v) => `${v * 100}%`);
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (reduce) return;
    const r = e.currentTarget.getBoundingClientRect();
    mx.set((e.clientX - r.left) / r.width); my.set((e.clientY - r.top) / r.height);
  };
  const leave = () => { mx.set(0.5); my.set(0.5); };

  return (
    <motion.div initial={{ opacity: 0, y: 60, scale: 0.92 }} whileInView={{ opacity: 1, y: 0, scale: 1 }} viewport={{ once: true, amount: 0.2 }}
      transition={{ type: "spring", stiffness: 110, damping: 16, delay: 0.18 * i }} className="relative [perspective:1200px]">
      {/* spotlight beam from above */}
      <motion.div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[360px] -translate-x-1/2"
        style={{ background: `conic-gradient(from 180deg at 50% 0%, transparent 155deg, ${t.glow}33 180deg, transparent 205deg)`, filter: "blur(6px)" }}
        animate={reduce ? undefined : { rotate: [-4, 4, -4] }} transition={{ repeat: Infinity, duration: 7 + i, ease: "easeInOut" }} />

      <motion.div onPointerMove={move} onPointerLeave={leave} style={reduce ? undefined : { rotateX: rx, rotateY: ry, transformStyle: "preserve-3d" }}
        className="group relative rounded-[30px] p-[3px]">
        <div aria-hidden className={`absolute inset-0 rounded-[30px] bg-gradient-to-br ${t.grad}`} />
        <div aria-hidden className={`absolute -inset-2 rounded-[36px] bg-gradient-to-br ${t.grad} opacity-40 blur-2xl transition group-hover:opacity-70`} />
        <div className="relative overflow-hidden rounded-[27px] bg-[#17112a] px-6 pb-9 pt-10 text-center md:px-10">
          {/* holographic sweep + pointer glare */}
          <motion.div aria-hidden className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 -skew-x-12 bg-gradient-to-r from-transparent via-white/15 to-transparent"
            animate={reduce ? undefined : { x: ["0%", "400%"] }} transition={{ repeat: Infinity, duration: 3.8, repeatDelay: 2.2, ease: "easeInOut", delay: i * 1.1 }} />
          <motion.div aria-hidden className="pointer-events-none absolute size-72 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-0 transition group-hover:opacity-100"
            style={{ left: glareX, top: glareY, background: `radial-gradient(circle, ${t.glow}40 0%, transparent 65%)` }} />

          {/* the orb */}
          <div className="relative mx-auto grid size-48 place-items-center md:size-56" style={{ transform: "translateZ(60px)" }}>
            <motion.div aria-hidden className={`absolute inset-0 rounded-full bg-conic ${t.grad}`}
              style={{ maskImage: "radial-gradient(circle, transparent 60%, black 62%, black 70%, transparent 72%)", WebkitMaskImage: "radial-gradient(circle, transparent 60%, black 62%, black 70%, transparent 72%)" }}
              animate={reduce ? undefined : { rotate: 360 }} transition={{ repeat: Infinity, duration: 6, ease: "linear" }} />
            <motion.div aria-hidden className="absolute inset-0" animate={reduce ? undefined : { rotate: -360 }} transition={{ repeat: Infinity, duration: 11, ease: "linear" }}>
              {[0, 1, 2].map((k) => (
                <span key={k} className="absolute left-1/2 top-1/2 text-[#ffd23f]" style={{ transform: `rotate(${k * 120}deg) translateY(-${k % 2 ? 108 : 100}px)` }}>✦</span>
              ))}
            </motion.div>
            <motion.div animate={reduce ? undefined : { y: [0, -6, 0] }} transition={{ repeat: Infinity, duration: 4, ease: "easeInOut" }}
              className="relative grid size-32 place-items-center rounded-full border-[3px] border-white/90 font-display text-5xl font-extrabold text-[#121212] md:size-36 md:text-6xl"
              style={{ background: `radial-gradient(circle at 32% 26%, #ffffff 0%, ${t.glow} 50%, ${t.core} 100%)`, boxShadow: `0 0 60px ${t.glow}aa, inset 0 -10px 30px #0003` }}>
              {f.initials}
            </motion.div>
            <motion.span animate={reduce ? undefined : { y: [0, -8, 0], rotate: [-8, 8, -8] }} transition={{ repeat: Infinity, duration: 3.2, ease: "easeInOut" }}
              className="absolute -top-1 right-6 grid size-12 place-items-center rounded-2xl border-[3px] border-[#121212] bg-[#ffd23f] text-[#121212] shadow-[3px_3px_0_#000]">
              <t.Icon className="size-6" />
            </motion.span>
          </div>

          {/* name plate */}
          <div style={{ transform: "translateZ(40px)" }}>
            <div className={`mx-auto mt-4 inline-block rounded-full bg-gradient-to-r ${t.grad} px-4 py-1.5 text-xs font-extrabold uppercase tracking-[0.18em] text-[#121212]`}
              style={{ boxShadow: `0 0 24px ${t.glow}` }}>
              {f.role}
            </div>
            <h3 className="mt-4 font-display text-4xl font-extrabold leading-none tracking-tight md:text-5xl">
              <span className={`shimmer-text bg-gradient-to-r ${t.grad} bg-clip-text text-transparent`}>{f.name}</span>
            </h3>
            <p className="mt-3 text-base font-semibold italic text-white/75 md:text-lg">{f.tagline}</p>
            {!compact && (
              <a href={`mailto:${f.email}`} className="mt-6 inline-flex items-center gap-1.5 rounded-xl border-2 border-white/40 bg-white/10 px-3.5 py-2 text-sm font-bold text-white transition hover:bg-white hover:text-[#121212]">
                <Mail className="size-4" />{f.email}
              </a>
            )}
          </div>
        </div>
      </motion.div>

      {/* pedestal */}
      <div aria-hidden className="mx-auto mt-4 h-4 w-3/4 rounded-[50%] blur-md" style={{ background: `radial-gradient(ellipse, ${t.glow}aa 0%, transparent 70%)` }} />
    </motion.div>
  );
}

/** A dark, spotlit stage that celebrates the founders. `compact` is the shorter version for the home page. */
export function FoundersSpotlight({ compact = false }: { compact?: boolean }) {
  const reduce = useReducedMotion();
  return (
    <section className="relative overflow-hidden rounded-[30px] border-[3px] border-edge bg-[#0f0a1c] px-5 pb-12 pt-14 text-white shadow-[6px_6px_0_var(--shadow-c)] md:px-12 md:pb-16 md:pt-20">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -left-32 -top-32 size-[460px] rounded-full bg-[#ff4fa3] opacity-25 blur-[120px]" />
        <div className="absolute -right-32 top-20 size-[460px] rounded-full bg-[#4dc3ff] opacity-20 blur-[120px]" />
        <div className="absolute bottom-[-180px] left-1/3 size-[420px] rounded-full bg-[#8f7bff] opacity-30 blur-[120px]" />
        <div className="absolute inset-0 opacity-[0.07]" style={{ backgroundImage: "radial-gradient(#fff 1px, transparent 1px)", backgroundSize: "22px 22px" }} />
        {Array.from({ length: 26 }, (_, i) => (
          <motion.span key={i} className="absolute text-[#ffd23f]" style={{ left: `${(i * 37) % 100}%`, top: `${(i * 53) % 100}%`, fontSize: 8 + (i % 4) * 5 }}
            animate={reduce ? undefined : { opacity: [0.1, 0.95, 0.1], scale: [0.7, 1.25, 0.7] }} transition={{ repeat: Infinity, duration: 2.4 + (i % 5) * 0.6, delay: i * 0.15 }}>✦</motion.span>
        ))}
      </div>

      <div className="relative text-center">
        <motion.span initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
          className="inline-flex items-center gap-1.5 rounded-full border-2 border-[#ffd23f]/60 bg-[#ffd23f]/10 px-4 py-1.5 text-xs font-extrabold uppercase tracking-[0.25em] text-[#ffd23f]">
          <Crown className="size-3.5" /> Meet the founders <Crown className="size-3.5" />
        </motion.span>
        <motion.h2 initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.1 }}
          className="mx-auto mt-5 max-w-4xl font-display text-5xl font-extrabold leading-[0.98] tracking-tight md:text-7xl">
          The minds behind <span className="shimmer-text bg-gradient-to-r from-[#ff4fa3] via-[#ffd23f] to-[#c6f24e] bg-clip-text text-transparent">Cite &amp; Slayy</span>
        </motion.h2>
        <motion.p initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ delay: 0.25 }}
          className="mx-auto mt-5 max-w-xl text-white/70 md:text-lg">
          Two founders on one mission: research you can trust, for everyone.
        </motion.p>
      </div>

      <div className="relative mx-auto mt-24 grid max-w-5xl gap-x-10 gap-y-28 md:grid-cols-2">
        {BUSINESS.team.map((f, i) => <FounderCard key={f.name} i={i} compact={compact} />)}
      </div>

      {compact && (
        <div className="relative mt-12 text-center">
          <Link href="/about" className="inline-flex items-center gap-2 rounded-2xl border-[3px] border-[#121212] bg-[#ffd23f] px-6 py-3 font-display text-lg font-extrabold text-[#121212] shadow-[4px_4px_0_#000] transition hover:-translate-y-0.5">
            <Sparkles className="size-5" /> More about us
          </Link>
        </div>
      )}
    </section>
  );
}
