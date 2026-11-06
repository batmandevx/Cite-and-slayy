"""Accounts: sign-in, sessions, per-user isolation, plan limits, AI budget, Razorpay signatures, premium routing."""
import hashlib
import hmac
import json
import re

import pytest
from fastapi.testclient import TestClient

from backend.common.config import get_settings


@pytest.fixture
def prod(monkeypatch):
    """Production-like settings: login required, dev magic links, test Razorpay secrets."""
    for k, v in {"AUTH_REQUIRED": "true", "DEV_SHOW_MAGIC_LINK": "true", "PUBLIC_URL": "http://testserver",
                 "RAZORPAY_KEY_ID": "rzp_test_x", "RAZORPAY_KEY_SECRET": "secret_x", "RAZORPAY_WEBHOOK_SECRET": "whsec"}.items():
        monkeypatch.setenv(k, v)
    get_settings.cache_clear()
    from backend.app.main import app
    yield app
    get_settings.cache_clear()


def login(app, email: str) -> TestClient:
    c = TestClient(app)
    link = c.post("/api/auth/email/start", json={"email": email}).json()["dev_link"]
    r = c.get(link.replace("http://testserver", ""), follow_redirects=False)
    assert r.status_code == 303 and "slayy_session" in r.cookies or "slayy_session" in c.cookies
    return c


def test_api_requires_login(prod):
    c = TestClient(prod)
    assert c.get("/api/dashboard").status_code == 401
    assert c.get("/api/health").status_code == 200 and c.get("/api/billing/plans").status_code == 200


def test_session_cookie_is_tamper_proof(prod):
    from backend.accounts import auth
    from backend.cache.store import get_store
    get_store().put("user", "abc", {"uid": "abc", "email": "abc@x.org", "sess_ver": 0})
    tok = auth.session_token("abc")
    assert auth.uid_from_token(tok) == "abc"
    uid, ver, exp, sig = tok.split(".")
    assert auth.uid_from_token(f"zzz.{ver}.{exp}.{sig}") is None
    assert auth.uid_from_token(f"abc.{ver}.{int(exp) + 5}.{sig}") is None


def test_magic_link_is_single_use_and_user_starts_free(prod):
    c = TestClient(prod)
    link = c.post("/api/auth/email/start", json={"email": "Asha@Uni.edu"}).json()["dev_link"]
    path = link.replace("http://testserver", "")
    assert c.get(path, follow_redirects=False).status_code == 303
    me = c.get("/api/auth/me").json()
    assert me["email"] == "asha@uni.edu" and me["plan"] == "free" and me["limits"]["papers"] == 1
    assert TestClient(prod).get(path, follow_redirects=False).status_code == 400


def test_users_cannot_see_each_others_data(prod):
    a, b = login(prod, "a@x.org"), login(prod, "b@x.org")
    a.put("/api/workspace/pages", json={"items": [{"id": "1", "title": "secret"}]})
    assert b.get("/api/workspace/pages").json()["items"] == []
    from backend.accounts import auth
    from backend.cache.store import get_store
    ua = auth.get_user(get_store().get("user_email", "a@x.org")["uid"])
    get_store().put("paper_studio", "p1", {"paper_id": "p1", "title": "A's paper", "markdown": "x"})
    auth.own("paper_studio", "p1", ua)
    assert a.get("/api/paper-studio/p1").status_code == 200
    assert b.get("/api/paper-studio/p1").status_code == 404
    assert all(p["paper_id"] != "p1" for p in b.get("/api/paper-studio").json())


def test_plan_limit_and_ai_budget_return_402(prod):
    from fastapi import HTTPException

    from backend.accounts import auth
    from backend.cache.store import get_store
    login(prod, "q@x.org")
    user = auth.get_user(get_store().get("user_email", "q@x.org")["uid"])
    auth.consume(user, "papers")                     # free plan: 1 paper / month
    with pytest.raises(HTTPException) as e:
        auth.consume(user, "papers")
    assert e.value.status_code == 402 and e.value.detail["code"] == "quota"
    auth.refund(user, "papers")
    from datetime import datetime, timezone
    get_store().put("usage", f"{user['uid']}:cost:{datetime.now(timezone.utc):%Y-%m}", {"usd": 5.0, "in": 0, "out": 0, "calls": 1})
    with pytest.raises(HTTPException) as e:
        auth.consume(user, "papers")                 # ₹15 free AI budget is spent
    assert e.value.detail["code"] == "budget"


