"""Users, sessions, sign-in (Google or emailed magic link), quotas and per-user data ownership.

Sessions are a signed cookie (`uid.expiry.hmac`), so no session table is needed. With AUTH_REQUIRED=false (local dev,
tests) every request acts as one local user and ownership checks are skipped.
"""
from __future__ import annotations

import asyncio
import base64
import json
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
LOCAL_USER = {"uid": "local", "email": "local@localhost", "name": "Researcher", "plan": "max", "is_owner": True, "picture": None}


def owner_emails() -> set[str]:
    s = get_settings()
    items = {e.strip().lower() for e in (s.owner_emails or "").split(",") if "@" in e}
    ce = (s.contact_email or "").strip().lower()
    if "@" in ce and not ce.endswith(("@example.com", "@localhost", "@x.org", "@uni.edu")):
        items.add(ce)
    return items


def founder_accounts() -> dict[str, str]:
    """{email: password hash} from FOUNDER_ACCOUNTS (base64url JSON). Only hashes are ever configured."""
    raw = (get_settings().founder_accounts or "").strip()
    if not raw:
        return {}
    try:
        data = json.loads(base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)))
        return {e.strip().lower(): h for e, h in data.items() if "@" in e and str(h).startswith("scrypt$")}
    except (ValueError, TypeError):
        return {}


def ensure_founders() -> list[str]:
    """Create or repair the founder accounts at startup: Max plan, owner/admin, no expiry.
    A pre-existing account on a founder email gets the founder password (and its sessions revoked) unless a founder
    already set their own password after the configured one was applied."""
    store = get_store()
    done = []
    names = {k.strip().lower(): v.strip() for k, _, v in (p.partition("=") for p in (get_settings().founder_names or "").split(";")) if "@" in k and v.strip()}
    for email, h in founder_accounts().items():
        idx = store.get("user_email", email)
        user = get_user(idx["uid"]) if idx else None
        if not user:
            user = {"uid": uuid.uuid4().hex[:16], "email": email, "name": email.split("@")[0], "picture": None,
                    "provider": "password", "sess_ver": 0, "created_at": now().isoformat()}
            store.put("user_email", email, {"uid": user["uid"]})
        if user.get("founder_hash_applied") != h:
            user["password_hash"] = h
            user["founder_hash_applied"] = h
            user["sess_ver"] = int(user.get("sess_ver") or 0) + 1
        user.update(founder=True, is_owner=True, plan="max", email_verified=True, disabled=False, plan_expires=None)
        nice = names.get(email)
        if nice and (not user.get("name") or user.get("name") == email.split("@")[0]):   # don't override a name they set themselves
            user["name"] = nice
        store.put("user", user["uid"], user)
        done.append(email)
    if done:   # founders are the only permanent admins: revoke owner rights handed out any other way (e.g. an old access key)
        keep = set(founder_accounts()) | owner_emails()
        for u in store.list("user", 100000):
            if u.get("is_owner") and (u.get("email") or "").lower() not in keep:
                u["is_owner"] = False
                if u.get("plan") == "max" and not u.get("subscription_id") and not u.get("plan_expires"):
                    u["plan"] = "free"
                store.put("user", u["uid"], u)
    return done


def is_owner(user: dict | None) -> bool:
    if not user:
        return False
    if not get_settings().auth_required or user.get("uid") == "local" or user.get("is_owner"):
        return True
    if user.get("founder") and (user.get("email") or "").lower() in founder_accounts():
        return True
    verified = user.get("email_verified", user.get("provider") in ("google", "email"))
    return bool(verified) and (user.get("email") or "").strip().lower() in owner_emails()


def is_paid(user: dict | None) -> bool:
    """True for Dev Owner, Pro, Max, or any user with an active Paper Pack."""
    if not user:
        return False
    return is_owner(user) or plan_of(user)["engine"] == "premium" or bool(bonus(user))


def require_paid(user: dict, feature: str) -> None:
    """Enforce that a feature is available exclusively to Paid plans (Pro, Max, Paper Pack) and the Dev Owner."""
    if is_paid(user):
        return
    label = FEATURE_LABEL.get(feature, feature)
    raise HTTPException(402, {
        "code": "paid_only",
        "feature": feature,
        "label": label,
        "limit": 0,
        "plan": user.get("plan", "free"),
        "message": f"{label[:1].upper() + label[1:]} is a paid feature (Pro, Max, or Paper Pack). Upgrade to unlock!",
    })

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
    """`uid.version.expiry.hmac`. Bumping the user's session version (password change, sign out everywhere) revokes all."""
    exp = int(time.time()) + SESSION_DAYS * 86400
    ver = int((get_user(uid) or {}).get("sess_ver", 0))
    return f"{uid}.{ver}.{exp}.{_sign(f'{uid}.{ver}.{exp}')}"


