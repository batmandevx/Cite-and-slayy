"use client";

import clsx from "clsx";
import { Bot, Check, Copy, KeyRound, RefreshCw, ShieldCheck, Sparkles, Trash2, Wallet, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { API, api, toast } from "@/lib/api";
import { Badge, Button, Callout, Card, Field, Input, SectionTitle, StatTile } from "@/components/ui";
import { LedgerGrid, type LedgerRow } from "./LedgerGrid";
import { PayPalButtons, usePayPalConfig } from "./PayPalButtons";

type Mandate = {
  monthly_cap_usd: number; per_call_cap_usd: number; max_refs_per_call: number; approval_over_usd: number;
  auto_topup: boolean; auto_topup_amount_usd: number; allowed_agents: string[]; summary: string;
};
type AgentKey = { id: string; name: string; prefix: string; created_at: string; last_used: string | null; calls: number; revoked: boolean };
type Pending = { id: string; agent: string; refs: number; preview: string[]; cost_cents: number; reason: string; created_at: string };
type WalletInfo = {
  balance_usd: number; month_spent_usd: number; month_left_usd: number; mandate: Mandate; mandate_text: string;
  mandate_engine: string; auto_reload_ready: boolean; price_per_ref_usd: number; paypal: boolean; paypal_env: string;
  keys: AgentKey[]; pending: Pending[];
};
type VerifyResult = {
  status: string; charged_usd: number; refunded_usd: number; balance_usd: number; flagged: number;
  results: { index: number; reference: string; status: string; retraction: string; matched: { title: string; doi?: string; year?: number } | null; charged: boolean }[];
};

const EXAMPLES = [
  "Spend at most $20 a month and $2 per call. Ask me before any call over $1. Only my writer-bot agent.",
  "Up to $50 a month, $5 per call, 100 refs per call, never ask. Top up automatically with $10.",
];
const SAMPLE_REFS = [
  "Vaswani, A., Shazeer, N., Parmar, N., et al. Attention is all you need. Advances in Neural Information Processing Systems, 2017.",
  "Devlin, J., Chang, M.-W., Lee, K., Toutanova, K. BERT: Pre-training of deep bidirectional transformers for language understanding. NAACL 2019.",
  "Hernandez, R., Okafor, L. Quantum gradient folding for zero-shot protein citation graphs. Nature Machine Intelligence, 2024.",
].join("\n");

const STATUS_TONE: Record<string, "good" | "warn" | "crit" | "neutral"> = {
  verified: "good", metadata_mismatch: "warn", not_found: "crit", could_not_verify: "neutral",
};

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function AgentPayTab() {
  const cfg = usePayPalConfig();
  const [w, setW] = useState<WalletInfo | null>(null);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [rules, setRules] = useState("");
  const [compiling, setCompiling] = useState(false);
  const [amount, setAmount] = useState(10);
  const [saveForReload, setSaveForReload] = useState(true);
  const [keyName, setKeyName] = useState("writer-bot");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [refs, setRefs] = useState(SAMPLE_REFS);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [agentNote, setAgentNote] = useState<{ tone: "warn" | "crit"; title: string; body: string; requestId?: string } | null>(null);
  const [insight, setInsight] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);

  const fetchAll = () => Promise.all([api.get<WalletInfo>("/api/agentpay/wallet"), api.get<LedgerRow[]>("/api/agentpay/ledger")]);
  const apply = useCallback(([wallet, rows]: [WalletInfo, LedgerRow[]]) => {
    setW(wallet);
    setLedger(rows);
    setRules((r) => r || wallet.mandate_text);
  }, []);
  const load = useCallback(async () => apply(await fetchAll()), [apply]);
  useEffect(() => {
    let live = true;
    fetchAll().then((d) => { if (live) apply(d); })
      .catch((e) => toast({ title: "Couldn't load your wallet", body: errMsg(e), tone: "crit" }));
    return () => { live = false; };
  }, [apply]);

  const compile = async () => {
    setCompiling(true);
    try {
      await api.post("/api/agentpay/mandate", { text: rules });
      await load();
      toast({ title: "Rules saved", body: "Every agent call is now checked against them before any money moves.", tone: "good" });
    } catch (e) { toast({ title: "Couldn't save rules", body: errMsg(e), tone: "crit" }); }
    finally { setCompiling(false); }
  };

  const makeKey = async () => {
    try {
      const r = await api.post<{ key: string }>("/api/agentpay/keys", { name: keyName });
      setNewKey(r.key);
      setCopied(false);
      await load();
    } catch (e) { toast({ title: "Couldn't create key", body: errMsg(e), tone: "crit" }); }
  };

  const revoke = async (id: string) => {
    await fetch(`${API}/api/agentpay/keys/${id}`, { method: "DELETE", credentials: "include" });
    await load();
  };

  const decide = async (id: string, decision: "approve" | "reject") => {
    try {
      await api.post(`/api/agentpay/requests/${id}/${decision}`);
      await load();
      toast({ title: decision === "approve" ? "Approved" : "Rejected", body: decision === "approve" ? "The agent can retry the call now." : "The agent was told no.", tone: decision === "approve" ? "good" : "accent" });
    } catch (e) { toast({ title: "Couldn't update request", body: errMsg(e), tone: "crit" }); }
  };

  const withdraw = async () => {
    if (!confirm(`Refund your unused $${w?.balance_usd.toFixed(2)} to PayPal?`)) return;
    try {
      await api.post("/api/agentpay/withdraw");
      await load();
      toast({ title: "Refunded to PayPal", body: "The unused balance is on its way back to your PayPal account.", tone: "good" });
    } catch (e) { toast({ title: "Couldn't refund", body: errMsg(e), tone: "crit" }); }
  };

  const runAgent = async (requestId?: string) => {
    if (!newKey) return;
    setRunning(true);
    setResult(null);
    setAgentNote(null);
    try {
      const r = await fetch(`${API}/api/agent/v1/verify`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${newKey}` },
        body: JSON.stringify({ references: refs.split("\n").map((s) => s.trim()).filter(Boolean), request_id: requestId }),
      });
      const body = await r.json();
      if (r.ok) setResult(body);
      else {
        const d = body.detail ?? {};
        if (d.status === "needs_approval") setAgentNote({ tone: "warn", title: "The agent asked you first", body: d.reason, requestId: d.request_id });
        else if (d.status === "insufficient_funds") setAgentNote({ tone: "crit", title: "Wallet is empty", body: `This call costs $${d.cost_usd.toFixed(2)}; the balance is $${d.balance_usd.toFixed(2)}. Top up with PayPal.` });
        else setAgentNote({ tone: "crit", title: "Blocked by your rules", body: d.reason ?? (typeof d === "string" ? d : JSON.stringify(d)) });
      }
    } catch (e) { setAgentNote({ tone: "crit", title: "Agent call failed", body: errMsg(e) }); }
    finally { setRunning(false); await load(); }
  };

  const explain = async () => {
    setThinking(true);
    try { setInsight((await api.get<{ text: string }>("/api/agentpay/insights")).text); }
    catch (e) { setInsight(errMsg(e)); }
    finally { setThinking(false); }
  };

  if (!w) return <div className="py-20 text-center text-sm font-bold text-muted">Loading your agent wallet…</div>;
  const m = w.mandate;
  const capPct = m.monthly_cap_usd ? Math.min(100, (w.month_spent_usd / m.monthly_cap_usd) * 100) : 0;
  const mcp = newKey ? JSON.stringify({ mcpServers: { citeguard: { command: "python3", args: ["mcp/citeslayy_mcp.py"], env: { CITESLAYY_AGENT_KEY: newKey, CITESLAYY_API_URL: API } } } }, null, 2) : "";

  return (
    <div className="space-y-6">
      <SectionTitle eyebrow="Agent Pay · PayPal" title="Let AI agents pay for verified citations, on your rules"
        right={<Badge tone={w.paypal_env === "live" ? "good" : "warn"}>PayPal {w.paypal_env}</Badge>}>
        Your AI writing agent calls CiteGuard and pays per reference from a PayPal-funded wallet.
        You write the spending rules in plain English; the server enforces them on every call, asks you before big spends,
        and refunds anything we couldn&apos;t verify.
      </SectionTitle>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Wallet balance" value={`$${w.balance_usd.toFixed(2)}`} sub="funded with PayPal" tone="accent" />
        <StatTile label="Spent this month" value={`$${w.month_spent_usd.toFixed(2)}`} sub={`of $${m.monthly_cap_usd.toFixed(2)} cap · ${capPct.toFixed(0)}%`} tone={capPct > 80 ? "warn" : "good"} />
        <StatTile label="Auto-reload" value={m.auto_topup && w.auto_reload_ready ? "On" : "Off"} sub={w.auto_reload_ready ? `+$${m.auto_topup_amount_usd} from saved PayPal` : "save PayPal on a top-up"} tone={m.auto_topup && w.auto_reload_ready ? "good" : "neutral"} />
        <StatTile label="Price" value={`$${w.price_per_ref_usd.toFixed(2)}`} sub="per reference answered" tone="neutral" />
      </div>

      {w.pending.length > 0 && (
        <Card className="p-5">
          <h3 className="mb-3 font-display text-lg font-extrabold">Waiting for your OK</h3>
          <div className="space-y-3">
            {w.pending.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-edge bg-warn-soft p-3">
                <div className="min-w-0 text-sm">
                  <div className="font-bold"><Bot className="mr-1 inline size-4" />{p.agent} wants to spend ${(p.cost_cents / 100).toFixed(2)} on {p.refs} reference(s)</div>
                  <div className="text-xs text-ink-2">{p.reason}</div>
                  <div className="truncate text-xs text-muted">{p.preview.join(" · ")}</div>
                </div>
                <div className="flex gap-2">
                  <Button variant="lime" onClick={() => decide(p.id, "approve")}><Check className="size-4" />Approve</Button>
                  <Button variant="ghost" onClick={() => decide(p.id, "reject")}><X className="size-4" />Reject</Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h3 className="mb-1 flex items-center gap-2 font-display text-lg font-extrabold"><ShieldCheck className="size-5" />Spending rules</h3>
          <p className="mb-3 text-sm text-ink-2">Write them like you&apos;d tell an assistant. AI turns them into hard limits; the limits, not the AI, decide every payment.</p>
          <textarea value={rules} onChange={(e) => setRules(e.target.value)} rows={4} maxLength={2000}
            className="w-full rounded-xl border-[2.5px] border-edge bg-surface px-3.5 py-2.5 text-sm shadow-[3px_3px_0_var(--shadow-c)] focus:outline-none"
            placeholder={EXAMPLES[0]} />
          <div className="mt-2 flex flex-wrap gap-2">
            {EXAMPLES.map((ex) => <button key={ex} onClick={() => setRules(ex)} className="rounded-full border-2 border-edge bg-surface-2 px-2.5 py-1 text-left text-[11px] font-bold hover:bg-surface-3">{ex.slice(0, 48)}…</button>)}
          </div>
          <Button variant="primary" className="mt-3" loading={compiling} onClick={compile}><Sparkles className="size-4" />Save rules</Button>
          <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
            <Rule k="Monthly cap" v={`$${m.monthly_cap_usd.toFixed(2)}`} />
            <Rule k="Per call cap" v={`$${m.per_call_cap_usd.toFixed(2)}`} />
            <Rule k="Ask me over" v={m.approval_over_usd ? `$${m.approval_over_usd.toFixed(2)}` : "never ask"} />
            <Rule k="Refs per call" v={String(m.max_refs_per_call)} />
            <Rule k="Auto-reload" v={m.auto_topup ? `yes, $${m.auto_topup_amount_usd}` : "no"} />
            <Rule k="Agents" v={m.allowed_agents.length ? m.allowed_agents.join(", ") : "any key"} />
          </div>
          <p className="mt-2 text-[11px] font-bold text-muted">Compiled by {w.mandate_engine === "ai" ? "AI" : w.mandate_engine === "rules" ? "the offline rules parser" : "defaults"} · clamped to server ceilings</p>
        </Card>

        <Card className="p-5">
          <h3 className="mb-1 flex items-center gap-2 font-display text-lg font-extrabold"><Wallet className="size-5" />Fund the wallet</h3>
          <p className="mb-3 text-sm text-ink-2">Top up with PayPal. Save your PayPal account to let the wallet reload itself, only if your rules allow it and never past your monthly cap.</p>
          <div className="mb-3 flex flex-wrap gap-2">
            {[5, 10, 25, 50].map((a) => (
              <button key={a} onClick={() => setAmount(a)} className={clsx("rounded-xl border-2 border-edge px-4 py-2 font-display font-extrabold", amount === a ? "bg-lime text-[#121212]" : "bg-surface")}>${a}</button>
            ))}
          </div>
          <label className="mb-3 flex items-center gap-2 text-sm font-bold">
            <input type="checkbox" checked={saveForReload} onChange={(e) => setSaveForReload(e.target.checked)} className="size-4" />
            Save my PayPal for auto-reload
          </label>
          {cfg && (
            <PayPalButtons cfg={cfg}
              createOrder={async () => (await api.post<{ order_id: string }>("/api/agentpay/topup", { amount_usd: amount, save_for_auto_reload: saveForReload })).order_id}
              onApproved={async (id) => {
                await api.post(`/api/agentpay/topup/${id}/capture`);
                await load();
                toast({ title: `Added $${amount}`, body: "Paid with PayPal. Your agents can spend it now.", tone: "good" });
              }}
              onError={(msg) => toast({ title: "PayPal checkout failed", body: msg, tone: "crit" })} />
          )}
          <Button variant="ghost" className="mt-3" disabled={!w.balance_usd} onClick={withdraw}><RefreshCw className="size-4" />Refund unused balance to PayPal</Button>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h3 className="mb-1 flex items-center gap-2 font-display text-lg font-extrabold"><KeyRound className="size-5" />Agent keys</h3>
          <p className="mb-3 text-sm text-ink-2">Give each agent its own key. Plug it into Claude, Cursor or any MCP client with the CiteGuard tool.</p>
          <div className="flex gap-2">
            <Field label="Agent name" className="flex-1"><Input value={keyName} onChange={(e) => setKeyName(e.target.value)} maxLength={40} /></Field>
            <Button variant="blue" className="self-end" onClick={makeKey}>Create key</Button>
          </div>
          {newKey && (
            <div className="mt-3 space-y-2">
              <Callout tone="warn" title="Copy it now">We only keep a hash of this key, so it can&apos;t be shown again.</Callout>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg border-2 border-edge bg-surface-2 px-2 py-1.5 text-xs">{newKey}</code>
                <Button onClick={() => { navigator.clipboard.writeText(newKey); setCopied(true); }}>{copied ? <Check className="size-4" /> : <Copy className="size-4" />}</Button>
              </div>
              <details className="text-xs"><summary className="cursor-pointer font-bold">MCP config (Claude Desktop, Cursor)</summary>
                <pre className="mt-2 overflow-x-auto rounded-lg border-2 border-edge bg-surface-2 p-2 text-[11px]">{mcp}</pre>
              </details>
            </div>
          )}
          <ul className="mt-3 divide-y-2 divide-edge/20 text-sm">
            {w.keys.map((k) => (
              <li key={k.id} className={clsx("flex items-center justify-between gap-2 py-2", k.revoked && "opacity-50")}>
                <span><b>{k.name}</b> <code className="text-xs text-muted">{k.prefix}…</code> · {k.calls} call(s){k.revoked && " · revoked"}</span>
                {!k.revoked && <button onClick={() => revoke(k.id)} className="text-muted hover:text-crit" aria-label={`Revoke ${k.name}`}><Trash2 className="size-4" /></button>}
              </li>
            ))}
          </ul>
        </Card>

        <Card className="p-5">
          <h3 className="mb-1 flex items-center gap-2 font-display text-lg font-extrabold"><Bot className="size-5" />Try it as the agent</h3>
          <p className="mb-3 text-sm text-ink-2">Sends exactly what an AI agent would send to the paid API, with the key you just created. One reference per line.</p>
          <textarea value={refs} onChange={(e) => setRefs(e.target.value)} rows={5}
            className="w-full rounded-xl border-[2.5px] border-edge bg-surface px-3.5 py-2.5 font-mono text-xs focus:outline-none" />
          <Button variant="lime" className="mt-2" disabled={!newKey} loading={running} onClick={() => runAgent()}>
            {newKey ? `Run agent call ($${(refs.split("\n").filter((s) => s.trim()).length * w.price_per_ref_usd).toFixed(2)})` : "Create a key first"}
          </Button>
          {agentNote && (
            <div className="mt-3">
              <Callout tone={agentNote.tone} title={agentNote.title}>
                {agentNote.body}
                {agentNote.requestId && <div className="mt-2"><Button variant="secondary" onClick={() => runAgent(agentNote.requestId)}>Retry after approving</Button></div>}
              </Callout>
            </div>
          )}
          {result && (
            <div className="mt-3 space-y-2">
              <div className="text-sm font-bold">Paid ${result.charged_usd.toFixed(2)}{result.refunded_usd > 0 && ` (refunded $${result.refunded_usd.toFixed(2)})`} · {result.flagged} flagged · wallet ${result.balance_usd.toFixed(2)}</div>
              {result.results.map((r) => (
                <div key={r.index} className="rounded-xl border-2 border-edge p-2 text-xs">
                  <div className="flex items-center gap-2"><Badge tone={STATUS_TONE[r.status] ?? "neutral"}>{r.status.replaceAll("_", " ")}</Badge>
                    {["retracted", "expression_of_concern"].includes(r.retraction) && <Badge tone="crit">{r.retraction.replaceAll("_", " ")}</Badge>}
                    {!r.charged && <span className="font-bold text-muted">not charged</span>}</div>
                  <div className="mt-1 text-ink-2">{r.reference}</div>
                  {r.matched && <div className="mt-1 font-bold">Found: {r.matched.title} ({r.matched.year}){r.matched.doi && ` · doi:${r.matched.doi}`}</div>}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card className="p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-display text-lg font-extrabold">Audit log</h3>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => load()}><RefreshCw className="size-4" />Refresh</Button>
            <Button variant="primary" loading={thinking} onClick={explain}><Sparkles className="size-4" />Explain my agents&apos; spending</Button>
          </div>
        </div>
        {insight && <div className="prose prose-sm mb-4 max-w-none rounded-xl border-2 border-edge bg-accent-soft p-3 text-sm"><ReactMarkdown>{insight}</ReactMarkdown></div>}
        <LedgerGrid rows={ledger} />
      </Card>
    </div>
  );
}

function Rule({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-xl border-2 border-edge bg-surface-2 px-3 py-2">
      <div className="text-[10px] font-extrabold uppercase tracking-wider text-muted">{k}</div>
      <div className="font-display font-extrabold">{v}</div>
    </div>
  );
}