def _fake_rzp(monkeypatch, objects: dict):
    from backend.accounts import billing

    async def fake(method, path, body=None):
        return objects[path]
    monkeypatch.setattr(billing, "_rzp", fake)


def test_razorpay_signatures_and_webhook_upgrade(prod, monkeypatch):
    from backend.accounts import auth, billing
    from backend.cache.store import get_store
    c = login(prod, "pay@x.org")
    user = auth.get_user(get_store().get("user_email", "pay@x.org")["uid"])
    get_store().put("subscription", "sub_1", {"id": "sub_1", "uid": user["uid"], "tier": "pro", "status": "created"})
    get_store().put("rzp_plan", "pro", {"id": "plan_pro", "amount": 699900, "key_id": "rzp_test_x"})
    sig = hmac.new(b"secret_x", b"pay_1|sub_1", hashlib.sha256).hexdigest()
    assert c.post("/api/billing/verify", json={"razorpay_payment_id": "pay_1", "razorpay_subscription_id": "sub_1",
                                               "razorpay_signature": "bad"}).status_code == 400
    # a valid signature isn't enough: Razorpay must show it's this user's subscription and it's active
    _fake_rzp(monkeypatch, {"/subscriptions/sub_1": {"id": "sub_1", "status": "active", "plan_id": "plan_pro", "notes": {"uid": "someone-else"}}})
    assert c.post("/api/billing/verify", json={"razorpay_payment_id": "pay_1", "razorpay_subscription_id": "sub_1",
                                               "razorpay_signature": sig}).status_code == 400
    _fake_rzp(monkeypatch, {"/subscriptions/sub_1": {"id": "sub_1", "status": "created", "plan_id": "plan_pro", "notes": {"uid": user["uid"]}}})
    assert c.post("/api/billing/verify", json={"razorpay_payment_id": "pay_1", "razorpay_subscription_id": "sub_1",
                                               "razorpay_signature": sig}).status_code == 402
    assert c.get("/api/auth/me").json()["plan"] == "free"
    _fake_rzp(monkeypatch, {"/subscriptions/sub_1": {"id": "sub_1", "status": "active", "plan_id": "plan_pro", "notes": {"uid": user["uid"]}}})
    assert c.post("/api/billing/verify", json={"razorpay_payment_id": "pay_1", "razorpay_subscription_id": "sub_1",
                                               "razorpay_signature": sig}).status_code == 200
    assert c.get("/api/auth/me").json()["plan"] == "pro"
    body = json.dumps({"event": "subscription.cancelled", "payload": {"subscription": {"entity": {"id": "sub_1", "status": "cancelled"}}}}).encode()
    anon = TestClient(prod)
    assert anon.post("/api/billing/webhook", content=body, headers={"X-Razorpay-Signature": "nope"}).status_code == 400
    good = hmac.new(b"whsec", body, hashlib.sha256).hexdigest()
    assert anon.post("/api/billing/webhook", content=body, headers={"X-Razorpay-Signature": good, "X-Razorpay-Event-Id": "evt_1"}).status_code == 200
    assert c.get("/api/auth/me").json()["plan"] == "free"
    assert billing.enabled()


def test_paid_plans_route_to_premium_engine(prod, monkeypatch):
    monkeypatch.setenv("BEDROCK_REGION", "us-east-1")
    monkeypatch.setenv("LLM_PROVIDER", "gemini")
    monkeypatch.setenv("GEMINI_API_KEY", "g-test")
    get_settings.cache_clear()
    from backend.llm import client as llm
    llm.set_premium(False)
    assert llm.chain()[0][0] == "gemini"
    llm.set_premium(True)
    assert llm.chain()[0] == ("bedrock", "us.anthropic.claude-sonnet-4-6")          # complex paid work: Sonnet
    assert llm.chain("fast")[0] == ("bedrock", "moonshotai.kimi-k2.5")              # bulk paid work: Kimi (cheaper)
    assert llm.chain("chat")[0] == ("bedrock", "amazon.nova-pro-v1:0")              # chat: Nova Pro for everyone
    assert llm.premium_available() is True
    assert ("gemini", "gemini-2.5-flash") in llm.chain()   # standard engine stays as fallback
    llm.set_premium(False)


