"use client";

import { Crown, Mail, Rocket, Sparkles } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useState } from "react";
import { BUSINESS } from "@/lib/business";

const pop = { type: "spring", stiffness: 260, damping: 18 } as const;

// Loaded only when someone finds the easter egg on the team's card.
const HorseRide = dynamic(() => import("./easter/HorseRide"), { ssr: false });

// Per-founder colours from the Slay Pop palette (flat fills, black outlines, hard shadows).
const LOOK = [
  { banner: "bg-pink", tile: "bg-yellow", sticker: "bg-lime", tilt: -2, Icon: Rocket },
  { banner: "bg-lime", tile: "bg-mint", sticker: "bg-yellow", tilt: 2, Icon: Crown },
];

/** "Meet the founders" in the site's neo-brutalist style. `compact` is the home-page version. */
export function FoundersSpotlight({ compact = false }: { compact?: boolean }) {
  const reduce = useReducedMotion();
  const [ride, setRide] = useState(false);
  const names = BUSINESS.team.flatMap((f) => [f.name, f.role]);
  return (
    <section className="relative">
      <div className="text-center">
        <motion.span initial={{ opacity: 0, y: 20, rotate: -8 }} whileInView={{ opacity: 1, y: 0, rotate: -3 }} viewport={{ once: true }} transition={pop}
          className="sticker bg-yellow">
          <Crown className="size-4" /> Meet the founders
        </motion.span>
        <motion.h2 initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ ...pop, delay: 0.08 }}
          className="mx-auto mt-5 max-w-3xl font-display text-4xl font-extrabold leading-[1.02] tracking-tight md:text-6xl">
          The minds behind <span className="gradient-text">Cite &amp; Slayy</span>
        </motion.h2>
        <p className="mx-auto mt-3 max-w-xl text-lg text-ink-2">Two founders, one mission: research you can trust, for everyone.</p>
      </div>

      <div className="mx-auto mt-12 grid max-w-5xl gap-10 md:grid-cols-2 md:gap-12">
        {BUSINESS.team.map((f, i) => {
          const l = LOOK[i];
          return (
            <motion.article key={f.name} initial={{ opacity: 0, y: 50, rotate: l.tilt * 3, scale: 0.94 }}
              whileInView={{ opacity: 1, y: 0, rotate: l.tilt, scale: 1 }} viewport={{ once: true, margin: "-60px" }}
              transition={{ ...pop, delay: 0.12 * i }} whileHover={reduce ? undefined : { rotate: 0, y: -6 }}
              onClick={i === 1 ? (e) => { if (!(e.target as HTMLElement).closest("a")) setRide(true); } : undefined}
              className={`card card-pop overflow-hidden p-0 ${i === 1 ? "cursor-pointer" : ""}`}>
              {/* banner with halftone dots */}
              <div className={`relative h-32 border-b-[2.5px] border-edge ${l.banner}`}
                style={{ backgroundImage: "radial-gradient(rgba(18,18,18,.18) 1.4px, transparent 1.6px)", backgroundSize: "14px 14px" }}>
                <motion.span animate={reduce ? undefined : { rotate: [8, -4, 8], y: [0, -4, 0] }} transition={{ repeat: Infinity, duration: 3.4, ease: "easeInOut" }}
                  className={`sticker absolute right-4 top-4 ${l.sticker}`}>
                  <l.Icon className="size-4" /> {f.role}
                </motion.span>
                <Sparkles className="wobble absolute bottom-3 right-6 size-7 text-[#121212]" />
              </div>

              <div className="relative px-6 pb-7 md:px-8">
                {/* big initials tile overlapping the banner */}
                <motion.div initial={{ scale: 0.6, rotate: -12 }} whileInView={{ scale: 1, rotate: i ? 4 : -4 }} viewport={{ once: true }}
                  transition={{ ...pop, delay: 0.2 + 0.12 * i }}
                  className={`-mt-16 grid size-28 place-items-center rounded-3xl border-[3px] border-edge font-display text-5xl font-extrabold text-[#121212] shadow-[6px_6px_0_var(--shadow-c)] md:size-32 md:text-6xl ${l.tile}`}>
                  {f.initials}
                </motion.div>

                <h3 className="mt-5 font-display text-4xl font-extrabold leading-none tracking-tight md:text-5xl">{f.name}</h3>
                <p className="mt-3 text-lg font-semibold text-ink-2">{f.tagline}</p>

                {!compact && (
                  <a href={`mailto:${f.email}`} className="btn-brut mt-6 inline-flex items-center gap-2 rounded-xl bg-surface px-4 py-2 text-sm font-bold">
                    <Mail className="size-4" />{f.email}
                  </a>
                )}
              </div>
            </motion.article>
          );
        })}
      </div>

      {/* name marquee, like the landing page strips */}
      <div className="marquee mt-14 -rotate-1 border-y-[2.5px] border-edge bg-yellow py-3 text-[#121212]">
        <div className="marquee__track font-display text-xl font-extrabold uppercase tracking-tight md:text-2xl">
          {[...names, ...names, ...names].map((t, k) => (
            <span key={k} className="inline-flex items-center gap-10">{t} <Sparkles className="size-5 shrink-0" /></span>
          ))}
        </div>
      </div>

      {ride && <HorseRide onDone={() => setRide(false)} />}

      {compact && (
        <div className="mt-10 text-center">
          <Link href="/about" className="btn-brut inline-flex items-center gap-2 rounded-2xl bg-pink px-6 py-3 font-display text-lg font-extrabold text-[#121212]">
            <Sparkles className="size-5" /> More about us
          </Link>
        </div>
      )}
    </section>
  );
}
