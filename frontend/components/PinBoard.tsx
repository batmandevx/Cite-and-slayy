"use client";

import clsx from "clsx";
import { Eye, EyeOff, Globe, Minus, Pin, Plus, StickyNote, X } from "lucide-react";
import { AnimatePresence, motion, useMotionValue } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, toast, apiFetch } from "@/lib/api";
import { AssistMenu } from "./AssistMenu";

/** Sticky notes you can drop anywhere in the app: click the pin button, or press Ctrl/⌘+V outside a text field
 *  to turn the clipboard into a note at the cursor. Notes belong to the current screen unless set to show everywhere. */
interface PinNote { id: string; text: string; color: string; x: number; y: number; screen: string; everywhere: boolean; min: boolean; rot: number }
const COLORS = ["#ffd23f", "#ff9ecf", "#c6f24e", "#9fd8ff", "#ffb38a", "#c9b6ff"];
const uid = () => Math.random().toString(36).slice(2, 10);

function PinCard({ n, patch, remove }: { n: PinNote; patch: (p: Partial<PinNote>) => void; remove: () => void }) {
  const mx = useMotionValue(n.x), my = useMotionValue(n.y);
  return (
            <motion.div drag dragMomentum={false}
              initial={{ scale: 0, rotate: n.rot - 25, opacity: 0 }} animate={{ scale: 1, rotate: n.rot, opacity: 1 }} exit={{ scale: 0, rotate: 25, opacity: 0 }}
              whileDrag={{ scale: 1.08, rotate: 0, boxShadow: "10px 10px 0 #121212", zIndex: 60 }} whileHover={{ zIndex: 55 }}
              transition={{ type: "spring", stiffness: 280, damping: 20 }}
              onDragEnd={() => patch({ x: Math.max(0, mx.get()), y: Math.max(0, my.get()) })}
              style={{ x: mx, y: my, left: 0, top: 0, background: n.color }}
              className={clsx("pointer-events-auto absolute cursor-grab rounded-md border-[2.5px] border-[#121212] text-[#121212] shadow-[5px_5px_0_#121212] active:cursor-grabbing",
                n.min ? "w-40" : "w-56")}>
              <span className="absolute left-1/2 top-[-9px] h-4 w-12 -translate-x-1/2 rotate-[-4deg] rounded-sm border-2 border-[#121212] bg-white/70" />
              <div className="flex items-center gap-1 px-2 pt-2.5">
                <button title={n.everywhere ? "Showing on every screen" : "Show on every screen"} onClick={() => patch({ everywhere: !n.everywhere })}
                  className={clsx("rounded p-0.5", n.everywhere ? "bg-[#121212] text-white" : "opacity-50 hover:opacity-100")}><Globe className="size-3" /></button>
                <span className="flex-1" />
                {!n.min && <AssistMenu compact dark actions={["expand", "ideas", "summarize", "improve"]} getText={() => n.text}
                  onResult={(t, a) => patch({ text: a === "improve" || a === "summarize" ? t : `${n.text}\n\n${t}` })} />}
                <button title={n.min ? "Expand" : "Minimise"} onClick={() => patch({ min: !n.min })} className="rounded p-0.5 opacity-50 hover:opacity-100">
                  {n.min ? <Plus className="size-3.5" /> : <Minus className="size-3.5" />}
                </button>
                <button title="Delete" onClick={remove} className="rounded p-0.5 opacity-50 hover:opacity-100"><X className="size-3.5" /></button>
              </div>
              {n.min ? (
                <div className="truncate px-2.5 pb-2 font-display text-sm font-bold">{n.text || "Empty note"}</div>
              ) : (
                <>
                  <textarea value={n.text} onChange={(e) => patch({ text: e.target.value })} onPointerDown={(e) => e.stopPropagation()}
                    placeholder="Type, or paste anything…" autoFocus={!n.text}
                    className="block h-32 w-full resize-y bg-transparent px-2.5 font-display text-[14px] font-bold leading-snug outline-none placeholder:text-[#121212]/40" />
                  <div className="flex gap-1 px-2.5 pb-2">
                    {COLORS.map((c) => (
                      <button key={c} onClick={() => patch({ color: c })} style={{ background: c }}
                        className={clsx("size-3.5 rounded-full border-2 border-[#121212]", c === n.color && "ring-2 ring-[#121212] ring-offset-1")} />
                    ))}
                  </div>
                </>
              )}
            </motion.div>
  );
}

