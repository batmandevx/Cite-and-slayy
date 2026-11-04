"""Public-site plumbing: the contact form (stored, and emailed to support when SMTP is set) and first-party
conversion counters (daily totals per event name, no cookies, no IPs or user ids stored)."""
from __future__ import annotations

import asyncio
import re
import smtplib
import time
import uuid
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from backend.accounts import auth
from backend.cache.store import get_store
from backend.common.config import get_settings

router = APIRouter()

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _ip(request: Request) -> str:
    # Caddy appends the real client address last; earlier entries can be forged by the client.
    fwd = request.headers.get("x-forwarded-for", "")
    return (fwd.split(",")[-1].strip() or (request.client.host if request.client else "unknown"))[:64]


def _hit(key: str, max_hits: int, window: int) -> None:
    store = get_store()
    hits = [t for t in (store.get("rate", key) or {}).get("ts", []) if t > time.time() - window]
    if len(hits) >= max_hits:
        raise HTTPException(429, "Too many messages from this connection. Please try again later, or email us directly.")
    store.put("rate", key, {"ts": hits + [time.time()]})


def _owner(request: Request) -> dict:
    user = auth.require_user(request)
    if not auth.is_owner(user):
        raise HTTPException(403, "Owner only")
    return user


def _one_line(s: str) -> str:
    return re.sub(r"[\r\n\t]+", " ", s).strip()


# ---------- contact form ----------

class ContactIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: str = Field(min_length=3, max_length=200)
    topic: Literal["support", "billing", "partnership", "press", "feedback", "other"] = "support"
    message: str = Field(min_length=10, max_length=5000)
    website: str = ""          # honeypot: people never see this field, so anything in it means a bot


TOPIC_LABEL = {"support": "Support", "billing": "Payments & billing", "partnership": "Partnership / institution",
               "press": "Press", "feedback": "Feedback", "other": "Other"}


def email_enabled() -> bool:
    s = get_settings()
    return bool(s.smtp_host and s.mail_from)


def _send_notification(msg_rec: dict) -> None:
    s = get_settings()
    m = EmailMessage()
    m["Subject"] = f"[Cite & Slayy contact] {TOPIC_LABEL[msg_rec['topic']]}: {msg_rec['name']}"[:200]
    m["From"] = s.mail_from
    m["To"] = s.support_email
    m["Reply-To"] = msg_rec["email"]
    m.set_content(
        f"New message from the contact form on citeslayy.com\n\n"
        f"From:   {msg_rec['name']} <{msg_rec['email']}>\n"
        f"Topic:  {TOPIC_LABEL[msg_rec['topic']]}\n"
        f"When:   {msg_rec['created_at']}\n"
        f"Ref:    {msg_rec['id']}\n\n"
        f"{msg_rec['message']}\n\n"
        f"-- Reply to this email to answer them directly."
    )
    with smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=20) as smtp:
        smtp.starttls()
        if s.smtp_user:
            smtp.login(s.smtp_user, s.smtp_password or "")
        smtp.send_message(m)


@router.post("/api/contact")
async def contact(body: ContactIn, request: Request):
    if body.website:                                   # bot: pretend it worked, store nothing
        return {"ok": True, "id": "ok"}
    email = _one_line(body.email).lower()
    if not EMAIL_RE.match(email):
        raise HTTPException(422, "Please enter a valid email address so we can reply.")
    _hit(f"contact:{_ip(request)}", 5, 3600)
    _hit(f"contact-email:{email}", 5, 3600)
    rec = {"id": uuid.uuid4().hex[:12], "name": _one_line(body.name), "email": email, "topic": body.topic,
           "message": body.message.strip(), "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
           "status": "new", "emailed": False}
    store = get_store()
    store.put("contact_msg", rec["id"], rec)
    if email_enabled():
        try:
            await asyncio.to_thread(_send_notification, rec)
            rec["emailed"] = True
            store.put("contact_msg", rec["id"], rec)
        except Exception:                               # the message is saved either way; the admin inbox shows it
            pass
    return {"ok": True, "id": rec["id"]}


@router.get("/api/admin/contact-messages")
async def admin_contact_messages(request: Request, status: str = "all"):
    _owner(request)
    rows = get_store().list("contact_msg", 500)
    return {"email_notifications": email_enabled(),
            "messages": [r for r in rows if status == "all" or r.get("status") == status]}


@router.post("/api/admin/contact-messages/{mid}/{status}")
async def admin_contact_status(mid: str, status: Literal["new", "done"], request: Request):
    _owner(request)
    store = get_store()
    rec = store.get("contact_msg", mid)
    if not rec:
        raise HTTPException(404, "No such message")
    store.put("contact_msg", mid, {**rec, "status": status})
    return {"ok": True}


# ---------- conversion events ----------

# The only events we count. Anything else is ignored, so the counter can't be filled with junk.
EVENTS = {
    "cta_open_app", "cta_pricing", "video_play", "signup", "login", "checkout_start", "checkout_success",
    "upi_claim", "pack_purchase", "paper_started", "paper_generated", "export", "contact_submit",
}


class EventIn(BaseModel):
    name: str = Field(max_length=40)
    path: str = Field(default="", max_length=120)


def _day(offset: int = 0) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=offset)).strftime("%Y-%m-%d")


@router.post("/api/events", status_code=204)
async def event(body: EventIn, request: Request):
    if body.name not in EVENTS:
        return None
    try:
        _hit(f"events:{_ip(request)}", 120, 600)
    except HTTPException:
        return None
    store = get_store()
    day = _day()
    rec = store.get("conv_day", day) or {"day": day, "counts": {}, "paths": {}}
    rec["counts"][body.name] = rec["counts"].get(body.name, 0) + 1
    path = re.sub(r"[^a-z0-9/_-]", "", body.path.lower().split("?")[0])[:60] or "/"
    key = f"{body.name} {path}"
    if key in rec["paths"] or len(rec["paths"]) < 300:
        rec["paths"][key] = rec["paths"].get(key, 0) + 1
    store.put("conv_day", day, rec)
    return None


@router.get("/api/admin/conversions")
async def admin_conversions(request: Request, days: int = 30):
    _owner(request)
    days = max(1, min(days, 90))
    store = get_store()
    series = [store.get("conv_day", _day(i)) or {"day": _day(i), "counts": {}, "paths": {}} for i in range(days)][::-1]
    totals: dict[str, int] = {}
    for d in series:
        for k, v in d["counts"].items():
            totals[k] = totals.get(k, 0) + v
    return {"days": days, "totals": totals, "series": series}
