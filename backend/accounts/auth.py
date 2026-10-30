"""Users, sessions, sign-in (Google or emailed magic link), quotas and per-user data ownership.

Sessions are a signed cookie (`uid.expiry.hmac`), so no session table is needed. With AUTH_REQUIRED=false (local dev,
tests) every request acts as one local user and ownership checks are skipped.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import secrets
import smtplib
import time
import uuid
from datetime import datetime, timezone
from email.message import EmailMessage

from fastapi import HTTPException, Request, Response

from backend.accounts.plans import BUDGETED, FEATURE_LABEL, PAPER_PACK, plan_of
from backend.cache.store import get_store, now
from backend.common.config import get_settings

COOKIE = "slayy_session"
SESSION_DAYS = 30
LOCAL_USER = {"uid": "local", "email": "local@localhost", "name": "Ayush", "plan": "max", "picture": None}

# Job kind -> store kind of the object its result_id points to (ownership is recorded when a job finishes).
JOB_RESULT_KIND = {"gap_radar": "gap_run", "autoclaw": "autoclaw_run", "citeguard": "audit", "jury": "verdict",
                   "paper_studio": "paper_studio", "pipeline": "pipeline"}


# ---------- secrets & cookies ----------

def _secret() -> bytes:
    s = get_settings()
    if s.secret_key:
        return s.secret_key.encode()
    path = s.data_dir / "secret.key"
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(secrets.token_hex(32))
        path.chmod(0o600)
    return path.read_text().strip().encode()


def _sign(msg: str) -> str:
    return hmac.new(_secret(), msg.encode(), hashlib.sha256).hexdigest()


def session_token(uid: str) -> str:
    exp = int(time.time()) + SESSION_DAYS * 86400
    return f"{uid}.{exp}.{_sign(f'{uid}.{exp}')}"


def uid_from_token(tok: str | None) -> str | None:
    try:
        uid, exp, sig = (tok or "").split(".")
    except ValueError:
        return None
    if int(exp) < time.time() or not hmac.compare_digest(sig, _sign(f"{uid}.{exp}")):
        return None
    return uid


def set_session(resp: Response, uid: str) -> None:
    secure = get_settings().public_url.startswith("https://")
    resp.set_cookie(COOKIE, session_token(uid), max_age=SESSION_DAYS * 86400, httponly=True, samesite="lax", secure=secure, path="/")


# ---------- users ----------

def get_user(uid: str) -> dict | None:
    return get_store().get("user", uid)


def upsert_user(email: str, name: str | None = None, picture: str | None = None, provider: str = "email") -> dict:
    store = get_store()
    email = email.strip().lower()
    idx = store.get("user_email", email)
    user = get_user(idx["uid"]) if idx else None
    if not user:
        user = {"uid": uuid.uuid4().hex[:16], "email": email, "name": name or email.split("@")[0], "picture": picture,
                "plan": "free", "provider": provider, "created_at": now().isoformat()}
        store.put("user_email", email, {"uid": user["uid"]})
    else:
        user.update({k: v for k, v in {"name": name, "picture": picture}.items() if v})
    user["last_login"] = now().isoformat()
    store.put("user", user["uid"], user)
    return user


def current_user(request: Request) -> dict | None:
    if not get_settings().auth_required:
        return LOCAL_USER
    uid = uid_from_token(request.cookies.get(COOKIE))
    return get_user(uid) if uid else None


def require_user(request: Request) -> dict:
    u = current_user(request)
    if not u:
        raise HTTPException(401, "Please sign in")
    return u


# ---------- Google ----------

async def verify_google(credential: str) -> dict:
    s = get_settings()
    if not s.google_client_id:
        raise HTTPException(400, "Google sign-in is not configured")
    from google.auth.transport import requests as grequests
    from google.oauth2 import id_token

    try:
        info = await asyncio.to_thread(id_token.verify_oauth2_token, credential, grequests.Request(), s.google_client_id)
    except ValueError as e:
        raise HTTPException(401, f"Google sign-in failed: {e}") from e
    if info.get("iss") not in ("accounts.google.com", "https://accounts.google.com") or not info.get("email"):
        raise HTTPException(401, "Google sign-in failed")
    if not info.get("email_verified"):
        raise HTTPException(401, "Your Google email is not verified")
    return info


# ---------- magic link ----------

def email_login_enabled() -> bool:
    s = get_settings()
    return bool(s.smtp_host and s.mail_from) or s.dev_show_magic_link


def start_magic_link(email: str) -> str:
    store = get_store()
    email = email.strip().lower()
    if "@" not in email or len(email) > 200:
        raise HTTPException(400, "Enter a valid email address")
    rl = store.get("magic_rate", email) or {"ts": []}
    recent = [t for t in rl["ts"] if t > time.time() - 600]
    if len(recent) >= 3:
        raise HTTPException(429, "Too many login emails. Try again in a few minutes.")
    store.put("magic_rate", email, {"ts": recent + [time.time()]})
    token = secrets.token_urlsafe(32)
    store.put("magic", hashlib.sha256(token.encode()).hexdigest(), {"email": email, "exp": time.time() + 900, "used": False})
    s = get_settings()
    return f"{(s.api_public_url or s.public_url).rstrip('/')}/api/auth/email/verify?token={token}"


def send_magic_link(email: str, link: str) -> None:
    s = get_settings()
    msg = EmailMessage()
    msg["Subject"] = "Your Cite & Slayy sign-in link"
    msg["From"] = s.mail_from
    msg["To"] = email
    msg.set_content(f"Click to sign in to Cite & Slayy (valid for 15 minutes):\n\n{link}\n\nIf you didn't ask for this, ignore this email.")
    with smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=20) as smtp:
        smtp.starttls()
        if s.smtp_user:
            smtp.login(s.smtp_user, s.smtp_password or "")
        smtp.send_message(msg)


def consume_magic_link(token: str) -> str:
    store = get_store()
    key = hashlib.sha256(token.encode()).hexdigest()
    rec = store.get("magic", key)
    if not rec or rec["used"] or rec["exp"] < time.time():
        raise HTTPException(400, "This sign-in link is invalid or has expired. Request a new one.")
    store.put("magic", key, {**rec, "used": True})
    return rec["email"]


# ---------- quotas ----------

def _period(feature: str) -> str:
    d = datetime.now(timezone.utc)
    return d.strftime("%Y-%m-%d") if feature.endswith("_day") else d.strftime("%Y-%m")


def ai_spend_inr(user: dict) -> float:
    rec = get_store().get("usage", f"{user['uid']}:cost:{datetime.now(timezone.utc):%Y-%m}") or {}
    return round(rec.get("usd", 0.0) * get_settings().usd_inr, 2)


def bonus(user: dict) -> dict:
    """Active Paper Pack credits (one-time purchases), or {} once expired."""
    b = user.get("bonus") or {}
    if not b or b.get("expires", 0) < time.time():
        return {}
    return b


def grant_pack(user: dict, order_id: str) -> bool:
    """Add one Paper Pack to the user's credits. Idempotent per order."""
    if order_id in (user.get("orders") or []):
        return False
    b = bonus(user) or {"credits": {}, "ai_budget_inr": 0.0, "expires": 0}
    for k, v in PAPER_PACK["grant"].items():
        b["credits"][k] = b["credits"].get(k, 0) + v
    b["ai_budget_inr"] = b.get("ai_budget_inr", 0) + PAPER_PACK["ai_budget_inr"]
    b["expires"] = max(b.get("expires", 0), time.time()) + PAPER_PACK["days"] * 86400
    user["bonus"] = b
    user["orders"] = (user.get("orders") or []) + [order_id]
    get_store().put("user", user["uid"], user)
    return True


