# Devpost: Project details (copy into each field)

---

## Field: About the project

*(paste everything between the two lines below)*

---

## Inspiration

AI agents now write essays, literature reviews, legal briefs and research papers. They are also very good at inventing references that look perfect and don't exist. Lawyers have been sanctioned for filing briefs with made-up cases, and fabricated citations keep turning up in published papers.

We already built **Cite & Slayy**, a research studio whose **CiteGuard** engine checks every reference against Crossref, arXiv, Semantic Scholar and OpenAlex and catches retracted papers. Then we noticed who most needs that check: **the AI agents themselves.** An agent can't sign up for a subscription, and no sensible person gives an agent an unlimited card.

So we asked: **what if an AI agent could pay for the truth, per answer, out of a PayPal wallet, under rules its owner writes in plain English?**

## What it does

**Agent Pay** turns CiteGuard into a paid tool any AI agent can call (Claude, Cursor, or a custom agent through MCP or a plain HTTP API), paid for with PayPal.

1. **The owner writes spending rules in plain English.** *"At most $20 a month, $2 per call, ask me before anything over $1, only my writer-bot."* An LLM compiles this into a typed mandate: monthly cap, per-call cap, an ask-first threshold, allowed agents and auto-reload.
2. **The owner funds a wallet with PayPal Checkout.** They can save their PayPal account during the purchase so the wallet **reloads itself** when it runs low. It only reloads if the rules allow it and never beyond the monthly cap.
3. **The agent calls CiteGuard with its own key.** Every call is checked against the mandate *before* any money moves:
   - within the rules → the wallet is debited ($0.05 per reference) and CiteGuard runs;
   - over the ask-first threshold → `402 needs_approval`; the owner taps **Approve** in the dashboard and the agent retries;
   - over a cap or from an agent that isn't allowed → `403 denied`, with the exact rule that blocked it;
   - out of funds → auto-reload from saved PayPal if allowed, otherwise `402 insufficient_funds`.
4. **The agent pays for answers, not attempts.** If a scholarly database was down and a reference couldn't be settled, that reference is credited straight back.
5. **Unused balance is refunded to PayPal** in one click, split across the original captures.
6. **Every money movement and every decision is in an audit log** (an AG Grid table with PayPal references). An **"Explain my agents' spending"** button has the AI summarize what happened and suggest rule changes.

Cite & Slayy also now offers **PayPal checkout in USD** for its plans and the Paper Pack, next to Razorpay for India.

## How we built it

- **Backend:** Python + FastAPI, added to the existing Cite & Slayy API. Amounts are integer cents throughout, and every balance change writes a ledger row, so any balance can be explained.
- **PayPal:**
  - OAuth 2.0 client credentials, with the token cached until shortly before it expires
  - **Orders v2**: create, get and capture for top-ups and plans
  - **Save during purchase** (vault), then **merchant-initiated charges with `vault_id`** for agent auto-reload with no buyer present
  - **Payments v2 refunds** to return unused balance
  - **Webhooks** (`PAYMENT.CAPTURE.COMPLETED`), signature-verified with PayPal, so a payment completes even if the browser closes
  - `PayPal-Request-Id` on every write, so a retried request can never charge twice
  - **PayPal JS SDK** Smart Buttons in the Next.js frontend
