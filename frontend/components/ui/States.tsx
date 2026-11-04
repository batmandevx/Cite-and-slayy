import clsx from "clsx";
import type { ReactNode } from "react";

/** A grey placeholder block that shimmers while content loads (still when reduced motion is on). */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={clsx("shimmer rounded-xl bg-surface-2", className)} />;
}

/** A card-shaped placeholder: heading line, two text lines and a button. */
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div aria-hidden className={clsx("card space-y-3 p-5", className)}>
      <Skeleton className="h-5 w-2/5" />
      <Skeleton className="h-3.5 w-full" />
      <Skeleton className="h-3.5 w-4/5" />
      <Skeleton className="mt-2 h-9 w-28 rounded-xl" />
    </div>
  );
}

/** Placeholder for the whole signed-in workspace (sidebar + header + cards), shown while the app boots. */
export function AppShellSkeleton() {
  return (
    <div role="status" aria-live="polite" className="min-h-screen">
      <span className="sr-only">Loading Cite &amp; Slayy…</span>
      <aside aria-hidden className="fixed inset-y-0 left-0 hidden w-[260px] flex-col gap-3 border-r-[2.5px] border-edge bg-surface p-4 lg:flex">
        <div className="flex items-center gap-2.5"><Skeleton className="size-10 rounded-xl" /><Skeleton className="h-5 w-28" /></div>
        <Skeleton className="mt-3 h-11 w-full rounded-2xl" />
        {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-9 w-full" />)}
        <div className="mt-auto space-y-2"><Skeleton className="h-16 w-full rounded-2xl" /><Skeleton className="h-10 w-full" /></div>
      </aside>
      <header aria-hidden className="flex items-center justify-between border-b-[2.5px] border-edge bg-surface px-3 py-2.5 lg:hidden">
        <div className="flex items-center gap-2"><Skeleton className="size-10" /><Skeleton className="size-10" /></div>
        <div className="flex gap-2"><Skeleton className="h-10 w-20" /><Skeleton className="size-10" /></div>
      </header>
      <main aria-hidden className="px-4 pt-6 sm:px-6 lg:ml-[260px] lg:px-10 lg:pt-8">
        <div className="mx-auto max-w-[1280px] space-y-6">
          <div className="flex items-center gap-3"><Skeleton className="size-11 rounded-2xl" /><div className="space-y-2"><Skeleton className="h-3 w-24" /><Skeleton className="h-5 w-44" /></div></div>
          <Skeleton className="h-40 w-full rounded-3xl" />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <SkeletonCard key={i} />)}</div>
        </div>
      </main>
    </div>
  );
}

/** Friendly "nothing here yet" panel with an optional next step. */
export function EmptyState({ icon, title, children, action, compact, className }: {
  icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode; compact?: boolean; className?: string;
}) {
  return (
    <div className={clsx("flex flex-col items-center text-center", compact ? "gap-1.5 px-3 py-5" : "gap-3 rounded-2xl border-[2.5px] border-dashed border-edge/60 px-6 py-10", className)}>
      {icon && <span className={clsx("grid place-items-center rounded-2xl border-2 border-edge bg-yellow text-[#121212] shadow-[3px_3px_0_var(--shadow-c)]", compact ? "size-9 [&>svg]:size-4" : "size-12 [&>svg]:size-6")}>{icon}</span>}
      <div className={clsx("font-display font-extrabold", compact ? "text-sm" : "text-lg")}>{title}</div>
      {children && <div className={clsx("max-w-sm text-muted", compact ? "text-xs" : "text-sm")}>{children}</div>}
      {action}
    </div>
  );
}