def usage(user: dict) -> dict[str, int]:
    store = get_store()
    out = {}
    for f in plan_of(user)["limits"]:
        out[f] = (store.get("usage", f"{user['uid']}:{f}:{_period(f)}") or {}).get("n", 0)
    return out


def consume(user: dict, feature: str, n: int = 1) -> None:
    """Count one use of a metered feature, or raise 402 with an upgrade hint when the plan's limit is reached."""
    if not get_settings().auth_required:
        return
    store = get_store()
    plan = plan_of(user)
    limit = plan["limits"].get(feature)
    b = bonus(user)
    budget = plan["ai_budget_inr"] + (b.get("ai_budget_inr", 0) if b else 0)
    if feature in BUDGETED and ai_spend_inr(user) >= budget:
        raise HTTPException(402, {"code": "budget", "feature": feature, "label": "monthly AI budget", "limit": plan["ai_budget_inr"],
                                  "plan": user.get("plan", "free"),
                                  "message": f"You've reached this month's fair-use AI allowance on the {plan['name']} plan."})
    key = f"{user['uid']}:{feature}:{_period(feature)}"
    used = (store.get("usage", key) or {}).get("n", 0)
    if limit is not None and used + n > limit and b and b["credits"].get(feature, 0) >= n:
        b["credits"][feature] -= n            # monthly allowance used up: spend a Paper Pack credit
        user["bonus"] = b
        store.put("user", user["uid"], user)
        user["_used_pack"] = True
        return
    if limit is not None and used + n > limit:
        raise HTTPException(402, {"code": "quota", "feature": feature, "label": FEATURE_LABEL.get(feature, feature),
                                  "limit": limit, "plan": user.get("plan", "free"),
                                  "message": f"You've used all {limit} {FEATURE_LABEL.get(feature, feature)} on the {plan['name']} plan."})
    store.put("usage", key, {"n": used + n})


def refund(user: dict, feature: str) -> None:
    """Give a use back when the job failed before producing anything."""
    if not get_settings().auth_required:
        return
    store = get_store()
    if user.get("_used_pack"):            # the use came from a Paper Pack: give the pack credit back
        fresh = get_user(user["uid"]) or user
        b = bonus(fresh)
        if b:
            b["credits"][feature] = b["credits"].get(feature, 0) + 1
            fresh["bonus"] = b
            store.put("user", fresh["uid"], fresh)
        return
    key = f"{user['uid']}:{feature}:{_period(feature)}"
    used = (store.get("usage", key) or {}).get("n", 0)
    store.put("usage", key, {"n": max(0, used - 1)})


def is_premium(user: dict) -> bool:
    return plan_of(user)["engine"] == "premium" or bool(user.get("_used_pack")) or bool(bonus(user))


# ---------- ownership ----------

def own(kind: str, id: str, user: dict) -> None:
    if get_settings().auth_required and id:
        get_store().set_owner(kind, id, user["uid"])


def check_access(kind: str, id: str, user: dict) -> None:
    """Owned by someone else -> 404 (don't reveal it exists). Unowned legacy/demo objects stay readable."""
    if not get_settings().auth_required:
        return
    owner = get_store().owner_of(kind, id)
    if owner and owner != user["uid"]:
        raise HTTPException(404, "not found")


def workspace_key(kind: str, user: dict) -> str:
    return f"{user['uid']}:{kind}" if get_settings().auth_required else kind


def visible(kind: str, items: list[dict], id_key: str, user: dict) -> list[dict]:
    if not get_settings().auth_required:
        return items
    mine = get_store().owned_ids(kind, user["uid"])
    return [x for x in items if x.get(id_key) in mine]
