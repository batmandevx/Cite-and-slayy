"use client";

import clsx from "clsx";
import { BarChart3, Check, Inbox, Mail, RefreshCw, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, toast } from "@/lib/api";
import { Button, Card } from "../ui";
import { EmptyState, Skeleton } from "../ui/States";

interface Msg { id: string; name: string; email: string; topic: string; message: string; created_at: string; status: "new" | "done"; emailed: boolean }
interface Conv { days: number; totals: Record<string, number>; series: { day: string; counts: Record<string, number> }[] }

// The funnel, in order. Labels say what a visitor did.
const FUNNEL: [string, string][] = [
  ["cta_open_app", "Clicked “Open the app”"], ["video_play", "Watched a video with sound"], ["cta_pricing", "Clicked pricing"],
  ["signup", "Signed up"], ["login", "Signed in"], ["paper_started", "Started a paper"], ["paper_generated", "Paper generated"],
  ["export", "Exported a paper"], ["checkout_start", "Opened checkout"], ["checkout_success", "Subscribed"],
  ["pack_purchase", "Bought a Paper Pack"], ["upi_claim", "Submitted a UPI payment"], ["contact_submit", "Sent a contact message"],
];

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Owner-only: contact-form inbox and the last 30 days of conversion events. */
export function SiteInsights() {
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [emailOn, setEmailOn] = useState(true);
  const [conv, setConv] = useState<Conv | null>(null);
  const [show, setShow] = useState<"new" | "all">("new");

  const load = useCallback(async () => {
    try {
      const [m, c] = await Promise.all([
        api.get<{ email_notifications: boolean; messages: Msg[] }>("/api/admin/contact-messages"),
        api.get<Conv>("/api/admin/conversions?days=30"),
      ]);
      setMsgs(m.messages); setEmailOn(m.email_notifications); setConv(c);
    } catch (e) { setMsgs([]); toast({ title: "Couldn't load site insights", body: (e as Error).message, tone: "crit" }); }
  }, []);
  useEffect(() => { const t = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(t); }, [load]);

  const mark = async (m: Msg, status: "new" | "done") => {
    try { await api.post(`/api/admin/contact-messages/${m.id}/${status}`, {}); setMsgs((xs) => xs?.map((x) => (x.id === m.id ? { ...x, status } : x)) ?? null); }
    catch (e) { toast({ title: "Couldn't update", body: (e as Error).message, tone: "crit" }); }
  };

  const shown = (msgs ?? []).filter((m) => show === "all" || m.status === "new");
  const max = Math.max(1, ...FUNNEL.map(([k]) => conv?.totals[k] ?? 0));
  const daily = conv?.series.map((d) => Object.values(d.counts).reduce((a, b) => a + b, 0)) ?? [];
  const dmax = Math.max(1, ...daily);

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b-[2.5px] border-edge bg-yellow px-5 py-4 text-[#121212]">
          <Inbox className="size-7" />
          <div className="flex-1">
            <div className="font-display text-xl font-extrabold">Contact inbox</div>
            <div className="text-xs opacity-80">{emailOn ? "New messages are also emailed to the support inbox." : "Email alerts are off: set SMTP in the server settings to get them by email."}</div>
          </div>
          <div className="flex gap-1 rounded-xl border-2 border-edge bg-surface p-0.5 text-xs font-bold">
            {(["new", "all"] as const).map((v) => (
              <button key={v} onClick={() => setShow(v)} className={clsx("rounded-lg px-2.5 py-1", show === v && "bg-ink text-surface")}>{v === "new" ? "Open" : "All"}</button>
            ))}
          </div>
          <Button className="!py-1.5 text-xs" onClick={load}><RefreshCw className="size-3.5" />Refresh</Button>
        </div>
        <div className="max-h-[520px] space-y-3 overflow-y-auto p-4">
          {msgs === null ? Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-24 w-full rounded-2xl" />) : shown.length === 0 ? (
            <EmptyState icon={<Inbox />} title={show === "new" ? "Inbox zero" : "No messages yet"}>Messages from the contact page will appear here.</EmptyState>
          ) : shown.map((m) => (
            <article key={m.id} className={clsx("rounded-2xl border-2 border-edge p-4", m.status === "done" && "opacity-60")}>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <b>{m.name}</b>
                <a href={`mailto:${m.email}?subject=${encodeURIComponent("Re: your message to Cite & Slayy")}`} className="inline-flex items-center gap-1 text-accent-ink underline"><Mail className="size-3.5" />{m.email}</a>
                <span className="rounded-full border-2 border-edge bg-surface-2 px-2 py-0.5 text-[11px] font-bold uppercase">{m.topic}</span>
                <span className="ml-auto text-xs text-muted">{when(m.created_at)}</span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-ink-2">{m.message}</p>
              <div className="mt-3 flex items-center gap-2 text-xs text-muted">
                <span className="font-mono">#{m.id}</span>{!m.emailed && <span>· not emailed</span>}
                {m.status === "new"
                  ? <Button variant="lime" className="ml-auto !py-1 text-xs" onClick={() => mark(m, "done")}><Check className="size-3.5" />Mark done</Button>
                  : <Button className="ml-auto !py-1 text-xs" onClick={() => mark(m, "new")}><RotateCcw className="size-3.5" />Reopen</Button>}
              </div>
            </article>
          ))}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex items-center gap-3 border-b-[2.5px] border-edge bg-mint px-5 py-4 text-[#121212]">
          <BarChart3 className="size-7" />
          <div className="flex-1">
            <div className="font-display text-xl font-extrabold">Conversions · last 30 days</div>
            <div className="text-xs opacity-80">Anonymous counts from visitors who allowed analytics.</div>
          </div>
        </div>
        <div className="p-5">
          {conv === null ? <Skeleton className="h-64 w-full rounded-2xl" /> : (
            <>
              <div className="flex h-20 items-end gap-[3px]" role="img" aria-label="Events per day over the last 30 days">
                {daily.map((v, i) => (
                  <div key={conv.series[i].day} title={`${conv.series[i].day}: ${v}`} className="flex-1 rounded-t bg-[var(--series-1)]" style={{ height: `${Math.max(3, (v / dmax) * 100)}%`, opacity: v ? 1 : 0.25 }} />
                ))}
              </div>
              <div className="mt-1 flex justify-between text-[11px] text-muted"><span>{conv.series[0]?.day}</span><span>today</span></div>
              <table className="mt-5 w-full text-sm">
                <caption className="sr-only">Conversion events, last 30 days</caption>
                <tbody>
                  {FUNNEL.map(([k, label]) => {
                    const v = conv.totals[k] ?? 0;
                    return (
                      <tr key={k} className="border-t border-edge/20">
                        <th scope="row" className="py-1.5 pr-3 text-left font-medium">{label}</th>
                        <td className="w-1/2 py-1.5"><div className="h-2.5 rounded-full bg-[var(--series-1)]" style={{ width: `${(v / max) * 100}%`, minWidth: v ? 6 : 0 }} /></td>
                        <td className="w-14 py-1.5 text-right font-mono font-bold">{v.toLocaleString()}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
