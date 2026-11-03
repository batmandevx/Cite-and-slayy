"use client";

import { Play, Volume2, VolumeX } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

const pop = { type: "spring", stiffness: 260, damping: 18 } as const;

/** A muted, looping clip that only loads and plays while it is on screen; tap to hear it. */
function Clip({ src, poster, label, className }: { src: string; poster: string; label: string; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const reduce = useReducedMotion();
  const [muted, setMuted] = useState(true);
  const [paused, setPaused] = useState(true);

  useEffect(() => {
    const v = ref.current; if (!v) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !reduce) { v.preload = "auto"; void v.play().catch(() => {}); }
      else v.pause();
    }, { threshold: 0.35 });
    io.observe(v);
    return () => io.disconnect();
  }, [reduce]);

  const toggleSound = () => {
    const v = ref.current; if (!v) return;
    v.muted = !v.muted; setMuted(v.muted);
    if (!v.muted) { v.currentTime = 0; void v.play().catch(() => {}); }
  };

  return (
    <div className={`group relative overflow-hidden ${className ?? ""}`}>
      <video ref={ref} src={src} poster={poster} muted loop playsInline preload="none" aria-label={label}
        onPlay={() => setPaused(false)} onPause={() => setPaused(true)} onClick={toggleSound}
        className="block h-full w-full cursor-pointer object-cover" />
      {paused && (
        <button type="button" onClick={() => { void ref.current?.play(); }} aria-label={`Play: ${label}`}
          className="absolute inset-0 grid place-items-center bg-black/10">
          <span className="grid size-16 place-items-center rounded-full border-[3px] border-edge bg-pink text-[#121212] shadow-[4px_4px_0_var(--shadow-c)]">
            <Play className="size-7 translate-x-0.5" />
          </span>
        </button>
      )}
      <button type="button" onClick={toggleSound} aria-label={muted ? "Turn sound on" : "Mute"}
        className="btn-brut absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-xl bg-surface px-3 py-1.5 text-xs font-extrabold">
        {muted ? <><VolumeX className="size-4" /> Tap for sound</> : <><Volume2 className="size-4" /> Sound on</>}
      </button>
    </div>
  );
}

/** "Watch it work": the 23-second walkthrough beside the 60-second vertical reel. */
export function VideoShowcase() {
  return (
    <section id="watch" className="mx-auto max-w-[1240px] scroll-mt-24 px-5 pt-16">
      <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={pop} className="mb-10 text-center">
        <div className="sticker mx-auto mb-4 -rotate-2 bg-lime text-[#121212]"><Play className="size-4" /> Watch it work</div>
        <h2 className="font-display text-4xl font-extrabold md:text-5xl">From topic to verdict, <span className="gradient-text">in seconds.</span></h2>
        <p className="mx-auto mt-3 max-w-2xl text-lg text-ink-2">A fake reference caught, a full paper written, a retracted paper flagged and a clear submit decision. Real screens from the app.</p>
      </motion.div>

      <div className="grid items-center gap-8 lg:grid-cols-[1fr_320px]">
        <motion.div initial={{ opacity: 0, y: 40, rotate: -2 }} whileInView={{ opacity: 1, y: 0, rotate: -1 }} viewport={{ once: true, margin: "-60px" }} transition={pop}>
          <div className="card card-pop overflow-hidden p-0">
            <div className="flex items-center gap-2 border-b-[2.5px] border-edge bg-surface-2 px-4 py-2.5">
              <span className="size-3 rounded-full border-2 border-edge bg-crit" /><span className="size-3 rounded-full border-2 border-edge bg-yellow" /><span className="size-3 rounded-full border-2 border-edge bg-lime" />
              <span className="ml-2 font-display text-sm font-extrabold">The 23-second tour</span>
            </div>
            <Clip src="/videos/citeslayy-demo.mp4" poster="/videos/citeslayy-demo.jpg" label="Cite & Slayy in 23 seconds" className="aspect-video" />
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 40, rotate: 4 }} whileInView={{ opacity: 1, y: 0, rotate: 2 }} viewport={{ once: true, margin: "-60px" }} transition={{ ...pop, delay: 0.1 }}
          className="mx-auto w-full max-w-[300px]">
          {/* phone frame for the vertical reel */}
          <div className="rounded-[2.4rem] border-[3px] border-edge bg-[#121212] p-2.5 shadow-[8px_8px_0_var(--shadow-c)]">
            <div className="relative overflow-hidden rounded-[1.9rem]">
              <span className="absolute left-1/2 top-2 z-10 h-5 w-24 -translate-x-1/2 rounded-full bg-[#121212]" aria-hidden />
              <Clip src="/videos/citeslayy-reel.mp4" poster="/videos/citeslayy-reel.jpg" label="Cite & Slayy, the one-minute reel" className="aspect-[9/16]" />
            </div>
          </div>
          <div className="mt-4 text-center"><span className="sticker rotate-2 bg-pink text-[#121212]">The 1-minute reel</span></div>
        </motion.div>
      </div>
    </section>
  );
}