def test_public_api_never_names_the_vendor(prod):
    r = TestClient(prod).get("/api/health").text.lower()
    assert not re.search(r"kimi|bedrock|gemini|claude|anthropic|moonshot|qwen", r)


def test_paper_pack_order_grants_credits_once(prod, monkeypatch):
    from backend.accounts import auth
    from backend.cache.store import get_store
    c = login(prod, "pack@x.org")
    user = auth.get_user(get_store().get("user_email", "pack@x.org")["uid"])
    get_store().put("order", "order_1", {"id": "order_1", "uid": user["uid"], "kind": "pack", "status": "created"})
    sig = hmac.new(b"secret_x", b"order_1|pay_9", hashlib.sha256).hexdigest()
    ok = {"razorpay_payment_id": "pay_9", "razorpay_order_id": "order_1", "razorpay_signature": sig}
    assert c.post("/api/billing/pack/verify", json={**ok, "razorpay_signature": "bad"}).status_code == 400
    _fake_rzp(monkeypatch, {"/payments/pay_9": {"id": "pay_9", "order_id": "order_1", "status": "captured", "amount": 100, "currency": "INR"}})
    assert c.post("/api/billing/pack/verify", json=ok).status_code == 402          # underpaid
    assert c.get("/api/auth/me").json().get("pack") is None
    _fake_rzp(monkeypatch, {"/payments/pay_9": {"id": "pay_9", "order_id": "order_1", "status": "captured", "amount": 999900, "currency": "INR"}})
    assert c.post("/api/billing/pack/verify", json=ok).status_code == 200
    body = json.dumps({"event": "order.paid", "payload": {"order": {"entity": {"id": "order_1", "amount_paid": 999900, "notes": {"uid": user["uid"]}}}}}).encode()
    TestClient(prod).post("/api/billing/webhook", content=body,
                          headers={"X-Razorpay-Signature": hmac.new(b"whsec", body, hashlib.sha256).hexdigest()})
    me = c.get("/api/auth/me").json()
    assert me["pack"]["credits"]["papers"] == 1          # webhook after verify doesn't double-grant
    user = auth.get_user(user["uid"])
    auth.consume(user, "papers")                          # free monthly paper
    auth.consume(user, "papers")                          # falls back to the pack credit
    assert user["_used_pack"] and auth.is_premium(user)
    auth.refund(user, "papers")
    assert auth.bonus(auth.get_user(user["uid"]))["credits"]["papers"] == 1


def test_paid_only_originality_gate_and_dev_owner_bypass(prod, monkeypatch):
    monkeypatch.setenv("OWNER_EMAILS", "ayush@owner.dev")
    monkeypatch.setenv("OWNER_ACCESS_KEY", "owner-secret-key")
    get_settings.cache_clear()

    # 1) Regular free user is blocked (402 paid_only) from AI & Plagiarism Report and Reducer
    free_c = login(prod, "student@x.org")
    me_free = free_c.get("/api/auth/me").json()
    assert me_free["is_owner"] is False and me_free["is_paid"] is False
    r_scan = free_c.post("/api/originality/scan", json={"title": "Test", "text": "word " * 30})
    assert r_scan.status_code == 402 and r_scan.json()["detail"]["code"] == "paid_only"
    r_red = free_c.post("/api/originality/reduce", json={"title": "Test", "text": "word " * 30})
    assert r_red.status_code == 402 and r_red.json()["detail"]["code"] == "paid_only"

    # 2) Dev Owner (matched via OWNER_EMAILS) gets automatic unlimited access to all features
    owner_c = login(prod, "ayush@owner.dev")
    me_owner = owner_c.get("/api/auth/me").json()
    assert me_owner["is_owner"] is True and me_owner["is_paid"] is True
    assert me_owner["plan"] == "max" and "Owner" in me_owner["plan_name"]

    # 3) Any user who presents the valid OWNER_ACCESS_KEY becomes Dev Owner immediately
    assert free_c.post("/api/auth/owner-unlock", json={"key": "wrong-key"}).status_code == 403
    assert free_c.post("/api/auth/owner-unlock", json={"key": "owner-secret-key"}).status_code == 200
    me_unlocked = free_c.get("/api/auth/me").json()
    assert me_unlocked["is_owner"] is True and me_unlocked["is_paid"] is True



