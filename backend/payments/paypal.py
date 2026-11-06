"""PayPal REST client (Orders v2, Payments v2, vaulted payment methods, webhook verification).

Docs used:
- OAuth: POST /v1/oauth2/token (client credentials) -> bearer token, cached until shortly before it expires
- Orders: POST /v2/checkout/orders, GET /v2/checkout/orders/{id}, POST /v2/checkout/orders/{id}/capture
- Save during purchase: payment_source.paypal.attributes.vault.store_in_vault = ON_SUCCESS; the capture response carries
  payment_source.paypal.attributes.vault.id, which later orders pass as payment_source.paypal.vault_id (no buyer present)
- Refunds: POST /v2/payments/captures/{id}/refund
- Webhooks: POST /v1/notifications/verify-webhook-signature

Every money amount in this codebase is integer US cents; PayPal wants strings like "12.50".
"""
from __future__ import annotations

import time
import uuid
from decimal import Decimal

import httpx
from fastapi import HTTPException

from backend.common.config import get_settings

CURRENCY = "USD"
_token: dict = {}
transport: httpx.AsyncBaseTransport | None = None   # tests inject httpx.MockTransport here


def enabled() -> bool:
    s = get_settings()
    return bool(s.paypal_client_id and s.paypal_client_secret)


def base_url() -> str:
    return "https://api-m.paypal.com" if get_settings().paypal_env == "live" else "https://api-m.sandbox.paypal.com"


def money(cents: int) -> dict:
    return {"currency_code": CURRENCY, "value": f"{Decimal(cents) / 100:.2f}"}


def cents(amount: dict | None) -> int:
    """PayPal amount object -> integer cents. Anything that isn't USD counts as zero (we only sell in USD)."""
    if not amount or amount.get("currency_code") != CURRENCY:
        return 0
    return int((Decimal(str(amount.get("value") or "0")) * 100).to_integral_value())


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=30, transport=transport) if transport else httpx.AsyncClient(timeout=30)


async def _access_token() -> str:
    if _token.get("value") and _token.get("exp", 0) > time.time() + 60:
        return _token["value"]
    s = get_settings()
    async with _client() as c:
        r = await c.post(f"{base_url()}/v1/oauth2/token", data={"grant_type": "client_credentials"},
                         auth=(s.paypal_client_id or "", s.paypal_client_secret or ""))
    if r.status_code >= 400:
        raise HTTPException(502, "PayPal rejected our credentials. Check PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET.")
    body = r.json()
    _token.update(value=body["access_token"], exp=time.time() + int(body.get("expires_in", 300)))
    return _token["value"]


async def call(method: str, path: str, body: dict | None = None, request_id: str | None = None) -> dict:
    if not enabled():
        raise HTTPException(503, "PayPal is not set up yet")
    headers = {"Authorization": f"Bearer {await _access_token()}", "Content-Type": "application/json",
               "Prefer": "return=representation"}
    if request_id:
        headers["PayPal-Request-Id"] = request_id     # PayPal replays the first result for a repeated id: no double charges
    async with _client() as c:
        r = await c.request(method, f"{base_url()}{path}", json=body, headers=headers)
    if r.status_code >= 400:
        try:
            err = r.json()
            detail = (err.get("details") or [{}])[0]
            msg = detail.get("description") or err.get("message") or r.text[:200]
            issue = detail.get("issue") or err.get("name")
        except ValueError:
            msg, issue = r.text[:200], None
        raise HTTPException(502, f"PayPal error{f' ({issue})' if issue else ''}: {msg}")
    return r.json() if r.content else {}


