"""Razorpay subscriptions: plans are created on first use, Checkout authorises the mandate, webhooks keep plans in sync.

Docs used: Subscriptions API (POST /v1/plans, POST /v1/subscriptions, POST /v1/subscriptions/{id}/cancel),
payment signature = HMAC-SHA256(payment_id + "|" + subscription_id, key_secret),
webhook signature = HMAC-SHA256(raw body, webhook secret) in the X-Razorpay-Signature header.
"""
from __future__ import annotations

import hashlib
import hmac
from datetime import datetime, timezone

import httpx
from fastapi import HTTPException

from backend.accounts.auth import get_user
from backend.accounts.plans import PLANS
from backend.cache.store import get_store, now
from backend.common.config import get_settings

API = "https://api.razorpay.com/v1"
ACTIVE = {"authenticated", "active"}          # the user has authorised and (or is about to be) charged
LAPSED = {"halted", "cancelled", "completed", "expired"}


def enabled() -> bool:
    s = get_settings()
    return bool(s.razorpay_key_id and s.razorpay_key_secret)


async def _rzp(method: str, path: str, body: dict | None = None) -> dict:
    s = get_settings()
    async with httpx.AsyncClient(timeout=30, auth=(s.razorpay_key_id or "", s.razorpay_key_secret or "")) as c:
        r = await c.request(method, f"{API}{path}", json=body)
    if r.status_code >= 400:
        try:
            msg = r.json().get("error", {}).get("description", r.text[:200])
        except ValueError:
            msg = r.text[:200]
        raise HTTPException(502, f"Payment provider error: {msg}")
    return r.json()


async def plan_id(tier: str) -> str:
    """Razorpay plan for a tier, created once and remembered (re-created if the price changes)."""
    store = get_store()
    p = PLANS[tier]
    rec = store.get("rzp_plan", tier)
    if rec and rec.get("amount") == p["price_inr"] * 100 and rec.get("key_id") == get_settings().razorpay_key_id:
        return rec["id"]
    out = await _rzp("POST", "/plans", {"period": "monthly", "interval": 1,
                                        "item": {"name": f"Cite & Slayy {p['name']}", "amount": p["price_inr"] * 100, "currency": "INR",
                                                 "description": f"{p['name']} plan, billed monthly"},
                                        "notes": {"tier": tier}})
    store.put("rzp_plan", tier, {"id": out["id"], "amount": p["price_inr"] * 100, "key_id": get_settings().razorpay_key_id})
    return out["id"]


async def subscribe(user: dict, tier: str) -> dict:
    if tier not in ("pro", "max"):
        raise HTTPException(400, "Unknown plan")
    if not enabled():
        raise HTTPException(503, "Payments are not set up yet")
    sub = await _rzp("POST", "/subscriptions", {"plan_id": await plan_id(tier), "total_count": 120, "customer_notify": True,
                                                 "notes": {"uid": user["uid"], "tier": tier, "email": user["email"]}})
    get_store().put("subscription", sub["id"], {"id": sub["id"], "uid": user["uid"], "tier": tier, "status": sub["status"],
                                                 "created_at": now().isoformat()})
    return {"subscription_id": sub["id"], "key_id": get_settings().razorpay_key_id}


def _apply(sub_id: str, status: str, current_end: int | None = None) -> None:
    store = get_store()
    rec = store.get("subscription", sub_id)
    if not rec:
        return
    rec.update(status=status, updated_at=now().isoformat())
    if current_end:
        rec["current_end"] = datetime.fromtimestamp(current_end, timezone.utc).isoformat()
    store.put("subscription", sub_id, rec)
    user = get_user(rec["uid"])
    if not user:
        return
    if status in ACTIVE:
        old = user.get("subscription_id")
        if old and old != sub_id:   # plan switch: stop billing the previous subscription right away
            _cancel_now(old)
        user.update(plan=rec["tier"], subscription_id=sub_id, renews_at=rec.get("current_end"), cancel_at_period_end=False)
    elif status in LAPSED and user.get("subscription_id") == sub_id:
        user.update(plan="free", subscription_id=None, renews_at=None, cancel_at_period_end=False)
    store.put("user", user["uid"], user)


async def buy_pack(user: dict) -> dict:
    from backend.accounts.plans import PAPER_PACK
    if not enabled():
        raise HTTPException(503, "Payments are not set up yet")
    order = await _rzp("POST", "/orders", {"amount": PAPER_PACK["price_inr"] * 100, "currency": "INR",
                                           "receipt": f"pack-{user['uid']}-{int(now().timestamp())}"[:40],
                                           "notes": {"uid": user["uid"], "kind": "pack"}})
    get_store().put("order", order["id"], {"id": order["id"], "uid": user["uid"], "kind": "pack", "status": "created",
                                           "created_at": now().isoformat()})
    return {"order_id": order["id"], "key_id": get_settings().razorpay_key_id, "amount": order["amount"], "currency": "INR"}


