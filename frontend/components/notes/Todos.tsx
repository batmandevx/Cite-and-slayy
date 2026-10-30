"use client";

import clsx from "clsx";
import { CalendarDays, Check, ChevronDown, Flame, ListChecks, Pause, Play, Plus, RotateCcw, Sparkles, Tag, Timer, Trash2, Wand2 } from "lucide-react";
import { AnimatePresence, motion, Reorder } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/lib/api";
import { sfx } from "@/lib/sfx";
import { assist } from "../AssistMenu";
import { Confetti } from "../Confetti";
import { Button, Card } from "../ui";
import { useWorkspace } from "./useWorkspace";

interface Sub { id: string; text: string; done: boolean }
export interface Todo {
  id: string; text: string; done: boolean; prio: "low" | "med" | "high";
  due?: string; tags?: string[]; subs?: Sub[]; doneAt?: string; created?: string;
}
const PRIO = { high: ["bg-pink", "High"], med: ["bg-yellow", "Med"], low: ["bg-lime", "Low"] } as const;
const uid = () => Math.random().toString(36).slice(2, 10);
const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

/** Quick-add syntax: "Run baselines !high #experiments @tomorrow" */
function parse(raw: string): Partial<Todo> & { text: string } {
  let text = raw;
  let prio: Todo["prio"] | undefined;
  const tags: string[] = [];
  let due: string | undefined;
  text = text.replace(/!(high|h|med|m|low|l)\b/i, (_, p: string) => { prio = ({ h: "high", m: "med", l: "low" } as const)[p[0].toLowerCase() as "h"] ; return ""; });
  text = text.replace(/#([\w-]+)/g, (_, t: string) => { tags.push(t.toLowerCase()); return ""; });
  text = text.replace(/@(today|tomorrow|\d{4}-\d{2}-\d{2})\b/i, (_, d: string) => {
    due = d.toLowerCase() === "today" ? today() : d.toLowerCase() === "tomorrow" ? plusDays(1) : d; return "";
  });
  return { text: text.replace(/\s+/g, " ").trim(), prio, tags, due };
}

function Burst({ x }: { x: number }) {
  return (
    <span className="pointer-events-none absolute left-3 top-1/2">
      {Array.from({ length: 8 }, (_, i) => (
        <motion.span key={`${x}-${i}`} className="absolute size-1.5 rounded-full" style={{ background: ["#ff4fa3", "#c6f24e", "#ffd23f", "#4f7dff"][i % 4] }}
          initial={{ x: 0, y: 0, opacity: 1 }} animate={{ x: Math.cos((i / 8) * 6.28) * 28, y: Math.sin((i / 8) * 6.28) * 28, opacity: 0 }} transition={{ duration: 0.6 }} />
      ))}
    </span>
  );
}

function FocusTimer({ task }: { task?: string }) {
  const [mode, setMode] = useState<"focus" | "break">("focus");
  const total = mode === "focus" ? 25 * 60 : 5 * 60;
  const [left, setLeft] = useState(total);
  const [on, setOn] = useState(false);
  const [sessions, setSessions] = useState(0);
  const st = useRef({ left: total, mode: mode as "focus" | "break" });
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => {
      const cur = st.current;
      if (cur.left > 1) { cur.left -= 1; setLeft(cur.left); if (cur.left <= 10) sfx("tick"); return; }
      sfx("chime");
      const next = cur.mode === "focus" ? "break" : "focus";
      if (cur.mode === "focus") setSessions((x) => x + 1);
      toast({ title: cur.mode === "focus" ? "Focus session done! Take 5 ☕" : "Break over. Back to it 💪", tone: "good" });
      st.current = { left: next === "focus" ? 25 * 60 : 5 * 60, mode: next };
      setMode(next); setLeft(st.current.left);
    }, 1000);
    return () => clearInterval(t);
  }, [on]);
  const reset = () => { setOn(false); st.current.left = total; setLeft(total); };
  const R = 52, C = 2 * Math.PI * R;
  const frac = left / total;
  const ang = (1 - frac) * 2 * Math.PI - Math.PI / 2;
  const col = mode === "focus" ? "var(--pink)" : "var(--lime)";
  const mm = String(Math.floor(left / 60)).padStart(2, "0"), ss = String(left % 60).padStart(2, "0");
  return (
    <Card className={clsx("relative overflow-hidden p-5 text-center transition-colors", on && (mode === "focus" ? "bg-pink/10" : "bg-lime/15"))}>
      <div className="flex items-center justify-center gap-2 font-display text-xs font-extrabold uppercase tracking-widest text-muted">
        <motion.span animate={on ? { rotate: 360 } : { rotate: 0 }} transition={on ? { repeat: Infinity, duration: 4, ease: "linear" } : {}}><Timer className="size-4" /></motion.span>Focus timer
      </div>
      <div className="relative mx-auto my-3 size-44">
        {on && [0, 1, 2].map((k) => (
          <motion.span key={k} className="absolute inset-3 rounded-full border-[3px]" style={{ borderColor: col }}
            initial={{ scale: 0.85, opacity: 0.5 }} animate={{ scale: 1.35, opacity: 0 }} transition={{ repeat: Infinity, duration: 2.4, delay: k * 0.8, ease: "easeOut" }} />
        ))}
        <motion.svg viewBox="0 0 120 120" className="relative size-44" animate={on ? { scale: [1, 1.025, 1] } : { scale: 1 }} transition={on ? { repeat: Infinity, duration: 1 } : {}}>
          <circle cx="60" cy="60" r={R} fill="var(--surface)" stroke="var(--surface-3)" strokeWidth="10" />
          {Array.from({ length: 60 }, (_, k) => {
            const t = (k / 60) * 2 * Math.PI - Math.PI / 2;
            const passed = k / 60 <= 1 - frac;
            return <line key={k} x1={60 + Math.cos(t) * 40} y1={60 + Math.sin(t) * 40} x2={60 + Math.cos(t) * (k % 5 ? 43 : 45)} y2={60 + Math.sin(t) * (k % 5 ? 43 : 45)}
              stroke={passed ? col : "var(--line)"} strokeWidth={k % 5 ? 1 : 2} strokeLinecap="round" />;
          })}
          <motion.circle cx="60" cy="60" r={R} fill="none" stroke={col} strokeWidth="10" strokeLinecap="round" transform="rotate(-90 60 60)"
            strokeDasharray={C} animate={{ strokeDashoffset: C * frac }} transition={{ duration: 0.9, ease: "linear" }} />
          <motion.circle r={7} fill={col} stroke="var(--edge)" strokeWidth={2.5} animate={{ cx: 60 + Math.cos(ang) * R, cy: 60 + Math.sin(ang) * R }}
            transition={{ duration: 0.9, ease: "linear" }} style={{ filter: on ? "drop-shadow(0 0 6px currentColor)" : undefined }} />
        </motion.svg>
        <div className="absolute inset-0 grid place-items-center">
          <div>
            <div className="flex font-display text-4xl font-extrabold tabular-nums">
              {(mm + ":" + ss).split("").map((ch, k) => (
                <span key={k} className="relative inline-block h-[1.1em] w-[0.62em] overflow-hidden">
                  <AnimatePresence initial={false} mode="popLayout">
                    <motion.span key={ch + k} className="absolute inset-0" initial={{ y: "-100%", opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: "100%", opacity: 0 }}
                      transition={{ type: "spring", stiffness: 400, damping: 28 }}>{ch}</motion.span>
                  </AnimatePresence>
                </span>
              ))}
            </div>
            <motion.div key={mode} initial={{ scale: 0 }} animate={{ scale: 1 }}
              className={clsx("mx-auto mt-0.5 w-fit rounded-full border-2 border-edge px-2 text-[10px] font-extrabold uppercase text-[#121212]", mode === "focus" ? "bg-pink" : "bg-lime")}>{mode}</motion.div>
          </div>
        </div>
      </div>
      {task && <div className="mb-2 line-clamp-1 text-xs text-ink-2">On: <b>{task}</b></div>}
      <div className="flex justify-center gap-2">
        <Button variant={on ? "secondary" : "primary"} className="!py-1.5 text-xs" onClick={() => { setOn((o) => !o); sfx(on ? "flip" : "start"); }}>{on ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}{on ? "Pause" : "Start"}</Button>
        <Button className="!py-1.5 text-xs" onClick={reset}><RotateCcw className="size-3.5" />Reset</Button>
      </div>
      <div className="mt-3 flex justify-center gap-1">{Array.from({ length: Math.max(4, sessions) }, (_, i) => (
        <motion.span key={i} initial={{ scale: 0 }} animate={{ scale: i < sessions ? [1, 1.4, 1] : 1 }}
          className={clsx("size-3 rounded-full border-2 border-edge", i < sessions ? "bg-pink" : "bg-surface")} />))}</div>
    </Card>
  );
}