def test_upi_claim_needs_login_and_owner_approval(prod, monkeypatch):
    monkeypatch.setenv("OWNER_EMAILS", "boss@x.org")
    get_settings.cache_clear()
    anon = TestClient(prod)
    assert anon.post("/api/billing/upi-claim", json={"item": "pro", "utr": "123456789012"}).status_code == 401
    cust = login(prod, "cust@x.org")
    r = cust.post("/api/billing/upi-claim", json={"item": "pro", "utr": "123456789012"})
    assert r.status_code == 200 and r.json()["status"] == "pending_verification"
    assert cust.post("/api/billing/upi-claim", json={"item": "pro", "utr": "123456789012"}).status_code == 409   # UTR reuse
    assert cust.get("/api/admin/upi-claims").status_code == 403
    boss = login(prod, "boss@x.org")
    claims = boss.get("/api/admin/upi-claims").json()
    assert len(claims) == 1
    assert boss.post(f"/api/admin/upi-claims/{claims[0]['claim_id']}/approve", json={}).status_code == 200
    me = cust.get("/api/auth/me").json()
    assert me["plan"] == "pro" and me["renews_at"]


def test_manual_plan_lapses_after_expiry(prod):
    from backend.accounts.plans import plan_of
    assert plan_of({"plan": "pro", "plan_expires": "2020-01-01T00:00:00+00:00"})["name"] == "Free"
    assert plan_of({"plan": "pro", "plan_expires": "2999-01-01T00:00:00+00:00"})["name"] == "Pro"



def test_password_signup_login_and_protections(prod):
    c = TestClient(prod)
    assert c.post("/api/auth/register", json={"email": "pw@x.org", "password": "short"}).status_code == 400
    assert c.post("/api/auth/register", json={"email": "pw@x.org", "password": "password1"}).status_code == 400
    r = c.post("/api/auth/register", json={"email": "PW@x.org", "password": "Research2026", "name": "Pat"})
    assert r.status_code == 200 and c.get("/api/auth/me").json()["email"] == "pw@x.org"
    assert TestClient(prod).post("/api/auth/register", json={"email": "pw@x.org", "password": "Another123"}).status_code == 409
    other = TestClient(prod)
    assert other.post("/api/auth/login", json={"email": "pw@x.org", "password": "Wrong12345"}).status_code == 401
    assert other.post("/api/auth/login", json={"email": "pw@x.org", "password": "Research2026"}).status_code == 200
    # changing the password keeps this browser signed in and revokes the other session
    assert c.post("/api/account/password", json={"current": "Research2026", "new": "Brand2027new"}).status_code == 200
    assert c.get("/api/auth/me").status_code == 200 and other.get("/api/auth/me").status_code == 401
    from backend.accounts import auth
    from backend.cache.store import get_store
    stored = auth.get_user(get_store().get("user_email", "pw@x.org")["uid"])["password_hash"]
    assert stored.startswith("scrypt$") and "Brand2027new" not in stored


def test_login_is_rate_limited(prod):
    c = TestClient(prod)
    c.post("/api/auth/register", json={"email": "rl@x.org", "password": "Research2026"})
    codes = [TestClient(prod).post("/api/auth/login", json={"email": "rl@x.org", "password": "Nope12345"}).status_code for _ in range(7)]
    assert codes[:6] == [401] * 6 and codes[6] == 429


def test_password_account_with_owner_email_is_not_owner(prod, monkeypatch):
    monkeypatch.setenv("OWNER_EMAILS", "chief@x.org")
    get_settings.cache_clear()
    c = TestClient(prod)
    c.post("/api/auth/register", json={"email": "chief@x.org", "password": "Research2026"})
    me = c.get("/api/auth/me").json()
    assert me["is_owner"] is False and me["plan"] == "free"
    assert TestClient(prod).post("/api/auth/register", json={"email": "cust@x.org", "password": "Research2026"}).status_code in (200, 409)


