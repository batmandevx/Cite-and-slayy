"use client";

import clsx from "clsx";
import { motion } from "motion/react";

/** Azora AI's animated sentient avatar: morphing aurora core + orbital ring + expressive eyes / equalizer. */
export function AuroraOrb({
  size = 40, thinking, ring, className,
}: {
  size?: number; thinking?: boolean; ring?: boolean; className?: string;
}) {
  const showOrbit = size >= 36 || ring;
  const eyeW = Math.max(2.5, Math.round(size * 0.085));
  const eyeH = Math.max(4, Math.round(size * 0.17));

  return (
    <span
      aria-hidden
      className={clsx("aurora-orb relative inline-grid shrink-0 place-items-center select-none", thinking && "is-thinking", ring && "ring", className)}
      style={{ width: size, height: size }}
    >
      {showOrbit && (
        <svg
          viewBox="0 0 100 100"
          className="aurora-orbit pointer-events-none absolute -inset-[12%] size-[124%]"
        >
          <circle
            cx="50"
            cy="50"
            r="46"
            fill="none"
            stroke="currentColor"
            strokeOpacity={thinking ? 0.48 : 0.22}
            strokeWidth="2"
            strokeDasharray="8 10"
          />
          <circle cx="50" cy="4" r="4.5" fill="#ff4fa3" stroke="#121212" strokeWidth="1.8" />
          <circle cx="96" cy="50" r="3.6" fill="#c6f24e" stroke="#121212" strokeWidth="1.8" />
        </svg>
      )}

      {/* Expressive core face / telemetry waveform */}
      <span className="relative z-10 flex items-center justify-center gap-[2.5px]">
        {thinking ? (
          [0, 1, 2, 3].map((i) => (
            <motion.span
              key={i}
              className="rounded-full bg-[#121212] shadow-[0_0_4px_rgba(255,255,255,0.85)]"
              style={{ width: Math.max(2, size * 0.07) }}
              animate={{
                height: [size * 0.12, size * 0.34, size * 0.15, size * 0.28, size * 0.12],
              }}
              transition={{
                duration: 0.85,
                repeat: Infinity,
                delay: i * 0.12,
                ease: "easeInOut",
              }}
            />
          ))
        ) : (
          <>
            <span
              className="aurora-eye rounded-full bg-[#121212] shadow-[0_0_6px_rgba(255,255,255,0.9)]"
              style={{ width: eyeW, height: eyeH }}
            />
            <span style={{ width: Math.max(3, size * 0.09) }} />
            <span
              className="aurora-eye rounded-full bg-[#121212] shadow-[0_0_6px_rgba(255,255,255,0.9)]"
              style={{ width: eyeW, height: eyeH }}
            />
          </>
        )}
      </span>
    </span>
  );
}