export function PinBoard({ screen }: { screen: string }) {
  const [notes, setNotes] = useState<PinNote[]>([]);
  const [hidden, setHidden] = useState(false);
  const [menu, setMenu] = useState(false);
  const mouse = useRef({ x: 200, y: 200 });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { api.get<{ items: PinNote[] }>("/api/workspace/pins").then((r) => setNotes(r.items)).catch(() => {}); }, []);
  const save = useCallback((next: PinNote[]) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      apiFetch(`/api/workspace/pins`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ items: next }) }).catch(() => {});
    }, 400);
  }, []);
  const update = useCallback((fn: (xs: PinNote[]) => PinNote[]) => setNotes((xs) => { const n = fn(xs); save(n); return n; }), [save]);
  const patch = (id: string, p: Partial<PinNote>) => update((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)));

  const add = useCallback((text = "", at?: { x: number; y: number }) => {
    const x = at?.x ?? window.scrollX + window.innerWidth / 2 - 110 + (Math.random() * 80 - 40);
    const y = at?.y ?? window.scrollY + window.innerHeight / 2 - 90 + (Math.random() * 60 - 30);
    setHidden(false);
    update((xs) => [...xs, { id: uid(), text, color: COLORS[xs.length % COLORS.length], x, y, screen, everywhere: false, min: false, rot: Math.round(Math.random() * 6 - 3) }]);
  }, [screen, update]);

  useEffect(() => {
    const move = (e: PointerEvent) => { mouse.current = { x: e.pageX, y: e.pageY }; };
    const paste = (e: ClipboardEvent) => {
      const el = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable) return;
      const text = e.clipboardData?.getData("text/plain")?.trim();
      if (!text) return;
      e.preventDefault();
      add(text.slice(0, 2000), { x: Math.max(8, mouse.current.x - 30), y: Math.max(8, mouse.current.y - 20) });
      toast({ title: "Pinned from clipboard 📌", body: "Drag it anywhere. It stays on this screen.", tone: "good" });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("paste", paste);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("paste", paste); };
  }, [add]);

  const visible = notes.filter((n) => n.everywhere || n.screen === screen);

  return (
    <>
      {/* notes layer (document coordinates, so notes stay where you put them as you scroll) */}
      <div className="pointer-events-none absolute left-0 top-0 z-40 h-0 w-full">
        <AnimatePresence>
          {!hidden && visible.map((n) => (
            <PinCard key={n.id} n={n} patch={(p) => patch(n.id, p)} remove={() => update((xs) => xs.filter((x) => x.id !== n.id))} />
          ))}
        </AnimatePresence>
      </div>

      {/* floating control */}
      <div className="fixed bottom-[88px] left-3 z-50 sm:left-4 lg:bottom-6 lg:left-[calc(var(--sbw,272px)+18px)]">
        <AnimatePresence>
          {menu && (
            <motion.div initial={{ opacity: 0, y: 10, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.9 }}
              className="mb-2 w-60 rounded-2xl border-[2.5px] border-edge bg-surface p-2 shadow-[5px_5px_0_var(--shadow-c)]">
              <button onClick={() => { add(); setMenu(false); }} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-bold hover:bg-yellow hover:text-[#121212]">
                <StickyNote className="size-4" />New sticky here
              </button>
              <button onClick={() => setHidden((h) => !h)} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-bold hover:bg-surface-2">
                {hidden ? <Eye className="size-4" /> : <EyeOff className="size-4" />}{hidden ? "Show" : "Hide"} stickies ({visible.length})
              </button>
              <p className="px-3 pb-1 pt-1 text-[11px] text-muted">Tip: copy any text, then press <b>Ctrl/⌘ + V</b> anywhere (outside a text box) to pin it at your cursor.</p>
            </motion.div>
          )}
        </AnimatePresence>
        <motion.button onClick={() => setMenu((m) => !m)} whileHover={{ rotate: -8, scale: 1.05 }} whileTap={{ scale: 0.9 }} title="Sticky notes"
          className="btn-brut relative grid size-12 place-items-center rounded-2xl bg-yellow text-[#121212]">
          <Pin className="size-5" />
          {visible.length > 0 && <span className="absolute -right-2 -top-2 grid size-5 place-items-center rounded-full border-2 border-[#121212] bg-pink text-[10px] font-extrabold">{visible.length}</span>}
        </motion.button>
      </div>
    </>
  );
}