def test_free_plan_cannot_download_or_use_paid_tools(prod):
    import base64
    free = login(prod, "freebie@x.org")
    doc = {"title": "T", "markdown": "# Intro\n\nHello ++world++ ==hi==.", "template": "ieee"}
    for path in ("/api/export/docx", "/api/export/latex", "/api/export/latex-zip"):
        r = free.post(path, json=doc)
        assert r.status_code == 402 and r.json()["detail"]["code"] == "paid_only"
    png = "data:image/png;base64," + base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"0" * 20).decode()
    r = free.post("/api/agent/chat", json={"message": "what is this?", "images": [png]})
    assert r.status_code == 402 and r.json()["detail"]["feature"] == "vision"
    from backend.accounts import auth
    from backend.cache.store import get_store
    uid = get_store().get("user_email", "freebie@x.org")["uid"]
    u = auth.get_user(uid); u["plan"] = "pro"; get_store().put("user", uid, u)
    r = free.post("/api/export/latex", json=doc)
    assert r.status_code == 200 and "\\underline{world}" in r.text and "\\colorbox{yellow}{hi}" in r.text


def test_note_images_are_private_and_exported(prod):
    import io
    from PIL import Image
    buf = io.BytesIO(); Image.new("RGB", (4, 4), "red").save(buf, "PNG")
    a, b = login(prod, "imga@x.org"), login(prod, "imgb@x.org")
    r = a.post("/api/workspace/images", files={"file": ("x.png", buf.getvalue(), "image/png")})
    assert r.status_code == 200
    url = r.json()["url"]
    assert a.get(url).status_code == 200 and a.get(url).content.startswith(b"\x89PNG")
    assert b.get(url).status_code == 404
    assert a.post("/api/workspace/images", files={"file": ("x.svg", b"<svg/>", "image/svg+xml")}).status_code == 400


def test_deck_template_catalog(prod):
    c = login(prod, "decks@x.org")
    d = c.get("/api/deck-templates?category=thesis-defense").json()
    assert d["total"] > 10 and all(t["category"] == "thesis-defense" for t in d["items"])
    assert "CC BY 4.0" in d["credit"] and all(t["pptx_url"].startswith("https://cdn.ppttemplate.ai/") for t in d["items"])


def test_free_plan_sees_only_paper_preview(prod):
    from backend.cache.store import get_store
    c = login(prod, "peek@x.org")
    uid = get_store().get("user_email", "peek@x.org")["uid"]
    md = "# Abstract\n\n" + "a " * 300 + "\n\n# Introduction\n\n" + "b " * 400 + "\n\n# Method\n\n" + "c " * 900 + "\n\n# Conclusion\n\n" + "d " * 600
    refs = [{"n": i, "title": f"R{i}", "year": 2020} for i in range(1, 21)]
    get_store().put("paper_studio", "feedbeef01", {"paper_id": "feedbeef01", "title": "T", "markdown": md, "references": refs, "keywords": []})
    get_store().set_owner("paper_studio", "feedbeef01", uid)
    p = c.get("/api/paper-studio/feedbeef01").json()
    assert p["locked"] and "# Method" not in p["markdown"] and len(p["references"]) == 6 and p["references_total"] == 20
    u = get_store().get("user", uid); u["plan"] = "max"; get_store().put("user", uid, u)
    p = c.get("/api/paper-studio/feedbeef01").json()
    assert not p.get("locked") and "# Conclusion" in p["markdown"] and len(p["references"]) == 20


def test_free_plan_is_a_teaser(prod):
    c = login(prod, "teaser@x.org")
    me = c.get("/api/auth/me").json()
    assert me["limits"]["chats_day"] == 3 and me["limits"]["audits"] == 0 and me["limits"]["papers"] == 1
    for path, body in [("/api/venues/find", {"title": "Graph neural networks for traffic"}),
                       ("/api/gap-radar/runs", {"query": "graph neural networks"}),
                       ("/api/paper-studio/x/revise", {"instruction": "shorter"})]:
        r = c.post(path, json=body)
        assert r.status_code in (402, 404, 422), (path, r.status_code)
        if r.status_code == 402:
            assert r.json()["detail"]["code"] == "paid_only"
    assert c.post("/api/venues/find", json={"title": "x"}).status_code == 402
    assert c.post("/api/assist", json={"action": "improve", "text": "hello"}).status_code == 402
    assert c.post("/api/library/ideas", json={"topic": "graph learning"}).status_code in (402, 422)


