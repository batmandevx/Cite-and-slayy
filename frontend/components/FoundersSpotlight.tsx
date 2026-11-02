"use client";

import { Crown, Mail, Rocket, Sparkles, Star, Trophy } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { BUSINESS } from "@/lib/business";

const GRAD = ["from-[#ff4fa3] via-[#ffd23f] to-[#ff8a3d]", "from-[#c6f24e] via-[#7ee8c8] to-[#4dc3ff]"];
const GLOW = ["#ff4fa3", "#c6f24e"];

/** A dark, spotlit stage that celebrates the founders. `compact` is the shorter version for the home page. */
export function FoundersSpotlight({ compact = false }: { compact?: boolean }) {
  const reduce = useReducedMotion();
  return (
    <section className="relative overflow-hidden rounded-[28px] border-[3px] border-edge bg-[#120d1f] px-5 py-12 text-white shadow-[6px_6px_0_var(--shadow-c)] md:px-10 md:py-16">
      {/* stage lights */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 -top-24 size-[420px] rounded-full bg-[#ff4fa3] opacity-25 blur-[110px]" />
        <div className="absolute -right-24 top-10 size-[420px] rounded-full bg-[#c6f24e] opacity-20 blur-[110px]" />
        <div className="absolute bottom-[-160px] left-1/3 size-[380px] rounded-full bg-[#8f7bff] opacity-25 blur-[110px]" />
        {Array.from({ length: 22 }, (_, i) => (
          <motion.span key={i} className="absolute text-[#ffd23f]" style={{ left: `${(i * 37) % 100}%`, top: `${(i * 53) % 100}%`, fontSize: 8 + (i % 4) * 4 }}
            animate={reduce ? undefined : { opacity: [0.15, 0.9, 0.15], scale: [0.8, 1.2, 0.8] }} transition={{ repeat: Infinity, duration: 2.5 + (i % 5) * 0.6, delay: i * 0.17 }}>✦</motion.span>
        ))}
      </div>

      <div className="relative text-center">
        <motion.span initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
          className="inline-flex items-center gap-1.5 rounded-full border-2 border-white/30 bg-white/10 px-3.5 py-1 text-xs font-extrabold uppercase tracking-[0.2em] backdrop-blur">
          <Crown className="size-3.5 text-[#ffd23f]" /> The founders
        </motion.span>
        <motion.h2 initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.1 }}
          className="mx-auto mt-4 max-w-3xl font-display text-4xl font-extrabold leading-[1.02] tracking-tight md:text-6xl">
          The minds behind <span className="bg-gradient-to-r from-[#ff4fa3] via-[#ffd23f] to-[#c6f24e] bg-clip-text text-transparent">Cite &amp; Slayy</span>
        </motion.h2>
        <motion.p initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ delay: 0.25 }}
          className="mx-auto mt-4 max-w-2xl text-white/75 md:text-lg">
          Two researchers who were tired of AI that invents sources, so they built one that only cites real papers.
        </motion.p>
        <motion.div initial={{ opacity: 0, scale: 0.9 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }} transition={{ delay: 0.35 }}
          className="mt-5 inline-flex items-center gap-2 rounded-2xl border-2 border-[#ffd23f]/60 bg-[#ffd23f]/10 px-4 py-2 text-sm font-bold text-[#ffd23f]">
          <Trophy className="size-4" /> {BUSINESS.origin}
        </motion.div>
      </div>

      <div className="relative mt-12 grid gap-8 lg:grid-cols-2">
        {BUSINESS.team.map((f, i) => (
          <motion.article key={f.name} initial={{ opacity: 0, y: 40, rotate: i ? 2 : -2 }} whileInView={{ opacity: 1, y: 0, rotate: 0 }}
            viewport={{ once: true, margin: "-60px" }} transition={{ type: "spring", stiffness: 140, damping: 18, delay: 0.15 * i }}
            whileHover={reduce ? undefined : { y: -6 }}
            className="group relative rounded-[26px] p-[3px]">
            {/* animated gradient border */}
            <div aria-hidden className={`absolute inset-0 rounded-[26px] bg-gradient-to-br ${GRAD[i]} opacity-90`} />
            <div className="relative h-full rounded-[23px] bg-[#1b1530] p-6 md:p-8">
              <div className="flex flex-col items-center gap-5 text-center sm:flex-row sm:items-start sm:text-left">
                {/* monogram with orbiting ring */}
                <div className="relative shrink-0">
                  <motion.div aria-hidden className={`absolute -inset-3 rounded-full bg-conic ${GRAD[i]} opacity-80 blur-[2px]`}
                    style={{ maskImage: "radial-gradient(circle, transparent 58%, black 60%)", WebkitMaskImage: "radial-gradient(circle, transparent 58%, black 60%)" }}
                    animate={reduce ? undefined : { rotate: 360 }} transition={{ repeat: Infinity, duration: 8 - i * 2, ease: "linear" }} />
                  <div className="relative grid size-28 place-items-center rounded-full border-[3px] border-white/80 font-display text-4xl font-extrabold text-[#121212]"
                    style={{ background: `radial-gradient(circle at 30% 25%, #fff 0%, ${GLOW[i]} 55%, ${i ? "#7ee8c8" : "#ff8a3d"} 100%)`, boxShadow: `0 0 40px ${GLOW[i]}88` }}>
                    {f.initials}
                  </div>
                  <span className="absolute -bottom-1 -right-1 grid size-9 place-items-center rounded-full border-2 border-[#121212] bg-[#ffd23f] text-[#121212]">
                    {i === 0 ? <Rocket className="size-4" /> : <Crown className="size-4" />}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <span className={`inline-block rounded-full bg-gradient-to-r ${GRAD[i]} px-3 py-1 text-xs font-extrabold uppercase tracking-wider text-[#121212]`}>{f.role}</span>
                  <h3 className="mt-2 font-display text-3xl font-extrabold tracking-tight md:text-4xl">{f.name}</h3>
                  <p className="mt-1 font-semibold text-white/80 italic">{f.tagline}</p>
                </div>
              </div>
              {!compact && <p className="mt-5 leading-relaxed text-white/75">{f.bio}</p>}
              <ul className="mt-5 grid gap-2 sm:grid-cols-2">
                {f.highlights.slice(0, compact ? 2 : 4).map((h) => (
                  <li key={h} className="flex items-start gap-2 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white/85">
                    <Star className="mt-0.5 size-4 shrink-0 fill-[#ffd23f] text-[#ffd23f]" />{h}
                  </li>
                ))}
              </ul>
              <div className="mt-5 flex flex-wrap items-center gap-2">
                <a href={`mailto:${f.email}`} className="inline-flex items-center gap-1.5 rounded-xl border-2 border-white/40 bg-white/10 px-3 py-1.5 text-sm font-bold text-white transition hover:bg-white hover:text-[#121212]">
                  <Mail className="size-4" />{f.email}
                </a>
              </div>
            </div>
          </motion.article>
        ))}
      </div>

      {compact && (
        <div className="relative mt-10 text-center">
          <Link href="/about" className="inline-flex items-center gap-2 rounded-2xl border-[3px] border-[#121212] bg-[#ffd23f] px-6 py-3 font-display text-lg font-extrabold text-[#121212] shadow-[4px_4px_0_#000] transition hover:-translate-y-0.5">
            <Sparkles className="size-5" /> Meet the founders
          </Link>
        </div>
      )}
    </section>
  );
}
