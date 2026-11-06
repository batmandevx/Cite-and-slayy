"""Agent wallets: prepaid USD balance an AI agent spends on CiteGuard checks, funded and refunded through PayPal.

Money flow
- Owner tops up with PayPal Checkout (buyer present). They may save their PayPal account at the same time.
- Agent calls the paid API with its key. The mandate decides; the wallet is debited; CiteGuard runs.
- References we could not settle (a source was down) are credited straight back: agents pay for answers, not attempts.
- If the balance runs short and the mandate allows it, the wallet reloads itself from the saved PayPal account.
- The owner can withdraw the unused balance at any time: it is refunded to PayPal against the original captures.

All amounts are integer US cents. Every change writes one ledger row, so the balance is always explainable.
"""
from __future__ import annotations

import asyncio
import hashlib
import secrets
import uuid

from fastapi import HTTPException

from backend.agentpay.mandate import DEFAULT, Mandate, clamp
from backend.cache.store import get_store, now
from backend.common.config import get_settings
from backend.payments import paypal

_locks: dict[str, asyncio.Lock] = {}


def lock(uid: str) -> asyncio.Lock:
    return _locks.setdefault(uid, asyncio.Lock())


def month() -> str:
    return now().strftime("%Y-%m")


# ---------- wallet ----------

def get_wallet(uid: str) -> dict:
    w = get_store().get("agent_wallet", uid)
    if not w:
        w = {"uid": uid, "balance_cents": 0, "mandate": clamp(DEFAULT).model_dump(), "mandate_text": "",
             "mandate_engine": "default", "vault_id": None, "spent": {}, "topped_up": {}, "created_at": now().isoformat()}
        get_store().put("agent_wallet", uid, w)
    return w


def save_wallet(w: dict) -> None:
    get_store().put("agent_wallet", w["uid"], w)


def mandate_of(w: dict) -> Mandate:
    return Mandate.model_validate(w["mandate"])


def month_spent(w: dict) -> int:
    return int((w.get("spent") or {}).get(month(), 0))


def public_wallet(w: dict) -> dict:
    m = mandate_of(w)
    return {"balance_usd": w["balance_cents"] / 100, "month_spent_usd": month_spent(w) / 100,
            "month_left_usd": max(0, round(m.monthly_cap_usd * 100) - month_spent(w)) / 100,
            "mandate": m.model_dump(), "mandate_text": w.get("mandate_text", ""), "mandate_engine": w.get("mandate_engine"),
            "auto_reload_ready": bool(w.get("vault_id")), "price_per_ref_usd": get_settings().agent_price_per_ref_usd,
            "paypal": paypal.enabled(), "paypal_env": get_settings().paypal_env}


# ---------- ledger ----------

def ledger_add(uid: str, kind: str, amount_cents: int, balance_after: int, detail: str, **extra) -> dict:
    row = {"id": uuid.uuid4().hex[:16], "uid": uid, "at": now().isoformat(), "type": kind, "amount_cents": amount_cents,
           "balance_after_cents": balance_after, "detail": detail[:300], **extra}
    store = get_store()
    store.put("agent_ledger", row["id"], row)
    store.set_owner("agent_ledger", row["id"], uid)
    return row


def ledger(uid: str, limit: int = 500) -> list[dict]:
    store = get_store()
    rows = [r for i in store.owned_ids("agent_ledger", uid) if (r := store.get("agent_ledger", i))]
    rows.sort(key=lambda r: r["at"], reverse=True)
    return rows[:limit]


# ---------- agent keys ----------