def test_founders_are_permanent_admins(prod, monkeypatch):
    import base64
    from backend.accounts import auth
    from backend.cache.store import get_store
    # someone squats a founder email before launch, and someone else got owner rights another way
    squatter = TestClient(prod)
    assert squatter.post("/api/auth/register", json={"email": "founder1@x.org", "password": "Squatter123"}).status_code == 200
    stray = TestClient(prod)
    stray.post("/api/auth/register", json={"email": "stray1@x.org", "password": "Stray12345"})
    u = auth.get_user(get_store().get("user_email", "stray1@x.org")["uid"]); u.update(is_owner=True, plan="max"); get_store().put("user", u["uid"], u)

    h = auth.hash_password("Founder2026x")
    monkeypatch.setenv("FOUNDER_ACCOUNTS", base64.urlsafe_b64encode(json.dumps({"founder1@x.org": h}).encode()).decode().rstrip("="))
    get_settings.cache_clear()
    assert auth.ensure_founders() == ["founder1@x.org"]
    assert squatter.get("/api/auth/me").status_code == 401                         # squatter's session revoked
    assert TestClient(prod).post("/api/auth/login", json={"email": "founder1@x.org", "password": "Squatter123"}).status_code == 401
    f = TestClient(prod)
    assert f.post("/api/auth/login", json={"email": "founder1@x.org", "password": "Founder2026x"}).status_code == 200
    me = f.get("/api/auth/me").json()
    assert me["is_owner"] and me["plan"] == "max" and f.get("/api/admin/upi-claims").status_code == 200
    s = auth.get_user(get_store().get("user_email", "stray1@x.org")["uid"])
    assert not s["is_owner"] and s["plan"] == "free"
    # a founder's own password change survives restarts
    assert f.post("/api/account/password", json={"current": "Founder2026x", "new": "Changed2027y"}).status_code == 200
    auth.ensure_founders()
    assert TestClient(prod).post("/api/auth/login", json={"email": "founder1@x.org", "password": "Changed2027y"}).status_code == 200


def test_profile_name_and_founder_display_name(prod, monkeypatch):
    import base64
    from backend.accounts import auth
    h = auth.hash_password("Founder2026z")
    monkeypatch.setenv("FOUNDER_ACCOUNTS", base64.urlsafe_b64encode(json.dumps({"named@x.org": h}).encode()).decode().rstrip("="))
    monkeypatch.setenv("FOUNDER_NAMES", "named@x.org=Ayush Upadhyay")
    get_settings.cache_clear()
    auth.ensure_founders()
    f = TestClient(prod)
    assert f.post("/api/auth/login", json={"email": "named@x.org", "password": "Founder2026z"}).status_code == 200
    me = f.get("/api/auth/me").json()
    assert me["name"] == "Ayush Upadhyay" and me["tier"] == "founder" and me["plan_name"].startswith("Founder")
    u = TestClient(prod)
    u.post("/api/auth/register", json={"email": "plain@x.org", "password": "Research2026"})
    assert u.get("/api/auth/me").json()["tier"] == "free"
    assert u.post("/api/account/profile", json={"name": "  Priya   Sharma "}).json()["name"] == "Priya Sharma"
    assert u.get("/api/auth/me").json()["name"] == "Priya Sharma"
    assert u.post("/api/account/profile", json={"name": "x"}).status_code == 400


