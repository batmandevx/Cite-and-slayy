"use client";

import clsx from "clsx";
import { useEffect, useState } from "react";

/** Sticky table of contents that highlights the section you're reading. */
export function Toc({ items }: { items: { id: string; title: string }[] }) {
  const [active, setActive] = useState(items[0]?.id);
  useEffect(() => {
    const obs = new IntersectionObserver((entries) => {
      const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (vis[0]) setActive(vis[0].target.id);
    }, { rootMargin: "-20% 0px -65% 0px" });
    items.forEach((i) => { const el = document.getElementById(i.id); if (el) obs.observe(el); });
    return () => obs.disconnect();
  }, [items]);
  return (
    <nav aria-label="On this page" className="card sticky top-6 p-4">
      <div className="mb-2 text-[11px] font-extrabold uppercase tracking-widest text-muted">On this page</div>
      <ol className="space-y-0.5 text-sm">
        {items.map((i, n) => (
          <li key={i.id}>
            <a href={`#${i.id}`} className={clsx("flex gap-2 rounded-lg px-2 py-1.5 font-semibold transition",
              active === i.id ? "bg-lime text-[#121212]" : "text-ink-2 hover:bg-surface-2 hover:text-ink")}>
              <span className="w-5 shrink-0 tabular-nums opacity-60">{n + 1}.</span>{i.title}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