async def create_order(amount_cents: int, *, description: str, custom_id: str, invoice_id: str | None = None,
                       save_payment_method: bool = False) -> dict:
    """Buyer-present order, approved with the PayPal JS SDK buttons. Optionally saves the PayPal wallet for later."""
    unit = {"amount": money(amount_cents), "description": description[:127], "custom_id": custom_id[:127]}
    if invoice_id:
        unit["invoice_id"] = invoice_id[:127]
    body: dict = {"intent": "CAPTURE", "purchase_units": [unit]}
    if save_payment_method:
        body["payment_source"] = {"paypal": {
            "attributes": {"vault": {"store_in_vault": "ON_SUCCESS", "usage_type": "MERCHANT",
                                     "permit_multiple_payment_tokens": False}},
            "experience_context": {"shipping_preference": "NO_SHIPPING", "user_action": "PAY_NOW",
                                   "brand_name": "Cite & Slayy"}}}
    else:
        body["payment_source"] = {"paypal": {"experience_context": {"shipping_preference": "NO_SHIPPING",
                                                                    "user_action": "PAY_NOW", "brand_name": "Cite & Slayy"}}}
    return await call("POST", "/v2/checkout/orders", body, request_id=f"create-{custom_id}-{uuid.uuid4().hex[:12]}")


async def charge_vault(vault_id: str, amount_cents: int, *, description: str, custom_id: str, request_id: str) -> dict:
    """Merchant-initiated charge on a saved PayPal wallet (no buyer present). PayPal completes it in one call."""
    body = {"intent": "CAPTURE",
            "purchase_units": [{"amount": money(amount_cents), "description": description[:127], "custom_id": custom_id[:127]}],
            "payment_source": {"paypal": {"vault_id": vault_id,
                                          "stored_credential": {"payment_initiator": "MERCHANT", "usage": "SUBSEQUENT",
                                                                "usage_pattern": "UNSCHEDULED_POSTPAID"}}}}
    return await call("POST", "/v2/checkout/orders", body, request_id=request_id)


async def get_order(order_id: str) -> dict:
    return await call("GET", f"/v2/checkout/orders/{order_id}")


async def capture_order(order_id: str) -> dict:
    return await call("POST", f"/v2/checkout/orders/{order_id}/capture", {}, request_id=f"capture-{order_id}")


async def refund_capture(capture_id: str, amount_cents: int, note: str, request_id: str) -> dict:
    return await call("POST", f"/v2/payments/captures/{capture_id}/refund",
                      {"amount": money(amount_cents), "note_to_payer": note[:255]}, request_id=request_id)


def completed_capture(order: dict) -> dict | None:
    """The COMPLETED capture of an order, or None. Orders we create have exactly one purchase unit."""
    for pu in order.get("purchase_units") or []:
        for cap in ((pu.get("payments") or {}).get("captures") or []):
            if cap.get("status") == "COMPLETED":
                return cap
    return None


def custom_id_of(order: dict) -> str | None:
    pus = order.get("purchase_units") or [{}]
    return pus[0].get("custom_id") or (completed_capture(order) or {}).get("custom_id")


def vault_id_of(order: dict) -> str | None:
    vault = (((order.get("payment_source") or {}).get("paypal") or {}).get("attributes") or {}).get("vault") or {}
    return vault.get("id") if vault.get("status") in (None, "VAULTED") else None


async def verify_webhook(headers: dict, event: dict) -> bool:
    webhook_id = get_settings().paypal_webhook_id
    if not webhook_id:
        raise HTTPException(503, "PAYPAL_WEBHOOK_ID is not configured")
    h = {k.lower(): v for k, v in headers.items()}
    body = {"auth_algo": h.get("paypal-auth-algo"), "cert_url": h.get("paypal-cert-url"),
            "transmission_id": h.get("paypal-transmission-id"), "transmission_sig": h.get("paypal-transmission-sig"),
            "transmission_time": h.get("paypal-transmission-time"), "webhook_id": webhook_id, "webhook_event": event}
    if not all(body.values()):
        return False
    out = await call("POST", "/v1/notifications/verify-webhook-signature", body)
    return out.get("verification_status") == "SUCCESS"