def test_owner_can_remove_a_members_subscription(prod, monkeypatch):
    monkeypatch.setenv("OWNER_EMAILS", "boss@x.org")
    get_settings.cache_clear()
    from backend.accounts import billing
    cancelled = []
    monkeypatch.setattr(billing, "_cancel_now", lambda sid: cancelled.append(sid))
    cust = login(prod, "member@x.org")
    uid = cust.get("/api/auth/me").json()["uid"]
    from backend.accounts import auth
    u = auth.get_user(uid)
    u.update(plan="max", subscription_id="sub_123", renews_at="2999-01-01T00:00:00+00:00")
    from backend.cache.store import get_store
    get_store().put("user", uid, u)
    auth.grant_pack(u, "order_1")

    assert cust.get("/api/admin/members").status_code == 403                       # members can't see the list
    assert cust.post(f"/api/admin/members/{uid}/remove-plan", json={}).status_code == 403
    boss = login(prod, "boss@x.org")
    rows = boss.get("/api/admin/members?q=member").json()
    assert [r["email"] for r in rows] == ["member@x.org"] and rows[0]["plan"] == "max" and rows[0]["pack_credits"] > 0

    boss_uid = boss.get("/api/auth/me").json()["uid"]
    assert boss.post(f"/api/admin/members/{boss_uid}/remove-plan", json={}).status_code == 403   # founders are protected

    r = boss.post(f"/api/admin/members/{uid}/remove-plan", json={"when": "now", "remove_pack": True, "note": "chargeback"})
    assert r.status_code == 200 and r.json()["plan"] == "free" and r.json()["pack_credits"] == 0
    assert cancelled == ["sub_123"]                                                # Razorpay billing stopped
    me = cust.get("/api/auth/me").json()
    assert me["plan"] == "free"
    log = get_store().list("admin_log", 10)
    assert log and log[0]["by"] == "boss@x.org" and log[0]["note"] == "chargeback"


def test_email_signin_drops_a_squatters_unverified_password(prod):
    squatter = TestClient(prod)
    assert squatter.post("/api/auth/register", json={"email": "victim@x.org", "password": "Squat2026x"}).status_code == 200
    from backend.accounts import auth
    auth._clear_limit("register-ip:testclient")                   # the shared test DB counts every signup in the suite
    login(prod, "victim@x.org")                                   # the real owner proves the address
    assert squatter.get("/api/auth/me").status_code == 401        # the squatter's session is gone
    assert TestClient(prod).post("/api/auth/login", json={"email": "victim@x.org", "password": "Squat2026x"}).status_code == 401


def test_two_users_uploading_the_same_file_both_get_it(prod):
    a, b = login(prod, "up-a@x.org"), login(prod, "up-b@x.org")
    data = b"Same bytes for both.\n\nReferences\n[1] A. Author. A title. 2020.\n"
    ida = a.post("/api/documents", files={"file": ("p.txt", data, "text/plain")}).json()["document_id"]
    idb = b.post("/api/documents", files={"file": ("p.txt", data, "text/plain")}).json()["document_id"]
    assert ida == idb
    assert a.get(f"/api/documents/{ida}").status_code == 200 and b.get(f"/api/documents/{idb}").status_code == 200
    assert login(prod, "up-c@x.org").get(f"/api/documents/{ida}").status_code == 404   # never uploaded it


def test_uploading_a_public_sample_does_not_make_it_private(prod):
    from backend.cache.store import get_store
    from backend.documents import service as docs
    data = b"Public sample text.\n\nReferences\n[1] B. Writer. Another title. 2019.\n"
    info = docs.save_bytes("sample.txt", data)                     # bundled sample: registered, no owner
    login(prod, "claimer@x.org").post("/api/documents", files={"file": ("s.txt", data, "text/plain")})
    assert get_store().owner_of("document", info.document_id) is None
    assert login(prod, "reader@x.org").get(f"/api/documents/{info.document_id}").status_code == 200


def test_paper_list_is_not_starved_by_other_users_papers(prod):
    from backend.accounts import auth
    from backend.cache.store import get_store
    a = login(prod, "many-a@x.org")
    ua = auth.get_user(get_store().get("user_email", "many-a@x.org")["uid"])
    get_store().put("paper_studio", "mine1", {"paper_id": "mine1", "title": "Mine", "created_at": "2026-01-01"})
    auth.own("paper_studio", "mine1", ua)
    for i in range(320):
        get_store().put("paper_studio", f"x{i}", {"paper_id": f"x{i}", "title": "other"})
        get_store().set_owner("paper_studio", f"x{i}", "someone-else")
    assert any(p["paper_id"] == "mine1" for p in a.get("/api/paper-studio").json())


