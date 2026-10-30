"use client";

import clsx from "clsx";
import { ArrowLeft, ChevronDown, ChevronsLeft, ChevronsRight, LayoutDashboard, Zap, type LucideIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { usePersistent } from "@/lib/api";
import { AuroraOrb } from "./aurora/AuroraOrb";
import { Logo, LogoMark } from "./Logo";
import { ThemeToggle } from "./theme";

export interface NavItem { id: string; label: string; q: string; icon: LucideIcon; color: string; n?: number; badge?: string }
export interface NavGroup { id: string; title: string; items: NavItem[] }

const spring = { type: "spring", stiffness: 420, damping: 34 } as const;

function Item({ it, active, rail, onClick }: { it: NavItem; active: boolean; rail: boolean; onClick: () => void }) {
  const [hover, setHover] = useState(false);
  const dark = it.color.includes("text-white");
  return (
    <motion.button onClick={onClick} onHoverStart={() => setHover(true)} onHoverEnd={() => setHover(false)} whileTap={{ scale: 0.96 }}
      className={clsx("group relative flex w-full items-center gap-3 rounded-2xl px-2.5 py-2 text-left", rail && "justify-center px-0")}>
      {active && (
        <motion.span layoutId="nav-active" transition={spring}
          className={clsx("absolute inset-0 rounded-2xl border-[2.5px] border-edge shadow-[4px_4px_0_var(--shadow-c)]", it.color)} />
      )}
      {!active && hover && <motion.span layoutId="nav-hover" transition={spring} className="absolute inset-0 rounded-2xl bg-surface-2" />}
      <motion.span animate={hover && !active ? { rotate: [0, -12, 10, 0] } : { rotate: 0 }} transition={{ duration: 0.45 }}
        className={clsx("relative grid size-9 shrink-0 place-items-center rounded-xl border-2 border-edge font-display text-sm font-extrabold",
          active ? "bg-surface text-ink" : "bg-surface-2 text-ink")}>
        {it.n && !active ? it.n : <it.icon className="size-4" />}
        {it.badge && rail && <span className="absolute -right-1.5 -top-1.5 size-2.5 animate-ping rounded-full bg-pink" />}
      </motion.span>
      {!rail && (
        <span className={clsx("relative min-w-0 flex-1", active && (dark ? "text-white" : "text-[#121212]"))}>
          <span className="flex items-center gap-1.5 font-display text-[15px] font-extrabold leading-tight">
            {it.label}
            {it.badge && (
              <motion.span animate={{ scale: [1, 1.12, 1] }} transition={{ repeat: Infinity, duration: 1.8 }}
                className="rounded-full border-2 border-edge bg-yellow px-1.5 text-[9px] font-extrabold uppercase leading-4 text-[#121212]">{it.badge}</motion.span>
            )}
          </span>
          <span className={clsx("block truncate text-xs", active ? "opacity-80" : "text-muted")}>{it.q}</span>
        </span>
      )}
      <AnimatePresence>
        {rail && hover && (
          <motion.span initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -6 }}
            className="pointer-events-none absolute left-full z-50 ml-3 whitespace-nowrap rounded-xl border-2 border-edge bg-ink px-2.5 py-1 font-display text-xs font-extrabold text-bg shadow-[3px_3px_0_var(--shadow-c)]">
            {it.label}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
}

export function Sidebar({ tab, go, groups, onSlay, onAzora, footer }: {
  tab: string; go: (id: string) => void; groups: NavGroup[]; onSlay: () => void; onAzora: () => void; footer: ReactNode;
}) {
  const [rail, setRail] = usePersistent("navRail", false);
  const [closed, setClosed] = usePersistent<Record<string, boolean>>("navClosed", {});
  const home: NavItem = { id: "home", label: "Home", q: "Your dashboard", icon: LayoutDashboard, color: "bg-violet text-white" };
  return (
    <motion.aside animate={{ width: rail ? 88 : 272 }} transition={spring}
      className="fixed inset-y-0 left-0 z-30 hidden flex-col border-r-[2.5px] border-edge bg-surface lg:flex">
      <motion.div className="h-1 bg-[linear-gradient(90deg,var(--pink),var(--yellow),var(--lime),var(--blue),var(--violet),var(--pink))] bg-[length:200%_100%]"
        animate={{ backgroundPositionX: ["0%", "200%"] }} transition={{ repeat: Infinity, duration: 6, ease: "linear" }} />
      <div className={clsx("flex items-center border-b-[2.5px] border-edge py-4", rail ? "justify-center px-2" : "justify-between px-5")}>
        <motion.div whileHover={{ rotate: [0, -6, 6, 0] }}>{rail ? <LogoMark /> : <Logo />}</motion.div>
        {!rail && (
          <motion.button whileHover={{ x: -3 }} whileTap={{ scale: 0.9 }} onClick={() => setRail(true)} title="Collapse sidebar"
            className="rounded-lg p-1 text-muted hover:bg-surface-2 hover:text-ink"><ChevronsLeft className="size-5" /></motion.button>
        )}
      </div>
      {rail && (
        <motion.button whileHover={{ x: 3 }} whileTap={{ scale: 0.9 }} onClick={() => setRail(false)} title="Expand sidebar"
          className="mx-auto mt-2 rounded-lg p-1 text-muted hover:bg-surface-2 hover:text-ink"><ChevronsRight className="size-5" /></motion.button>
      )}
      <nav className={clsx("flex-1 space-y-1 overflow-y-auto overflow-x-visible py-3", rail ? "px-3" : "px-3.5")}>
        <Item it={home} active={tab === "home"} rail={rail} onClick={() => go("home")} />
        {groups.map((g) => {
          const open = rail || !closed[g.id];
          return (
            <div key={g.id} className="pt-2">
              {!rail ? (
                <button onClick={() => setClosed({ ...closed, [g.id]: !closed[g.id] })}
                  className="flex w-full items-center gap-1 px-1.5 pb-1 font-display text-[11px] font-extrabold uppercase tracking-widest text-muted hover:text-ink">
                  {g.title}
                  <motion.span animate={{ rotate: open ? 0 : -90 }} className="ml-auto"><ChevronDown className="size-3.5" /></motion.span>
                </button>
              ) : <div className="mx-auto my-1 h-0.5 w-8 rounded bg-line" />}
              <AnimatePresence initial={false}>
                {open && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.22 }} className="space-y-1 overflow-visible">
                    {g.items.map((it) => <Item key={it.id} it={it} active={tab === it.id} rail={rail} onClick={() => go(it.id)} />)}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
        <div className="space-y-2 pt-4">
          <motion.button onClick={onSlay} whileHover={{ rotate: -1.5, scale: 1.02 }} whileTap={{ scale: 0.95 }} title="Slay it (S)"
            className={clsx("btn-brut flex w-full items-center justify-center gap-2 rounded-2xl bg-pink font-display font-extrabold text-[#121212]", rail ? "py-3" : "px-4 py-3 text-lg")}>
            <Zap className="size-5" />{!rail && <>Slay it <kbd className="ml-1 rounded-md border-2 border-[#121212] bg-white/70 px-1.5 text-[11px]">S</kbd></>}
          </motion.button>
          <motion.button onClick={onAzora} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.96 }} title="Ask Azora AI (A)"
            className={clsx("btn-brut flex w-full items-center gap-3 rounded-2xl bg-surface text-left", rail ? "justify-center py-2" : "px-3 py-2")}>
            <AuroraOrb size={rail ? 30 : 34} />
            {!rail && <span><span className="block font-display text-[15px] font-extrabold leading-tight">Ask Azora AI</span>
              <span className="block text-xs text-muted">brainstorm & run tools</span></span>}
          </motion.button>
        </div>
      </nav>
      <div className={clsx("space-y-3 border-t-[2.5px] border-edge py-3", rail ? "px-2" : "px-4")}>
        {!rail && footer}
        <div className={clsx("flex items-center", rail ? "flex-col gap-2" : "justify-between")}>
          <Link href="/" className="inline-flex items-center gap-1 text-xs font-bold text-ink-2 hover:text-ink" title="Landing page">
            <ArrowLeft className="size-3.5" />{!rail && "Home"}
          </Link>
          <ThemeToggle />
        </div>
      </div>
    </motion.aside>
  );
}

export function useRailWidth() {
  const [rail] = usePersistent("navRail", false);
  return rail ? 88 : 272;
}