- **AI:** The LLM turns free-text rules into a mandate through JSON-schema-constrained output, and writes the spending summary. Cite & Slayy runs on Amazon Bedrock (Claude and Kimi) and also supports OpenAI, Gemini or a local Ollama model. **The AI writes the rules but never approves a payment.** Every compiled number is clamped to server ceilings, and each call is decided with plain arithmetic. With no model available, an offline parser handles the common phrasings.
- **CiteGuard:** existence checks (Crossref → arXiv → Semantic Scholar → OpenAlex), metadata diffs, and retraction and expression-of-concern notices.
- **MCP server:** a dependency-free Python MCP server exposing `verify_references`, `quote_verification` and `check_approval`, so any MCP client can use CiteGuard as a paid tool.
- **Frontend:** Next.js 16 + React 19 + Tailwind. The new Agent Pay tab has rules, wallet, keys, a "Try it as the agent" playground and an **AG Grid** audit log.
- **Tests:** a fake in-memory PayPal sandbox behind `httpx.MockTransport` covers top-ups (including replays and other users' orders), mandate blocks, single-use approvals, credits for unsettled references, auto-reload, refunds and plan checkout.

## Challenges we ran into

- **Keeping money correct when agents run in parallel.** We debit the wallet *before* running the check and credit back afterwards, all under a per-wallet lock, so two simultaneous calls can never spend the same cents.
- **Not letting the LLM become the bank.** A model that "decides" payments is a prompt-injection target. We split the work: the model only proposes limits, those limits are clamped, and the decision on every call is deterministic code.
- **A spoofing bug we caught in testing.** In our first version, an agent could claim another agent's name in the request body and get past "only my writer-bot". Now the agent's identity comes only from its key, and a regression test guards it.
- **Auto-reload without a runaway agent.** A merchant-initiated charge is powerful, so automatic reloads in a month are capped by the owner's monthly limit.
- **The site's Content Security Policy silently blocked the PayPal SDK.** We had to allow PayPal's script, frame and connect origins explicitly.

## Accomplishments that we're proud of

- A working end-to-end flow: plain-English rules → PayPal top-up → an AI agent pays per reference → fake citations flagged → full audit trail → refund to PayPal.
- Agents get refunded for anything we couldn't verify, so they pay only for real answers.
- It plugs into tools people already use: one `claude mcp add` command and Claude can verify citations and pay for them.

## What we learned

- Agentic commerce is mostly about **trust boundaries**: who can spend, how much, when a human must say yes, and how to explain every cent afterwards.
- PayPal's vault and merchant-initiated charges fit agents well. The human approves once, and the agent can then pay within limits without a browser.
- Making payment decisions in plain arithmetic, rather than with the model, made the system easier to test and easier to trust.

## What's next for Cite & Slayy Agent Pay

- More paid agent tools from the same wallet: claim-support checks ("does this source actually say that?"), the Reviewer Jury verdict and the venue finder.
- Per-agent budgets and alerts.
- Payouts to human expert reviewers who double-check flagged references.
- Publishing the MCP server to MCP registries so any agent can discover it.

---

## Field: Built with (tags, add one at a time)

```
paypal
paypal-orders-api
paypal-js-sdk
paypal-vault
paypal-webhooks
python
fastapi
next.js
react
typescript
tailwindcss
ag-grid
amazon-bedrock
claude
llm
mcp
sqlite
crossref
openalex
semantic-scholar
arxiv
aws-ec2
```

---

## Field: "Try it out" links

1. **Live site:** https://citeslayy.com (deploy this branch first; Agent Pay is not live yet)
2. **Code:** https://github.com/batmandevx/Cite-and-slayy (make the repo public before submitting)

---

## Field: Image gallery (3:2, up to 15)

Ready in `docs/hackathon/` (1500×1000 each). Upload in this order:

1. `thumbnail.png` (cover)
2. `gallery/1-agent-pay-dashboard.png`: wallet tiles + an agent waiting for approval
3. `gallery/2-spending-rules-and-wallet.png`: plain-English rules compiled into limits + PayPal top-up
4. `gallery/3-agent-call-fake-reference-flagged.png`: real papers verified, a made-up one flagged, $0.15 charged
5. `gallery/4-audit-log-ag-grid.png`: AG Grid audit log with charge, approval request and blocked agent

Retake 2–5 once PayPal sandbox keys are set: they currently show "PayPal isn't configured" and a local demo credit
instead of a real PayPal top-up. Then add: the PayPal sandbox checkout popup, and Claude Code calling the MCP tool.

---

## Field: Video (YouTube, under 3 minutes)

Suggested cut:

| Time | Show |
|---|---|
| 0:00–0:15 | Problem: an AI-written brief with a fake citation |
| 0:15–0:35 | Write rules in plain English → Save → compiled limits appear |
| 0:35–0:55 | Top up $10 with PayPal sandbox (save PayPal for auto-reload) |
| 0:55–1:30 | Claude Code + MCP: "verify my references" → a fake reference is flagged, $0.15 charged |
| 1:30–2:00 | Agent sends 30 references → needs approval → tap Approve → agent retries and pays |
| 2:00–2:20 | A disallowed agent is blocked; the audit log shows every step; "Explain my spending" |
| 2:20–2:35 | Refund unused balance to PayPal |
| 2:35–2:55 | Who it's for and what's next |