def test_stale_activation_of_a_replaced_subscription_is_ignored(prod, monkeypatch):
    from backend.accounts import auth, billing
    from backend.cache.store import get_store
    monkeypatch.setattr(billing, "_cancel_now", lambda sid: None)
    login(prod, "switch@x.org")
    uid = get_store().get("user_email", "switch@x.org")["uid"]
    for sid, tier in (("sub_old", "pro"), ("sub_new", "max")):
        get_store().put("subscription", sid, {"id": sid, "uid": uid, "tier": tier, "status": "created"})
    billing._apply("sub_old", "active")
    billing._apply("sub_new", "active")                    # plan switch: old one is replaced
    billing._apply("sub_old", "active")                    # late webhook for the old plan
    u = auth.get_user(uid)
    assert u["plan"] == "max" and u["subscription_id"] == "sub_new"


def test_webhook_retry_is_processed_if_the_first_delivery_crashed(prod, monkeypatch):
    from backend.accounts import billing
    calls = []
    def boom(ev):
        calls.append(ev)
        if len(calls) == 1:
            raise RuntimeError("db hiccup")
    monkeypatch.setattr(billing, "_process_event", boom)
    body = json.dumps({"event": "subscription.activated", "payload": {}}).encode()
    sig = hmac.new(b"whsec", body, hashlib.sha256).hexdigest()
    with pytest.raises(RuntimeError):
        billing.handle_webhook(body, sig, "evt_retry")
    billing.handle_webhook(body, sig, "evt_retry")
    billing.handle_webhook(body, sig, "evt_retry")         # now a true replay: skipped
    assert len(calls) == 2


def test_job_interrupted_by_restart_is_reported_and_refunded(prod):
    from backend.accounts import auth
    from backend.app.jobs import INTERRUPTED, JobManager, refund_undo
    from backend.cache.store import get_store
    c = login(prod, "restart@x.org")
    user = auth.get_user(get_store().get("user_email", "restart@x.org")["uid"])
    auth.consume(user, "papers")
    assert auth.usage(user)["papers"] == 1
    # what the previous process left behind: a job still marked running, with its undo
    get_store().put("job", "deadjob00001", {"job_id": "deadjob00001", "kind": "paper_studio", "status": "running",
                                            "progress": 0.4, "created_at": "2026-11-06T10:00:00+00:00",
                                            "_owner": user["uid"], "_undo": refund_undo(user, "papers")})
    assert JobManager().recover_interrupted() == 1
    assert auth.usage(user)["papers"] == 0                       # credit given back
    j = c.get("/api/jobs/deadjob00001").json()
    assert j["status"] == "error" and j["error"] == INTERRUPTED
    assert "event: end" in c.get("/api/jobs/deadjob00001/events").text
    assert login(prod, "other-restart@x.org").get("/api/jobs/deadjob00001").status_code == 404
    assert JobManager().recover_interrupted() == 0               # never refunded twice


def test_claimed_demo_document_is_released(prod):
    from backend.accounts import auth
    from backend.cache.store import get_store
    get_store().set_owner("document", "demo123", "claimer")
    auth.make_public("document", "demo123")
    assert get_store().owner_of("document", "demo123") is None
    auth.check_access("document", "demo123", {"uid": "anyone"})          # readable by all
    assert get_store().owner_of("document+", "demo123:claimer") == "claimer"


def test_password_holder_verifying_their_own_email_keeps_the_password(prod):
    from backend.accounts import auth
    c = TestClient(prod)
    assert c.post("/api/auth/register", json={"email": "keepme@x.org", "password": "Keep2026pw"}).status_code == 200
    auth._clear_limit("register-ip:testclient")
    link = c.post("/api/auth/email/start", json={"email": "keepme@x.org"}).json()["dev_link"]
    assert c.get(link.replace("http://testserver", ""), follow_redirects=False).status_code == 303   # same browser
    assert c.get("/api/auth/me").json()["email"] == "keepme@x.org"
    assert TestClient(prod).post("/api/auth/login", json={"email": "keepme@x.org", "password": "Keep2026pw"}).status_code == 200