def _hash(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def create_key(uid: str, name: str) -> tuple[str, dict]:
    name = (name or "my-agent").strip()[:40] or "my-agent"
    key = "csk_" + secrets.token_urlsafe(30)
    rec = {"id": uuid.uuid4().hex[:12], "uid": uid, "name": name, "prefix": key[:10], "created_at": now().isoformat(),
           "revoked": False, "last_used": None, "calls": 0}
    store = get_store()
    store.put("agent_key", _hash(key), rec)
    store.put("agent_key_id", rec["id"], {"hash": _hash(key), "uid": uid})
    store.set_owner("agent_key_id", rec["id"], uid)
    return key, rec


def list_keys(uid: str) -> list[dict]:
    store = get_store()
    out = []
    for kid in store.owned_ids("agent_key_id", uid):
        ref = store.get("agent_key_id", kid)
        if ref and (rec := store.get("agent_key", ref["hash"])):
            out.append(rec)
    return sorted(out, key=lambda r: r["created_at"], reverse=True)


def revoke_key(uid: str, key_id: str) -> None:
    store = get_store()
    ref = store.get("agent_key_id", key_id)
    if not ref or ref["uid"] != uid:
        raise HTTPException(404, "Key not found")
    rec = store.get("agent_key", ref["hash"])
    store.put("agent_key", ref["hash"], {**rec, "revoked": True})


def key_record(key: str | None) -> tuple[str, dict]:
    if not key or not key.startswith("csk_"):
        raise HTTPException(401, "Missing agent key. Send 'Authorization: Bearer csk_...'.")
    rec = get_store().get("agent_key", _hash(key))
    if not rec or rec.get("revoked"):
        raise HTTPException(401, "Unknown or revoked agent key")
    return _hash(key), rec


def touch_key(h: str, rec: dict) -> None:
    get_store().put("agent_key", h, {**rec, "last_used": now().isoformat(), "calls": rec.get("calls", 0) + 1})


# ---------- PayPal top-ups ----------

def _owner_tag(uid: str) -> str:
    return f"wallet:{uid}"


async def start_topup(uid: str, amount_cents: int, save_for_auto_reload: bool) -> dict:
    if not 500 <= amount_cents <= round(get_settings().agent_max_topup_usd * 100):
        raise HTTPException(400, f"Top up between $5 and ${get_settings().agent_max_topup_usd:.0f}")
    order = await paypal.create_order(amount_cents, description="Cite & Slayy agent wallet top-up",
                                      custom_id=_owner_tag(uid), save_payment_method=save_for_auto_reload)
    get_store().put("agent_topup", order["id"], {"id": order["id"], "uid": uid, "amount_cents": amount_cents,
                                                 "status": "created", "auto": False, "refunded_cents": 0,
                                                 "created_at": now().isoformat()})
    return {"order_id": order["id"]}


def _credit(rec: dict, capture: dict, vault_id: str | None, how: str) -> dict | None:
    """Credit a captured top-up exactly once. Returns the ledger row, or None if it was already credited."""
    store = get_store()
    rec = store.get("agent_topup", rec["id"]) or rec
    if rec.get("status") == "credited":
        return None
    got = paypal.cents(capture.get("amount"))
    if got != rec["amount_cents"]:
        raise HTTPException(400, "PayPal captured a different amount than this top-up")
    w = get_wallet(rec["uid"])
    w["balance_cents"] += got
    w.setdefault("topped_up", {})[month()] = w.get("topped_up", {}).get(month(), 0) + got
    if vault_id:
        w["vault_id"] = vault_id
    save_wallet(w)
    store.put("agent_topup", rec["id"], {**rec, "status": "credited", "capture_id": capture["id"], "credited_at": now().isoformat()})
    return ledger_add(rec["uid"], how, got, w["balance_cents"],
                      "Saved PayPal account charged automatically (mandate allows auto-reload)" if how == "auto_reload"
                      else "Top-up paid with PayPal" + (" · PayPal saved for auto-reload" if vault_id else ""),
                      paypal_order=rec["id"], paypal_capture=capture["id"])


async def finish_topup(uid: str, order_id: str) -> dict:
    store = get_store()
    rec = store.get("agent_topup", order_id)
    if not rec or rec["uid"] != uid:
        raise HTTPException(404, "Top-up not found")
    async with lock(uid):
        if rec.get("status") != "credited":
            order = await paypal.get_order(order_id)
            if order.get("status") == "APPROVED":
                order = await paypal.capture_order(order_id)
            cap = paypal.completed_capture(order)
            if not cap or paypal.custom_id_of(order) != _owner_tag(uid):
                raise HTTPException(402, "PayPal hasn't completed this payment yet")
            _credit(rec, cap, paypal.vault_id_of(order), "topup")
    return public_wallet(get_wallet(uid))


async def webhook_capture(capture: dict, order_id: str | None) -> None:
    """PAYMENT.CAPTURE.COMPLETED: the safety net if the browser closed before /capture came back."""
    rec = get_store().get("agent_topup", order_id or "")
    if rec and capture.get("custom_id") == _owner_tag(rec["uid"]) and capture.get("status") == "COMPLETED":
        async with lock(rec["uid"]):
            _credit(rec, capture, None, "auto_reload" if rec.get("auto") else "topup")


async def try_auto_reload(w: dict, need_cents: int) -> bool:
    """Reload from the saved PayPal account if the mandate allows it. Caller holds the wallet lock."""
    m = mandate_of(w)
    if not (m.auto_topup and w.get("vault_id") and paypal.enabled()):
        return False
    amount = max(round(m.auto_topup_amount_usd * 100), need_cents - w["balance_cents"])
    # Reloads in a month can't exceed the monthly cap: a runaway agent can't drain the owner's PayPal.
    if w.get("topped_up", {}).get(month(), 0) + amount > round(m.monthly_cap_usd * 100) + round(m.auto_topup_amount_usd * 100):
        return False
    rid = f"auto-{w['uid']}-{uuid.uuid4().hex[:10]}"
    try:
        order = await paypal.charge_vault(w["vault_id"], amount, description="Cite & Slayy agent wallet auto-reload",
                                          custom_id=_owner_tag(w["uid"]), request_id=rid)
    except HTTPException as e:
        ledger_add(w["uid"], "auto_reload_failed", 0, w["balance_cents"], f"Auto-reload declined: {e.detail}")
        return False
    rec = {"id": order["id"], "uid": w["uid"], "amount_cents": amount, "status": "created", "auto": True,
           "refunded_cents": 0, "created_at": now().isoformat()}
    get_store().put("agent_topup", order["id"], rec)
    cap = paypal.completed_capture(order)
    if not cap:
        return False          # PENDING: the webhook will credit it when PayPal settles
    _credit(rec, cap, None, "auto_reload")
    w.update(get_wallet(w["uid"]))
    return True


async def withdraw(uid: str) -> dict:
    """Refund the unused balance to PayPal, newest captures first. Each capture refunds at most what it brought in."""
    store = get_store()
    async with lock(uid):
        w = get_wallet(uid)
        left = w["balance_cents"]
        if left <= 0:
            raise HTTPException(400, "Nothing to withdraw")
        tops = [store.get("agent_topup", r["paypal_order"]) for r in ledger(uid) if r.get("paypal_order")]
        tops = [t for t in tops if t and t.get("status") == "credited" and t["amount_cents"] > t.get("refunded_cents", 0)]
        refunded = 0
        for t in tops:
            if left <= 0:
                break
            amt = min(left, t["amount_cents"] - t.get("refunded_cents", 0))
            r = await paypal.refund_capture(t["capture_id"], amt, "Unused Cite & Slayy agent balance",
                                            request_id=f"refund-{t['id']}-{t.get('refunded_cents', 0)}")
            t["refunded_cents"] = t.get("refunded_cents", 0) + amt
            store.put("agent_topup", t["id"], t)
            left -= amt
            refunded += amt
            w["balance_cents"] -= amt
            save_wallet(w)
            ledger_add(uid, "withdrawal", -amt, w["balance_cents"], "Unused balance refunded to PayPal",
                       paypal_capture=t["capture_id"], paypal_refund=r.get("id"), paypal_status=r.get("status"))
        if not refunded:
            raise HTTPException(409, "No refundable PayPal payments found for this balance")
    return public_wallet(get_wallet(uid))
