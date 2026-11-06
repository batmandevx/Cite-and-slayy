"""HTTP routes for Agent Pay (owner dashboard + the agent-facing paid API) and PayPal checkout/webhooks."""
from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from backend.accounts import auth, paypal_billing
from backend.agentpay import service, wallet as W
from backend.agentpay.mandate import compile_rules
from backend.cache.store import get_store, now
from backend.common.config import get_settings
from backend.llm import client as llm
from backend.payments import paypal

router = APIRouter()


def owner(request: Request) -> dict:
    user = auth.require_user(request)
    llm.set_meter(user["uid"] if get_settings().auth_required else None)
    return user


# ---------- public config ----------

@router.get("/api/paypal/config")
def paypal_config():
    s = get_settings()
    return {"enabled": paypal.enabled(), "client_id": s.paypal_client_id if paypal.enabled() else None,
            "env": s.paypal_env, "currency": paypal.CURRENCY, "paypal_me": s.paypal_me_url or None}


# ---------- owner: wallet, mandate, keys ----------

@router.get("/api/agentpay/wallet")
def wallet(request: Request):
    u = owner(request)
    return {**W.public_wallet(W.get_wallet(u["uid"])), "keys": W.list_keys(u["uid"]),
            "pending": service.pending_requests(u["uid"])}


class MandateIn(BaseModel):
    text: str = Field(max_length=2000)


@router.post("/api/agentpay/mandate")
async def set_mandate(body: MandateIn, request: Request):
    u = owner(request)
    m, engine = await compile_rules(body.text)
    async with W.lock(u["uid"]):
        w = W.get_wallet(u["uid"])
        w.update(mandate=m.model_dump(), mandate_text=body.text.strip(), mandate_engine=engine)
        W.save_wallet(w)
        W.ledger_add(u["uid"], "mandate", 0, w["balance_cents"], f"Rules updated: {m.summary}")
    return W.public_wallet(w)


class KeyIn(BaseModel):
    name: str = Field(default="my-agent", max_length=40)


@router.post("/api/agentpay/keys")
def new_key(body: KeyIn, request: Request):
    u = owner(request)
    key, rec = W.create_key(u["uid"], body.name)
    return {"key": key, **rec, "note": "Copy this key now. We only store its hash, so it can't be shown again."}


@router.delete("/api/agentpay/keys/{key_id}")
def del_key(key_id: str, request: Request):
    W.revoke_key(owner(request)["uid"], key_id)
    return {"ok": True}


@router.get("/api/agentpay/ledger")
def get_ledger(request: Request):
    return W.ledger(owner(request)["uid"])


@router.post("/api/agentpay/requests/{request_id}/{decision}")
def decide(request_id: str, decision: str, request: Request):
    if decision not in ("approve", "reject"):
        raise HTTPException(400, "decision must be approve or reject")
    return service.decide_request(owner(request)["uid"], request_id, decision == "approve")


class TopupIn(BaseModel):
    amount_usd: float = Field(ge=5, le=1000)
    save_for_auto_reload: bool = False


@router.post("/api/agentpay/topup")
async def topup(body: TopupIn, request: Request):
    return await W.start_topup(owner(request)["uid"], round(body.amount_usd * 100), body.save_for_auto_reload)


@router.post("/api/agentpay/topup/{order_id}/capture")
async def topup_capture(order_id: str, request: Request):
    return await W.finish_topup(owner(request)["uid"], order_id)


@router.post("/api/agentpay/withdraw")
async def withdraw(request: Request):
    return await W.withdraw(owner(request)["uid"])


INSIGHT_SYSTEM = """You are the finance assistant inside Cite & Slayy's Agent Pay. You get a wallet's spending rules and its
recent ledger (newest first). In at most 5 short bullet points, tell the owner: what their agents spent and on what,
anything unusual (blocked calls, repeated approval requests, a single agent dominating spend, auto-reloads), and one
concrete rule change if it would help. Quote real numbers from the ledger only. Plain English, no preamble."""


@router.get("/api/agentpay/insights")
async def insights(request: Request):
    u = owner(request)
    w = W.get_wallet(u["uid"])
    rows = W.ledger(u["uid"], 80)
    if not rows:
        return {"text": "No activity yet. Create an agent key and top up to get started.", "engine": "rules"}
    compact = [{k: r.get(k) for k in ("at", "type", "amount_cents", "balance_after_cents", "agent", "refs", "detail")} for r in rows]
    if llm.available():
        try:
            text = await llm.complete(INSIGHT_SYSTEM, json.dumps({"mandate": w["mandate"], "ledger": compact}),
                                      effort="low", max_tokens=600, tier="fast")
            return {"text": text.strip(), "engine": "ai"}
        except llm.LLMError:
            pass
    spent = -sum(r["amount_cents"] for r in rows if r["type"] in ("charge", "credit"))   # charges < 0, credits > 0
    blocked = sum(1 for r in rows if r["type"] == "blocked")
    return {"text": f"- Spent ${spent / 100:.2f} across {sum(1 for r in rows if r['type'] == 'charge')} paid checks.\n"
                    f"- {blocked} call(s) were blocked by your rules.", "engine": "rules"}