def _paid(order_id: str, payment_id: str | None = None) -> None:
    from backend.accounts.auth import grant_pack
    store = get_store()
    rec = store.get("order", order_id)
    if not rec or rec.get("status") == "paid":
        return
    store.put("order", order_id, {**rec, "status": "paid", "paid_at": now().isoformat(), "payment_id": payment_id})
    user = get_user(rec["uid"])
    if user:
        grant_pack(user, order_id)


def _pack_paise() -> int:
    from backend.accounts.plans import PAPER_PACK
    return PAPER_PACK["price_inr"] * 100


async def verify_order(user: dict, order_id: str, payment_id: str, signature: str) -> None:
    """Signature proves the browser didn't make it up; then Razorpay itself must confirm the money for this exact order."""
    store = get_store()
    rec = store.get("order", order_id)
    if not rec or rec["uid"] != user["uid"]:
        raise HTTPException(404, "Order not found")
    expected = hmac.new((get_settings().razorpay_key_secret or "").encode(), f"{order_id}|{payment_id}".encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        raise HTTPException(400, "Payment signature mismatch")
    used = store.get("rzp_payment", payment_id)
    if used and used.get("order_id") != order_id:
        raise HTTPException(409, "This payment was already used for another order")
    pay = await _rzp("GET", f"/payments/{payment_id}")
    if (pay.get("order_id") != order_id or pay.get("status") not in ("captured", "authorized")
            or int(pay.get("amount") or 0) != _pack_paise() or pay.get("currency") != "INR"):
        raise HTTPException(402, "Razorpay hasn't confirmed this payment for the full amount yet. If money left your account, it will update automatically.")
    store.put("rzp_payment", payment_id, {"order_id": order_id, "uid": user["uid"], "at": now().isoformat()})
    _paid(order_id, payment_id)


def _cancel_now(sub_id: str) -> None:
    s = get_settings()
    try:
        httpx.post(f"{API}/subscriptions/{sub_id}/cancel", json={"cancel_at_cycle_end": False},
                   auth=(s.razorpay_key_id or "", s.razorpay_key_secret or ""), timeout=30)
    except httpx.HTTPError:
        pass   # the old subscription's own webhook will still downgrade correctly if this fails
    rec = get_store().get("subscription", sub_id)
    if rec:
        get_store().put("subscription", sub_id, {**rec, "status": "cancelled", "replaced": True})


async def verify_checkout(user: dict, payment_id: str, subscription_id: str, signature: str) -> None:
    rec = get_store().get("subscription", subscription_id)
    if not rec or rec["uid"] != user["uid"]:
        raise HTTPException(404, "Subscription not found")
    expected = hmac.new((get_settings().razorpay_key_secret or "").encode(), f"{payment_id}|{subscription_id}".encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        raise HTTPException(400, "Payment signature mismatch")
    sub = await _rzp("GET", f"/subscriptions/{subscription_id}")    # Razorpay's own record decides, not the browser
    if (sub.get("notes") or {}).get("uid") != user["uid"] or sub.get("plan_id") != (get_store().get("rzp_plan", rec["tier"]) or {}).get("id"):
        raise HTTPException(400, "Subscription doesn't match this account")
    if sub.get("status") not in ACTIVE:
        raise HTTPException(402, "Razorpay hasn't activated this subscription yet. It will update automatically once the payment clears.")
    _apply(subscription_id, sub["status"], sub.get("current_end"))


def handle_webhook(raw: bytes, signature: str | None, event_id: str | None = None) -> None:
    secret = get_settings().razorpay_webhook_secret
    if not secret:
        raise HTTPException(503, "Webhook secret not configured")
    expected = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
    if not signature or not hmac.compare_digest(expected, signature):
        raise HTTPException(400, "Bad signature")
    import json
    store = get_store()
    if event_id:
        if store.get("rzp_event", event_id):
            return                                    # replayed delivery
        store.put("rzp_event", event_id, {"at": now().isoformat()})
    ev = json.loads(raw)
    if ev.get("event") == "order.paid":
        order = ((ev.get("payload") or {}).get("order") or {}).get("entity") or {}
        pay = ((ev.get("payload") or {}).get("payment") or {}).get("entity") or {}
        rec = store.get("order", order.get("id") or "")
        if rec and int(order.get("amount_paid") or 0) >= _pack_paise() and (order.get("notes") or {}).get("uid") == rec["uid"]:
            _paid(order["id"], pay.get("id"))
        return
    sub = ((ev.get("payload") or {}).get("subscription") or {}).get("entity") or {}
    if sub.get("id"):
        _apply(sub["id"], sub.get("status", ""), sub.get("current_end"))


async def cancel(user: dict) -> None:
    sub_id = user.get("subscription_id")
    if not sub_id:
        raise HTTPException(400, "No active subscription")
    await _rzp("POST", f"/subscriptions/{sub_id}/cancel", {"cancel_at_cycle_end": True})
    user["cancel_at_period_end"] = True
    get_store().put("user", user["uid"], user)