export function TodoList() {
  const [todos, update] = useWorkspace<Todo>("todos");
  const [text, setText] = useState("");
  const [prio, setPrio] = useState<Todo["prio"]>("med");
  const [due, setDue] = useState("");
  const [filter, setFilter] = useState<"all" | "today" | "active" | "done">("all");
  const [tag, setTag] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [party, setParty] = useState(0);
  const [burst, setBurst] = useState<{ id: string; n: number } | null>(null);
  const [planNote, setPlanNote] = useState<string | null>(null);

  const all = useMemo(() => todos ?? [], [todos]);
  const tags = useMemo(() => [...new Set(all.flatMap((t) => t.tags ?? []))], [all]);
  const shown = all.filter((t) => (filter === "all" || (filter === "done" ? t.done : filter === "active" ? !t.done : !t.done && !!t.due && t.due <= today()))
    && (!tag || t.tags?.includes(tag)));
  if (!todos) return <div className="shimmer h-80 rounded-2xl" />;

  const done = all.filter((t) => t.done).length;
  const doneToday = all.filter((t) => t.doneAt?.slice(0, 10) === today()).length;
  const overdue = all.filter((t) => !t.done && t.due && t.due < today()).length;
  const pct = all.length ? done / all.length : 0;
  const patch = (id: string, p: Partial<Todo>) => update((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const toggle = (t: Todo) => {
    const next = all.map((x) => (x.id === t.id ? { ...x, done: !x.done, doneAt: !x.done ? new Date().toISOString() : undefined } : x));
    if (!t.done) setBurst((b) => ({ id: t.id, n: (b?.n ?? 0) + 1 }));
    if (next.length && next.every((x) => x.done)) setParty((p) => p + 1);
    update(() => next);
  };
  const addTodo = () => {
    const p = parse(text);
    if (!p.text) return;
    update((xs) => [{ id: uid(), text: p.text, done: false, prio: p.prio ?? prio, due: p.due ?? (due || undefined), tags: p.tags, subs: [], created: new Date().toISOString() }, ...xs]);
    setText(""); setDue("");
  };
  const breakdown = async (t: Todo) => {
    setBusy(t.id);
    const r = await assist("breakdown", t.text);
    setBusy(null);
    if (r?.items?.length) {
      patch(t.id, { subs: [...(t.subs ?? []), ...r.items.map((s) => ({ id: uid(), text: s, done: false }))] });
      setOpen(t.id);
    }
  };
  const planDay = async () => {
    const active = all.filter((t) => !t.done);
    if (active.length < 2) { toast({ title: "Add a few tasks first", tone: "accent" }); return; }
    setBusy("plan");
    const list = active.map((t, i) => `${i}. ${t.text} (priority ${t.prio}${t.due ? `, due ${t.due}` : ""})`).join("\n");
    const r = await assist("plan", `Today is ${today()}.\n${list}`);
    setBusy(null);
    if (!r?.order) return;
    const seen = new Set<number>();
    const ordered = r.order.filter((i) => i >= 0 && i < active.length && !seen.has(i) && seen.add(i)).map((i) => active[i]);
    const rest = active.filter((t) => !ordered.includes(t));
    update(() => [...ordered, ...rest, ...all.filter((t) => t.done)]);
    setPlanNote(r.reason ?? null);
    setFilter("all");
  };
  const R = 46, C = 2 * Math.PI * R;
  const focusTask = shown.find((t) => !t.done)?.text;

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_290px]">
      <div className="space-y-4">
        <Card className="p-5">
          <form onSubmit={(e) => { e.preventDefault(); addTodo(); }} className="flex flex-wrap gap-2">
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a task… try “Run baselines !high #experiments @tomorrow”"
              className="min-w-60 flex-1 rounded-xl border-[2.5px] border-edge bg-surface px-3.5 py-2.5 text-sm shadow-[3px_3px_0_var(--shadow-c)] outline-none" />
            <div className="flex rounded-xl border-[2.5px] border-edge bg-surface p-0.5">
              {(["high", "med", "low"] as const).map((p) => (
                <button type="button" key={p} onClick={() => setPrio(p)} className={clsx("rounded-lg px-2 text-xs font-extrabold", prio === p && `${PRIO[p][0]} text-[#121212]`)}>{PRIO[p][1]}</button>
              ))}
            </div>
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="rounded-xl border-[2.5px] border-edge bg-surface px-2 text-xs" title="Due date" />
            <Button variant="primary" type="submit"><Plus className="size-4" />Add</Button>
          </form>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {(["all", "today", "active", "done"] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={clsx("rounded-full border-2 border-edge px-3 py-0.5 text-xs font-bold capitalize", filter === f ? "bg-yellow text-[#121212]" : "bg-surface")}>{f === "today" ? "Due today" : f}</button>
            ))}
            {tags.map((t) => (
              <button key={t} onClick={() => setTag(tag === t ? null : t)} className={clsx("inline-flex items-center gap-0.5 rounded-full border-2 border-edge px-2 py-0.5 text-[11px] font-bold", tag === t ? "bg-blue text-white" : "bg-surface-2")}><Tag className="size-3" />{t}</button>
            ))}
            <Button variant="primary" className="ml-auto !px-3 !py-1.5 text-xs" loading={busy === "plan"} onClick={planDay}><Wand2 className="size-3.5" />AI: plan my day</Button>
          </div>
          <AnimatePresence>
            {planNote && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                className="mt-3 flex items-start gap-2 rounded-xl border-2 border-edge bg-violet/15 px-3 py-2 text-xs">
                <Sparkles className="mt-0.5 size-3.5 shrink-0 text-pink" /><span className="flex-1"><b>Azora AI reordered your list:</b> {planNote}</span>
                <button onClick={() => setPlanNote(null)} className="font-bold opacity-60">✕</button>
              </motion.div>
            )}
          </AnimatePresence>
        </Card>

        <Reorder.Group axis="y" values={shown} onReorder={(v) => filter === "all" && !tag && update(() => [...v, ...all.filter((t) => !v.includes(t))])} className="space-y-2.5">
          <AnimatePresence initial={false}>
            {shown.map((t) => {
              const subsDone = (t.subs ?? []).filter((s) => s.done).length;
              const late = !t.done && t.due && t.due < today();
              return (
                <Reorder.Item key={t.id} value={t} layout initial={{ opacity: 0, x: -40, scale: 0.95 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, x: 80, height: 0, marginTop: 0 }}
                  whileDrag={{ scale: 1.03, rotate: -0.6, boxShadow: "8px 8px 0 var(--shadow-c)" }}
                  className={clsx("group relative overflow-hidden rounded-2xl border-[2.5px] border-edge bg-surface shadow-[3px_3px_0_var(--shadow-c)]", t.done && "opacity-70")}>
                  <span className={clsx("absolute inset-y-0 left-0 w-1.5", PRIO[t.prio][0])} />
                  <div className="flex items-center gap-3 py-2.5 pl-4 pr-3">
                    <div className="relative">
                      <motion.button whileTap={{ scale: 0.75 }} onClick={() => toggle(t)}
                        className={clsx("grid size-7 shrink-0 place-items-center rounded-lg border-[2.5px] border-edge", t.done ? "bg-good" : "bg-surface")}>
                        <AnimatePresence>{t.done && <motion.span initial={{ scale: 0, rotate: -90 }} animate={{ scale: 1, rotate: 0 }} exit={{ scale: 0 }}><Check className="size-4 text-white" strokeWidth={3} /></motion.span>}</AnimatePresence>
                      </motion.button>
                      {burst?.id === t.id && <Burst x={burst.n} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <input value={t.text} onChange={(e) => patch(t.id, { text: e.target.value })} onPointerDown={(e) => e.stopPropagation()}
                        className={clsx("w-full bg-transparent text-sm font-semibold outline-none transition", t.done && "text-muted line-through decoration-2")} />
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                        {t.due && <span className={clsx("inline-flex items-center gap-0.5 rounded-full px-1.5 font-bold", late ? "bg-crit text-white" : t.due === today() ? "bg-orange text-[#121212]" : "bg-surface-2 text-ink-2")}>
                          <CalendarDays className="size-3" />{t.due === today() ? "today" : t.due === plusDays(1) ? "tomorrow" : t.due}</span>}
                        {(t.tags ?? []).map((g) => <span key={g} className="rounded-full bg-blue/15 px-1.5 font-bold text-ink-2">#{g}</span>)}
                        {(t.subs ?? []).length > 0 && (
                          <span className="inline-flex items-center gap-1 font-bold text-muted"><ListChecks className="size-3" />{subsDone}/{t.subs!.length}
                            <span className="h-1.5 w-12 overflow-hidden rounded-full bg-surface-3"><motion.span className="block h-full bg-good" animate={{ width: `${(subsDone / t.subs!.length) * 100}%` }} /></span>
                          </span>
                        )}
                      </div>
                    </div>
                    <motion.button whileTap={{ scale: 0.9 }} onClick={() => breakdown(t)} title="AI: break into subtasks" disabled={busy === t.id}
                      className="hidden items-center gap-1 rounded-lg border-2 border-edge bg-[linear-gradient(120deg,var(--violet),var(--pink))] px-2 py-1 text-[10px] font-bold text-white sm:inline-flex">
                      <Sparkles className={clsx("size-3", busy === t.id && "animate-spin")} />{busy === t.id ? "…" : "Break down"}
                    </motion.button>
                    <button onClick={() => setOpen(open === t.id ? null : t.id)} className="rounded-lg p-1 hover:bg-surface-2"><ChevronDown className={clsx("size-4 transition", open === t.id && "rotate-180")} /></button>
                    <button onClick={() => update((xs) => xs.filter((x) => x.id !== t.id))} className="rounded-lg p-1 opacity-0 transition hover:bg-crit-soft group-hover:opacity-70"><Trash2 className="size-4" /></button>
                  </div>
                  <AnimatePresence>
                    {open === t.id && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                        className="border-t-2 border-dashed border-line bg-surface-2/60 px-4 py-3" onPointerDown={(e) => e.stopPropagation()}>
                        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-bold text-muted">Priority</span>
                          {(["high", "med", "low"] as const).map((p) => (
                            <button key={p} onClick={() => patch(t.id, { prio: p })} className={clsx("rounded-full border-2 border-edge px-2 font-bold", t.prio === p ? `${PRIO[p][0]} text-[#121212]` : "bg-surface")}>{PRIO[p][1]}</button>
                          ))}
                          <span className="ml-2 font-bold text-muted">Due</span>
                          <input type="date" value={t.due ?? ""} onChange={(e) => patch(t.id, { due: e.target.value || undefined })} className="rounded-lg border-2 border-edge bg-surface px-1.5" />
                          <button onClick={() => breakdown(t)} className="inline-flex items-center gap-1 rounded-lg border-2 border-edge bg-surface px-2 font-bold sm:hidden"><Sparkles className="size-3" />Break down</button>
                        </div>
                        <div className="space-y-1">
                          {(t.subs ?? []).map((s) => (
                            <motion.label key={s.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-2 text-sm">
                              <input type="checkbox" checked={s.done} className="size-4 accent-[var(--good)]"
                                onChange={() => patch(t.id, { subs: t.subs!.map((x) => (x.id === s.id ? { ...x, done: !x.done } : x)) })} />
                              <span className={clsx(s.done && "text-muted line-through")}>{s.text}</span>
                              <button onClick={() => patch(t.id, { subs: t.subs!.filter((x) => x.id !== s.id) })} className="ml-auto text-xs opacity-40 hover:opacity-100">✕</button>
                            </motion.label>
                          ))}
                          <form onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget.elements.namedItem("sub") as HTMLInputElement; if (f.value.trim()) { patch(t.id, { subs: [...(t.subs ?? []), { id: uid(), text: f.value.trim(), done: false }] }); f.value = ""; } }}>
                            <input name="sub" placeholder="+ Add a subtask" className="w-full rounded-lg border-2 border-dashed border-line bg-transparent px-2 py-1 text-sm outline-none" />
                          </form>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </Reorder.Item>
              );
            })}
          </AnimatePresence>
        </Reorder.Group>
        {shown.length === 0 && <p className="py-10 text-center text-sm text-muted">Nothing here. Add your next task above ✨</p>}
      </div>

      <div className="space-y-4">
        <Card className="relative p-5 text-center">
          {party > 0 && <Confetti key={party} />}
          <div className="font-display text-xs font-extrabold uppercase tracking-widest text-muted">Progress</div>
          <div className="relative mx-auto my-2 size-36">
            <svg viewBox="0 0 120 120" className="size-36 -rotate-90">
              <circle cx="60" cy="60" r={R} fill="none" stroke="var(--surface-3)" strokeWidth="12" />
              <motion.circle cx="60" cy="60" r={R} fill="none" stroke="var(--good)" strokeWidth="12" strokeLinecap="round"
                strokeDasharray={C} animate={{ strokeDashoffset: C * (1 - pct) }} transition={{ type: "spring", stiffness: 60, damping: 14 }} />
            </svg>
            <div className="absolute inset-0 grid place-items-center font-display text-3xl font-extrabold">{Math.round(pct * 100)}%</div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            {[["Done", done, "bg-lime"], ["Today", doneToday, "bg-yellow"], ["Overdue", overdue, overdue ? "bg-crit text-white" : "bg-surface-2"]].map(([k, v, c]) => (
              <div key={k as string} className={clsx("rounded-xl border-2 border-edge py-1.5", c as string, !(c as string).includes("text-white") && "text-[#121212]")}>
                <div className="font-display text-xl font-extrabold">{v as number}</div><div className="text-[10px] font-bold uppercase">{k as string}</div>
              </div>
            ))}
          </div>
          {doneToday >= 3 && <div className="mt-3 inline-flex items-center gap-1 font-display font-extrabold text-orange"><Flame className="size-4" />On fire today!</div>}
          {all.length > 0 && done === all.length && <div className="mt-2 font-display font-extrabold text-good-ink">All done. You slayed it 💅</div>}
        </Card>
        <FocusTimer task={focusTask} />
      </div>
    </div>
  );
}
