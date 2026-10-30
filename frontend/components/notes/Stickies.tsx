"use client";

import clsx from "clsx";
import { Heart, LayoutGrid, Pin, Search, Sparkles, StickyNote, X } from "lucide-react";
import { AnimatePresence, animate, motion, useMotionValue } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { api, toast, apiFetch } from "@/lib/api";
import { assist, AssistMenu } from "../AssistMenu";
import { Button } from "../ui";
import { useWorkspace } from "./useWorkspace";

export interface Sticky { id: string; text: string; color: string; x: number; y: number; rot: number; votes?: number; shape?: "square" | "round" }
export const STICKY_COLORS = ["#ffd23f", "#ff9ecf", "#c6f24e", "#9fd8ff", "#ffb38a", "#c9b6ff"];
const uid = () => Math.random().toString(36).slice(2, 10);
const W = 210, H = 190;

function Card({ n, board, dim, onPatch, onRemove, onPin }: {
  n: Sticky; board: React.RefObject<HTMLDivElement | null>; dim: boolean;
  onPatch: (p: Partial<Sticky>) => void; onRemove: () => void; onPin: () => void;
}) {
  const mx = useMotionValue(n.x), my = useMotionValue(n.y);
  // follow external moves (Tidy up) with a spring; after a drag the stored position already equals the motion value
  useEffect(() => {
    if (mx.get() !== n.x) animate(mx, n.x, { type: "spring", stiffness: 160, damping: 20 });
    if (my.get() !== n.y) animate(my, n.y, { type: "spring", stiffness: 160, damping: 20 });
  }, [n.x, n.y, mx, my]);
  return (
    <motion.div drag dragMomentum={false} dragConstraints={board} dragElastic={0.08}
      initial={{ scale: 0, rotate: n.rot - 20, opacity: 0 }} animate={{ scale: 1, rotate: n.rot, opacity: dim ? 0.25 : 1 }} exit={{ scale: 0, rotate: 30, opacity: 0 }}
      whileHover={{ scale: 1.04, zIndex: 20 }} whileDrag={{ scale: 1.1, rotate: 0, zIndex: 30, boxShadow: "10px 10px 0 #121212" }}
      transition={{ type: "spring", stiffness: 260, damping: 18 }}
      onDragEnd={() => onPatch({ x: mx.get(), y: my.get() })}
      style={{ x: mx, y: my, left: 0, top: 0, background: n.color, width: W }}
      className={clsx("absolute cursor-grab border-[2.5px] border-[#121212] p-3 pt-5 text-[#121212] shadow-[5px_5px_0_#121212] active:cursor-grabbing",
        n.shape === "round" ? "rounded-[40%_45%_42%_48%]" : "rounded-md")}>
      <span className="absolute left-1/2 top-[-9px] h-4 w-12 -translate-x-1/2 rotate-[-3deg] rounded-sm border-2 border-[#121212] bg-white/70" />
      <div className="absolute right-1.5 top-1.5 flex items-center gap-0.5">
        <button title="Pin to any screen" onClick={onPin} className="rounded p-0.5 opacity-50 hover:opacity-100"><Pin className="size-3.5" /></button>
        <button title="Delete" onClick={onRemove} className="rounded p-0.5 opacity-50 hover:opacity-100"><X className="size-3.5" /></button>
      </div>
      <textarea value={n.text} placeholder="Idea, quote, question…" onPointerDown={(e) => e.stopPropagation()}
        onChange={(e) => onPatch({ text: e.target.value })}
        className="h-28 w-full resize-none bg-transparent font-display text-[15px] font-bold leading-snug outline-none placeholder:text-[#121212]/40" />
      <div className="flex items-center gap-1">
        {STICKY_COLORS.map((c) => (
          <button key={c} onClick={() => onPatch({ color: c })}
            className={clsx("size-3.5 rounded-full border-2 border-[#121212]", c === n.color && "ring-2 ring-[#121212] ring-offset-1")} style={{ background: c }} />
        ))}
        <span className="flex-1" />
        <motion.button whileTap={{ scale: 1.5 }} onClick={() => onPatch({ votes: (n.votes ?? 0) + 1 })} title="Vote"
          className="inline-flex items-center gap-0.5 text-[11px] font-extrabold">
          <Heart className={clsx("size-3.5", (n.votes ?? 0) > 0 && "fill-[#e5484d] text-[#e5484d]")} />{n.votes || ""}
        </motion.button>
        <AssistMenu compact dark actions={["expand", "ideas", "improve", "explain"]} getText={() => n.text}
          onResult={(t, a) => onPatch({ text: a === "improve" ? t : `${n.text}\n\n${t}` })} />
      </div>
    </motion.div>
  );
}