# ---------- the agent-facing paid API (Bearer agent key, no cookie) ----------

class VerifyIn(BaseModel):
    references: list[str] = Field(min_length=1, max_length=200)
    request_id: str | None = None
    check_retraction: bool = True


def _bearer(request: Request) -> str | None:
    h = request.headers.get("authorization") or ""
    return h[7:].strip() if h.lower().startswith("bearer ") else None


@router.get("/api/agent/v1/quote")
def quote(n: int, request: Request):
    _, rec = W.key_record(_bearer(request))
    w = W.get_wallet(rec["uid"])
    cost = service.price_cents(max(1, n))
    return {"references": n, "cost_usd": cost / 100, "balance_usd": w["balance_cents"] / 100,
            "mandate": W.mandate_of(w).summary}


@router.post("/api/agent/v1/verify")
async def agent_verify(body: VerifyIn, request: Request):
    return await service.verify(_bearer(request), body.references, body.request_id, body.check_retraction)


@router.get("/api/agent/v1/requests/{request_id}")
def agent_request_status(request_id: str, request: Request):
    _, rec = W.key_record(_bearer(request))
    req = get_store().get("agent_request", request_id)
    if not req or req["uid"] != rec["uid"]:
        raise HTTPException(404, "Request not found")
    return {"request_id": request_id, "status": req["status"]}


# ---------- PayPal plans (international checkout) ----------

class PlanIn(BaseModel):
    item: str


@router.post("/api/billing/paypal/order")
async def plan_order(body: PlanIn, request: Request):
    return await paypal_billing.start(owner(request), body.item)


@router.post("/api/billing/paypal/order/{order_id}/capture")
async def plan_capture(order_id: str, request: Request):
    return await paypal_billing.finish(owner(request), order_id)


# ---------- PayPal.me (manual) ----------

class PayPalMeClaim(BaseModel):
    item: str
    txn_id: str = Field(max_length=40)
    email: str = Field(default="", max_length=160)


@router.post("/api/billing/paypal-me-claim")
def paypal_me_claim(body: PayPalMeClaim, request: Request):
    """Buyer paid with the PayPal.me link and tells us the transaction id. Lands in the same owner review queue as
    UPI claims; nothing is activated until the owner checks the payment in PayPal and approves."""
    import re
    import time
    import uuid
    from backend.accounts.plans import PAPER_PACK, PLANS
    user = owner(request)
    item = body.item.strip().lower()
    if item not in paypal_billing.ITEMS:
        raise HTTPException(400, "Unknown plan or pack")
    txn = re.sub(r"[^A-Za-z0-9]", "", body.txn_id).upper()
    if not 12 <= len(txn) <= 20:
        raise HTTPException(400, "Enter the PayPal transaction ID from your receipt (usually 17 letters and numbers)")
    store = get_store()
    if store.get("upi_utr", f"PP-{txn}"):
        raise HTTPException(409, "This transaction ID has already been submitted. If that wasn't you, contact support.")
    rl_key = f"upi-claim:{user['uid']}"
    recent = [t for t in (store.get("rate", rl_key) or {}).get("ts", []) if t > time.time() - 86400]
    if len(recent) >= 5:
        raise HTTPException(429, "Too many payment claims today. Contact support if you need help.")
    store.put("rate", rl_key, {"ts": recent + [time.time()]})
    info = PAPER_PACK if item == "pack" else PLANS[item]
    cid = uuid.uuid4().hex[:10]
    rec = {"claim_id": cid, "item": item, "item_name": info["name"], "amount_inr": info["price_inr"],
           "amount_usd": info["price_usd"], "method": "paypal_me", "upi_id": get_settings().paypal_me_url,
           "utr": txn, "email": (body.email.strip() or user.get("email") or "")[:160], "uid": user.get("uid"),
           "status": "pending_verification", "created_at": now().isoformat()}
    store.put("upi_claim", cid, rec)
    store.put("upi_utr", f"PP-{txn}", {"claim_id": cid})
    return {"ok": True, **rec}


# ---------- PayPal webhook ----------

@router.post("/api/paypal/webhook")
async def paypal_webhook(request: Request):
    event = json.loads(await request.body())
    if not await paypal.verify_webhook(dict(request.headers), event):
        raise HTTPException(400, "Bad PayPal signature")
    store = get_store()
    if store.get("pp_event", event.get("id", "")):
        return {"ok": True}                 # replayed delivery
    if event.get("event_type") == "PAYMENT.CAPTURE.COMPLETED":
        cap = event.get("resource") or {}
        order_id = ((cap.get("supplementary_data") or {}).get("related_ids") or {}).get("order_id")
        if (cap.get("custom_id") or "").startswith("wallet:"):
            await W.webhook_capture(cap, order_id)
        elif (cap.get("custom_id") or "").startswith("plan:"):
            paypal_billing.webhook_capture(cap, order_id)
    # remembered only once handled: if crediting crashed, PayPal's retry must not be skipped (crediting is idempotent)
    store.put("pp_event", event.get("id", ""), {"type": event.get("event_type"), "at": now().isoformat()})
    return {"ok": True}
