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
    tok = auth.session_token("abc")
    assert auth.uid_from_token(tok) == "abc"
    uid, exp, sig = tok.split(".")
    assert auth.uid_from_token(f"zzz.{exp}.{sig}") is None


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


def test_razorpay_signatures_and_webhook_upgrade(prod):
    from backend.accounts import auth, billing
    from backend.cache.store import get_store
    c = login(prod, "pay@x.org")
    user = auth.get_user(get_store().get("user_email", "pay@x.org")["uid"])
    get_store().put("subscription", "sub_1", {"id": "sub_1", "uid": user["uid"], "tier": "pro", "status": "created"})
    sig = hmac.new(b"secret_x", b"pay_1|sub_1", hashlib.sha256).hexdigest()
    assert c.post("/api/billing/verify", json={"razorpay_payment_id": "pay_1", "razorpay_subscription_id": "sub_1",
                                               "razorpay_signature": "bad"}).status_code == 400
    assert c.post("/api/billing/verify", json={"razorpay_payment_id": "pay_1", "razorpay_subscription_id": "sub_1",
                                               "razorpay_signature": sig}).status_code == 200
    assert c.get("/api/auth/me").json()["plan"] == "pro"
    body = json.dumps({"event": "subscription.cancelled", "payload": {"subscription": {"entity": {"id": "sub_1", "status": "cancelled"}}}}).encode()
    anon = TestClient(prod)
    assert anon.post("/api/billing/webhook", content=body, headers={"X-Razorpay-Signature": "nope"}).status_code == 400
    good = hmac.new(b"whsec", body, hashlib.sha256).hexdigest()
    assert anon.post("/api/billing/webhook", content=body, headers={"X-Razorpay-Signature": good}).status_code == 200
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
    assert llm.chain()[0] == ("bedrock", "us.anthropic.claude-opus-4-6-v1")
    assert llm.chain("fast")[0] == ("bedrock", "us.anthropic.claude-haiku-4-5-20251001-v1:0")
    assert llm.premium_available() is True
    assert ("gemini", "gemini-2.5-flash") in llm.chain()   # standard engine stays as fallback
    llm.set_premium(False)


def test_public_api_never_names_the_vendor(prod):
    r = TestClient(prod).get("/api/health").text.lower()
    assert not re.search(r"kimi|bedrock|gemini|claude|anthropic|moonshot|qwen", r)


def test_paper_pack_order_grants_credits_once(prod):
    from backend.accounts import auth
    from backend.cache.store import get_store
    c = login(prod, "pack@x.org")
    user = auth.get_user(get_store().get("user_email", "pack@x.org")["uid"])
    get_store().put("order", "order_1", {"id": "order_1", "uid": user["uid"], "kind": "pack", "status": "created"})
    sig = hmac.new(b"secret_x", b"order_1|pay_9", hashlib.sha256).hexdigest()
    ok = {"razorpay_payment_id": "pay_9", "razorpay_order_id": "order_1", "razorpay_signature": sig}
    assert c.post("/api/billing/pack/verify", json={**ok, "razorpay_signature": "bad"}).status_code == 400
    assert c.post("/api/billing/pack/verify", json=ok).status_code == 200
    body = json.dumps({"event": "order.paid", "payload": {"order": {"entity": {"id": "order_1"}}}}).encode()
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