export function StickyBoard() {
  const [notes, update] = useWorkspace<Sticky>("stickies");
  const board = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState("");
  const [topic, setTopic] = useState("");
  const [brain, setBrain] = useState(false);
  const patch = (id: string, p: Partial<Sticky>) => update((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const spot = (i = 0) => {
    const w = board.current?.clientWidth ?? 900;
    return { x: 24 + Math.random() * Math.max(40, w - W - 48), y: 24 + Math.random() * 300 + i * 6 };
  };
  const add = (text = "", color?: string) => update((xs) => [...xs, { id: uid(), text, color: color ?? STICKY_COLORS[xs.length % STICKY_COLORS.length],
    ...spot(xs.length), rot: Math.round(Math.random() * 8 - 4), shape: Math.random() < 0.15 ? "round" : "square" }]);
  const tidy = () => {
    const w = board.current?.clientWidth ?? 900;
    const cols = Math.max(1, Math.floor((w - 24) / (W + 18)));
    update((xs) => [...xs].sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0) || STICKY_COLORS.indexOf(a.color) - STICKY_COLORS.indexOf(b.color))
      .map((n, i) => ({ ...n, x: 20 + (i % cols) * (W + 18), y: 20 + Math.floor(i / cols) * (H + 18), rot: 0 })));
  };
  const brainstorm = async () => {
    if (!topic.trim()) return;
    setBrain(true);
    const r = await assist("ideas", topic);
    setBrain(false);
    const lines = (r?.text ?? "").split("\n").map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").replace(/\*\*/g, "").trim()).filter((l) => l.length > 3).slice(0, 6);
    lines.forEach((l, i) => setTimeout(() => add(l, STICKY_COLORS[i % STICKY_COLORS.length]), i * 160));
    if (lines.length) toast({ title: `${lines.length} ideas stuck to your board`, tone: "good" });
  };
  const pinOut = async (n: Sticky) => {
    const cur = await api.get<{ items: unknown[] }>("/api/workspace/pins").catch(() => ({ items: [] }));
    const pin = { id: uid(), text: n.text, color: n.color, x: window.scrollX + 120, y: window.scrollY + 160, screen: "*", everywhere: true, min: false, rot: n.rot };
    await apiFetch(`/api/workspace/pins`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ items: [...cur.items, pin] }) });
    toast({ title: "Pinned to every screen 📌", body: "It will appear after the next page load.", tone: "good" });
  };
  if (!notes) return <div className="shimmer h-80 rounded-2xl" />;
  const match = (n: Sticky) => !q || n.text.toLowerCase().includes(q.toLowerCase());
  const height = Math.max(640, ...notes.map((n) => n.y + H + 40));
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex flex-1 items-center gap-2 rounded-xl border-[2.5px] border-edge bg-surface px-2 py-1 shadow-[3px_3px_0_var(--shadow-c)]">
          <Sparkles className="size-4 text-pink" />
          <input value={topic} onChange={(e) => setTopic(e.target.value)} onKeyDown={(e) => e.key === "Enter" && brainstorm()}
            placeholder="AI brainstorm: type a topic and get 5 idea stickies…" className="min-w-0 flex-1 bg-transparent py-1 text-sm outline-none" />
          <Button variant="primary" className="!px-3 !py-1.5 text-xs" loading={brain} onClick={brainstorm}>Brainstorm</Button>
        </div>
        <div className="flex items-center gap-1.5 rounded-xl border-[2.5px] border-edge bg-surface px-2 py-1">
          <Search className="size-4 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter" className="w-24 bg-transparent py-1 text-sm outline-none" />
        </div>
        <Button onClick={tidy}><LayoutGrid className="size-4" />Tidy up</Button>
        <Button variant="lime" onClick={() => add()}><StickyNote className="size-4" />New sticky</Button>
      </div>
      <div ref={board} style={{ height }} className="card relative overflow-hidden !bg-[repeating-linear-gradient(0deg,transparent_0_27px,var(--line)_27px_28px)]">
        <AnimatePresence>
          {notes.map((n) => (
            <Card key={n.id} n={n} board={board} dim={!match(n)} onPatch={(p) => patch(n.id, p)}
              onRemove={() => update((xs) => xs.filter((x) => x.id !== n.id))} onPin={() => pinOut(n)} />
          ))}
        </AnimatePresence>
        {notes.length === 0 && (
          <div className="absolute inset-0 grid place-items-center text-center text-muted">
            <div><StickyNote className="wobble mx-auto mb-2 size-12" /><div className="font-display text-lg font-extrabold">Empty board</div>
              <div className="text-sm">Add a sticky, or let Azora AI brainstorm a topic for you.</div></div>
          </div>
        )}
      </div>
      <p className="mt-2 text-xs text-muted">Tip: hearts sort the best ideas first when you Tidy up. 📌 sends a note to every screen of the app.</p>
    </div>
  );
}
