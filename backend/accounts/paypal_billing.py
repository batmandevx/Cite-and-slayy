"""PayPal Checkout for plans and the Paper Pack, for buyers outside India (Razorpay stays for INR).

A plan bought with PayPal is a 30-day pass (the same model as a UPI payment): no stored mandate, nothing to cancel.
custom_id on the order is "plan:<uid>:<tier>", so a webhook can finish the purchase even if the browser never returns.
"""
from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import HTTPException

from backend.accounts.auth import get_user, grant_pack
from backend.accounts.plans import PAPER_PACK, PLANS
from backend.cache.store import get_store, now
from backend.payments import paypal

ITEMS = ("pro", "max", "pack")


def price_cents(item: str) -> int:
    return (PAPER_PACK["price_usd"] if item == "pack" else PLANS[item]["price_usd"]) * 100


async def start(user: dict, item: str) -> dict:
    if item not in ITEMS:
        raise HTTPException(400, "Unknown plan")
    name = PAPER_PACK["name"] if item == "pack" else f"{PLANS[item]['name']} plan, 30 days"
    order = await paypal.create_order(price_cents(item), description=f"Cite & Slayy {name}",
                                      custom_id=f"plan:{user['uid']}:{item}")
    get_store().put("pp_order", order["id"], {"id": order["id"], "uid": user["uid"], "item": item, "status": "created",
                                              "amount_cents": price_cents(item), "created_at": now().isoformat()})
    return {"order_id": order["id"]}


def _activate(rec: dict, capture: dict) -> bool:
    store = get_store()
    rec = store.get("pp_order", rec["id"]) or rec
    if rec.get("status") == "paid":
        return False
    if paypal.cents(capture.get("amount")) != rec["amount_cents"]:
        raise HTTPException(400, "PayPal captured a different amount than this order")
    user = get_user(rec["uid"])
    if not user:
        return False
    if rec["item"] == "pack":
        grant_pack(user, f"paypal-{rec['id']}")
    else:
        base = now()
        try:   # renewing early on the same plan extends from the current expiry
            cur = datetime.fromisoformat(user["plan_expires"]) if user.get("plan_expires") and user.get("plan") == rec["item"] else None
            if cur and cur > base:
                base = cur
        except ValueError:
            pass
        user.update(plan=rec["item"], plan_expires=(base + timedelta(days=30)).isoformat(), plan_source="paypal")
        store.put("user", user["uid"], user)
    store.put("pp_order", rec["id"], {**rec, "status": "paid", "capture_id": capture["id"], "paid_at": now().isoformat()})
    return True


async def finish(user: dict, order_id: str) -> dict:
    rec = get_store().get("pp_order", order_id)
    if not rec or rec["uid"] != user["uid"]:
        raise HTTPException(404, "Order not found")
    if rec.get("status") != "paid":
        order = await paypal.get_order(order_id)
        if order.get("status") == "APPROVED":
            order = await paypal.capture_order(order_id)
        cap = paypal.completed_capture(order)
        if not cap or paypal.custom_id_of(order) != f"plan:{user['uid']}:{rec['item']}":
            raise HTTPException(402, "PayPal hasn't completed this payment yet")
        _activate(rec, cap)
    return {"ok": True, "item": rec["item"]}


def webhook_capture(capture: dict, order_id: str | None) -> None:
    rec = get_store().get("pp_order", order_id or "")
    if rec and capture.get("status") == "COMPLETED" and capture.get("custom_id") == f"plan:{rec['uid']}:{rec['item']}":
        _activate(rec, capture)
