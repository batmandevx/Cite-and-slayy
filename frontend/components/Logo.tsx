import clsx from "clsx";

/** Slay Pop logo: a chunky quote mark ("cite") with a sparkle ("slay"). */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={clsx("size-10 shrink-0", className)} aria-hidden>
      <rect x="2" y="2" width="36" height="36" rx="10" fill="#121212" />
      <rect x="0" y="0" width="36" height="36" rx="10" fill="#ff4fa3" stroke="#121212" strokeWidth="2.5" />
      <path d="M9.5 23.5c0-4.6 2.4-8 6.1-9.5l1 1.9c-2 1.1-3.3 2.7-3.5 4.7h2.9v5.7H9.5v-2.8zm9.4 0c0-4.6 2.4-8 6.1-9.5l1 1.9c-2 1.1-3.3 2.7-3.5 4.7h2.9v5.7h-6.5v-2.8z" fill="#121212" />
      <path d="M28.5 5l1.1 2.8 2.8 1.1-2.8 1.1-1.1 2.8-1.1-2.8-2.8-1.1 2.8-1.1z" fill="#ffd23f" stroke="#121212" strokeWidth="1.2" />
    </svg>
  );
}

export function Logo({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark />
      {!compact && (
        <div className="leading-none">
          <div className="font-display text-[19px] font-extrabold tracking-tight">
            Cite <span className="text-pink">&amp;</span>{" "}
            <span className="inline-block -rotate-2 rounded-md border-2 border-edge bg-yellow px-1.5 text-[#121212]">Slayy</span>
          </div>
          <div className="mt-1.5 text-[11px] font-medium text-muted">cite it right · slay the review</div>
        </div>
      )}
    </div>
  );
}