def uid_from_token(tok: str | None) -> str | None:
    try:
        uid, ver, exp, sig = (tok or "").split(".")
        if int(exp) < time.time() or not hmac.compare_digest(sig, _sign(f"{uid}.{ver}.{exp}")):
            return None
    except ValueError:
        return None
    user = get_user(uid)
    if not user or int(user.get("sess_ver", 0)) != int(ver) or user.get("disabled"):
        return None
    return uid


# ---------- email + password ----------

_COMMON = {"password", "password1", "12345678", "123456789", "qwerty123", "iloveyou", "11111111", "abc12345", "letmein1", "welcome1"}


def password_problem(pw: str, email: str = "") -> str | None:
    if len(pw) < 8:
        return "Use at least 8 characters."
    if len(pw) > 128:
        return "Use at most 128 characters."
    if not (any(c.isalpha() for c in pw) and any(c.isdigit() for c in pw)):
        return "Use both letters and numbers."
    if pw.lower() in _COMMON or (email and pw.lower() == email.split("@")[0].lower()):
        return "That password is too easy to guess."
    return None


def hash_password(pw: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(pw.encode(), salt=salt, n=2 ** 14, r=8, p=1, dklen=32)
    return "scrypt$16384$8$1$" + salt.hex() + "$" + dk.hex()


def verify_password(pw: str, stored: str | None) -> bool:
    try:
        _, n, r, p, salt, dk = (stored or "").split("$")
        got = hashlib.scrypt(pw.encode(), salt=bytes.fromhex(salt), n=int(n), r=int(r), p=int(p), dklen=len(dk) // 2)
        return hmac.compare_digest(got.hex(), dk)
    except (ValueError, TypeError):
        hashlib.scrypt(b"x", salt=b"0" * 16, n=2 ** 14, r=8, p=1, dklen=32)   # equal work for unknown users
        return False


def _limit(key: str, max_hits: int, window: int) -> None:
    store = get_store()
    hits = [t for t in (store.get("rate", key) or {}).get("ts", []) if t > time.time() - window]
    if len(hits) >= max_hits:
        raise HTTPException(429, f"Too many attempts. Try again in {max(1, window // 60)} minutes.")
    store.put("rate", key, {"ts": hits + [time.time()]})


def _clear_limit(key: str) -> None:
    get_store().put("rate", key, {"ts": []})


def register(email: str, name: str, password: str, ip: str) -> dict:
    email = (email or "").strip().lower()
    if "@" not in email or "." not in email.split("@")[-1] or len(email) > 200:
        raise HTTPException(400, "Enter a valid email address.")
    if (prob := password_problem(password, email)):
        raise HTTPException(400, prob)
    _limit(f"register-ip:{ip}", 10, 3600)
    store = get_store()
    if store.get("user_email", email):
        # never attach a password to an existing account (prevents takeover of Google / email-link accounts)
        raise HTTPException(409, "An account with this email already exists. Sign in instead.")
    user = {"uid": uuid.uuid4().hex[:16], "email": email, "name": (name or "").strip()[:80] or email.split("@")[0], "picture": None,
            "plan": "free", "is_owner": False, "provider": "password", "email_verified": False,
            "password_hash": hash_password(password), "sess_ver": 0, "created_at": now().isoformat(), "last_login": now().isoformat()}
    store.put("user_email", email, {"uid": user["uid"]})
    store.put("user", user["uid"], user)
    return user


def login_password(email: str, password: str, ip: str) -> dict:
    email = (email or "").strip().lower()
    _limit(f"login-ip:{ip}", 30, 900)
    _limit(f"login-email:{email}", 6, 900)
    idx = get_store().get("user_email", email)
    user = get_user(idx["uid"]) if idx else None
    if not user or not verify_password(password, user.get("password_hash")) or user.get("disabled"):
        if user and not user.get("password_hash"):
            raise HTTPException(401, "This account uses Google or an email link. Use that to sign in.")
        raise HTTPException(401, "Email or password is incorrect.")
    _clear_limit(f"login-email:{email}")
    user["last_login"] = now().isoformat()
    get_store().put("user", user["uid"], user)
    return user


def change_password(user: dict, current: str, new: str) -> dict:
    if user.get("password_hash") and not verify_password(current, user["password_hash"]):
        raise HTTPException(401, "Current password is incorrect.")
    if (prob := password_problem(new, user.get("email", ""))):
        raise HTTPException(400, prob)
    user["password_hash"] = hash_password(new)
    user["sess_ver"] = int(user.get("sess_ver", 0)) + 1      # sign out every other session
    get_store().put("user", user["uid"], user)
    return user


def revoke_sessions(user: dict) -> dict:
    user["sess_ver"] = int(user.get("sess_ver", 0)) + 1
    get_store().put("user", user["uid"], user)
    return user


def set_session(resp: Response, uid: str) -> None:
    secure = get_settings().public_url.startswith("https://")
    resp.set_cookie(COOKIE, session_token(uid), max_age=SESSION_DAYS * 86400, httponly=True, samesite="lax", secure=secure, path="/")


# ---------- users ----------

def get_user(uid: str) -> dict | None:
    return get_store().get("user", uid)


def upsert_user(email: str, name: str | None = None, picture: str | None = None, provider: str = "email",
                proven_by_password_holder: bool = False) -> dict:
    """Sign-in that proves the email (Google / magic link). `proven_by_password_holder`: the link was opened in a browser
    already signed in to this account with its password, so the password holder owns the inbox: keep the password."""
    store = get_store()
    email = email.strip().lower()
    idx = store.get("user_email", email)
    user = get_user(idx["uid"]) if idx else None
    if not user:
        is_own = email in owner_emails()
        user = {"uid": uuid.uuid4().hex[:16], "email": email, "name": name or email.split("@")[0], "picture": picture,
                "plan": "max" if is_own else "free", "is_owner": is_own, "provider": provider, "email_verified": True,
                "sess_ver": 0, "created_at": now().isoformat()}
        store.put("user_email", email, {"uid": user["uid"]})
    else:
        user.update({k: v for k, v in {"name": name, "picture": picture}.items() if v})
        if not user.get("email_verified") and user.get("password_hash") and not proven_by_password_holder:
            # Someone registered this address with a password but never proved they own it. The real owner just did:
            # drop that password and its sessions, or whoever set it could sign in to the now-verified account.
            user["password_hash"] = None
            user["sess_ver"] = int(user.get("sess_ver") or 0) + 1
        user["email_verified"] = True            # Google / email link prove ownership of the address
        if email in owner_emails():
            user["is_owner"] = True
            user["plan"] = "max"
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
    """Count one use of a metered feature, or raise 402 with an upgrade hint when the plan's limit is reached.
    Dev Owner always has unlimited access to every feature."""
    if not get_settings().auth_required or is_owner(user):
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
    if not get_settings().auth_required or is_owner(user):
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
    return is_owner(user) or plan_of(user)["engine"] == "premium" or bool(user.get("_used_pack")) or bool(bonus(user))


def unlock_owner(user: dict, access_key: str) -> bool:
    """Promote the signed-in user to Dev Owner when they present the configured OWNER_ACCESS_KEY."""
    expected = (get_settings().owner_access_key or "").strip()
    if not expected or not access_key.strip():
        return False
    if not hmac.compare_digest(access_key.strip(), expected):
        return False
    user["is_owner"] = True
    user["plan"] = "max"
    if user.get("uid") and user.get("uid") != "local":
        get_store().put("user", user["uid"], user)
    return True


# ---------- ownership ----------

# Content-addressed kinds: the id is a hash of the bytes, so two users uploading the same file get the same id.
# Anyone who uploaded the bytes may read them, so later uploaders get a co-owner grant instead of a 404.
SHARED_BY_CONTENT = {"document"}


def own(kind: str, id: str, user: dict) -> None:
    if not (get_settings().auth_required and id):
        return
    store = get_store()
    store.set_owner(kind, id, user["uid"])
    if kind in SHARED_BY_CONTENT and store.owner_of(kind, id) != user["uid"]:
        store.set_owner(f"{kind}+", f"{id}:{user['uid']}", user["uid"])


def make_public(kind: str, id: str) -> None:
    """Bundled content someone claimed by uploading it: readable by everyone again (the uploader keeps a grant)."""
    store = get_store()
    if (uid := store.owner_of(kind, id)) is None:
        return
    if kind in SHARED_BY_CONTENT:
        store.set_owner(f"{kind}+", f"{id}:{uid}", uid)
    store.clear_owner(kind, id)


def check_access(kind: str, id: str, user: dict) -> None:
    """Owned by someone else -> 404 (don't reveal it exists). Unowned legacy/demo objects stay readable."""
    if not get_settings().auth_required:
        return
    store = get_store()
    owner = store.owner_of(kind, id)
    if owner and owner != user["uid"]:
        if kind in SHARED_BY_CONTENT and store.owner_of(f"{kind}+", f"{id}:{user['uid']}") == user["uid"]:
            return
        raise HTTPException(404, "not found")


def workspace_key(kind: str, user: dict) -> str:
    return f"{user['uid']}:{kind}" if get_settings().auth_required else kind


def mine(kind: str, user: dict, limit: int = 50) -> list[dict]:
    """This user's newest objects of `kind` (everything when sign-in is off)."""
    if not get_settings().auth_required:
        return get_store().list(kind, limit)
    return get_store().list_owned(kind, user["uid"], limit)


def visible(kind: str, items: list[dict], id_key: str, user: dict) -> list[dict]:
    if not get_settings().auth_required:
        return items
    mine = get_store().owned_ids(kind, user["uid"])
    return [x for x in items if x.get(id_key) in mine]
