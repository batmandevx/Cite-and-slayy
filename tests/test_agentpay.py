"""Agent Pay + PayPal: top-up, mandate enforcement, approvals, refunds for unsettled refs, auto-reload, withdrawal,
plan checkout. PayPal is a fake in-memory sandbox behind httpx.MockTransport; CiteGuard's resolver is stubbed."""
import json
import re

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.common.config import get_settings
from backend.common.schemas import ParsedRef, PaperRef, ReferenceCheck


class FakePayPal:
    def __init__(self):
        self.orders: dict[str, dict] = {}
        self.refunds: list[dict] = []
        self.n = 0

    def _cap(self, oid: str, o: dict) -> dict:
        pu = o["purchase_units"][0]
        return {"id": f"CAP-{oid}", "status": "COMPLETED", "amount": pu["amount"], "custom_id": pu["custom_id"]}

    def __call__(self, req: httpx.Request) -> httpx.Response:
        p = req.url.path
        if p == "/v1/oauth2/token":
            return httpx.Response(200, json={"access_token": "tok", "expires_in": 3600})
        body = json.loads(req.content or b"{}")
        if p == "/v2/checkout/orders" and req.method == "POST":
            self.n += 1
            oid = f"ORD{self.n}"
            src = (body.get("payment_source") or {}).get("paypal") or {}
            o = {"id": oid, "status": "CREATED", "purchase_units": body["purchase_units"], "_src": src}
            if src.get("vault_id"):              # merchant-initiated: completes in one call
                o["status"] = "COMPLETED"
                o["purchase_units"][0]["payments"] = {"captures": [self._cap(oid, o)]}
            self.orders[oid] = o
            return httpx.Response(201, json=o)
        if m := re.fullmatch(r"/v2/checkout/orders/(\w+)/capture", p):
            o = self.orders[m.group(1)]
            o["status"] = "COMPLETED"
            o["purchase_units"][0]["payments"] = {"captures": [self._cap(o["id"], o)]}
            if (o["_src"].get("attributes") or {}).get("vault"):
                o["payment_source"] = {"paypal": {"attributes": {"vault": {"id": "VAULT-1", "status": "VAULTED"}}}}
            return httpx.Response(201, json=o)
        if m := re.fullmatch(r"/v2/checkout/orders/(\w+)", p):
            return httpx.Response(200, json=self.orders[m.group(1)])
        if m := re.fullmatch(r"/v2/payments/captures/([\w-]+)/refund", p):
            self.refunds.append({"capture": m.group(1), **body})
            return httpx.Response(201, json={"id": f"REF{len(self.refunds)}", "status": "COMPLETED"})
        return httpx.Response(404, json={"message": "not faked"})

    def approve(self, oid: str):
        self.orders[oid]["status"] = "APPROVED"     # what the buyer does in the PayPal popup


@pytest.fixture
def env(monkeypatch):
    for k, v in {"AUTH_REQUIRED": "true", "DEV_SHOW_MAGIC_LINK": "true", "PUBLIC_URL": "http://testserver",
                 "PAYPAL_CLIENT_ID": "sb-id", "PAYPAL_CLIENT_SECRET": "sb-secret", "LLM_PROVIDER": "none"}.items():
        monkeypatch.setenv(k, v)
    get_settings.cache_clear()
    from backend.payments import paypal
    fake = FakePayPal()
    paypal._token.clear()
    monkeypatch.setattr(paypal, "transport", httpx.MockTransport(fake))

    async def fake_resolve(entries, check_retraction, on_progress=None, concurrency=4):
        out = []
        for e in entries:
            raw = e.parsed.raw
            status = "not_found" if "FAKE" in raw else "could_not_verify" if "DOWN" in raw else "verified"
            matched = PaperRef(id="W1", title="Attention Is All You Need", year=2017, doi="10.5555/x") if status == "verified" else None
            out.append((ReferenceCheck(ref_index=e.index, label=e.label, parsed=ParsedRef(raw=raw), status=status,
                                       matched=matched, retraction="none_found"), None))
        return out
    from backend.agentpay import service
    monkeypatch.setattr(service, "resolve_all", fake_resolve)
    from backend.app.main import app
    yield app, fake
    get_settings.cache_clear()


def login(app, email: str) -> TestClient:
    c = TestClient(app)
    link = c.post("/api/auth/email/start", json={"email": email}).json()["dev_link"]
    c.get(link.replace("http://testserver", ""), follow_redirects=False)
    return c


def topup(c: TestClient, fake: FakePayPal, usd: float, save=False) -> dict:
    oid = c.post("/api/agentpay/topup", json={"amount_usd": usd, "save_for_auto_reload": save}).json()["order_id"]
    fake.approve(oid)
    r = c.post(f"/api/agentpay/topup/{oid}/capture")
    assert r.status_code == 200, r.text
    return r.json()


def agent(app, key: str) -> TestClient:
    a = TestClient(app)
    a.headers["Authorization"] = f"Bearer {key}"
    return a


def test_topup_is_credited_once_and_only_to_its_owner(env):
    app, fake = env
    c = login(app, "owner1@uni.edu")
    oid = c.post("/api/agentpay/topup", json={"amount_usd": 10}).json()["order_id"]
    assert c.post(f"/api/agentpay/topup/{oid}/capture").status_code == 402        # not approved in PayPal yet
    fake.approve(oid)
    assert c.post(f"/api/agentpay/topup/{oid}/capture").json()["balance_usd"] == 10
    assert c.post(f"/api/agentpay/topup/{oid}/capture").json()["balance_usd"] == 10   # replay: no double credit
    other = login(app, "thief@uni.edu")
    assert other.post(f"/api/agentpay/topup/{oid}/capture").status_code == 404


def test_agent_pays_per_answer_and_unsettled_refs_are_refunded(env):
    app, fake = env
    c = login(app, "owner2@uni.edu")
    topup(c, fake, 10)
    key = c.post("/api/agentpay/keys", json={"name": "writer-bot"}).json()["key"]
    r = agent(app, key).post("/api/agent/v1/verify", json={"references": [
        "Vaswani et al. Attention is all you need. NeurIPS 2017.", "Smith J. A FAKE paper on quantum cats. 2023.",
        "Doe A. Something while the source is DOWN. 2020."]})
    out = r.json()
    assert r.status_code == 200, r.text
    assert out["charged_usd"] == 0.10 and out["refunded_usd"] == 0.05 and out["balance_usd"] == 9.90
    assert out["flagged"] == 1 and [x["status"] for x in out["results"]] == ["verified", "not_found", "could_not_verify"]
    kinds = [row["type"] for row in c.get("/api/agentpay/ledger").json()]
    assert kinds[:3] == ["credit", "charge", "topup"]


def test_mandate_blocks_and_asks_before_spending(env):
    app, fake = env
    c = login(app, "owner3@uni.edu")
    topup(c, fake, 20)
    w = c.post("/api/agentpay/mandate", json={"text": "Max $5 a month, $1 per call, ask me before anything over $0.20. Only my writer-bot agent."}).json()
    m = w["mandate"]
    assert (m["monthly_cap_usd"], m["per_call_cap_usd"], m["approval_over_usd"], m["allowed_agents"]) == (5, 1, 0.2, ["writer-bot"])
    key = c.post("/api/agentpay/keys", json={"name": "writer-bot"}).json()["key"]
    a = agent(app, key)
    refs = [f"Author {i}. Real paper number {i}. 2020." for i in range(6)]          # 6 x $0.05 = $0.30 > $0.20
    r = a.post("/api/agent/v1/verify", json={"references": refs})
    assert r.status_code == 402 and r.json()["detail"]["status"] == "needs_approval"
    rid = r.json()["detail"]["request_id"]
    assert c.get("/api/agentpay/wallet").json()["balance_usd"] == 20                 # nothing spent while waiting
    assert c.post(f"/api/agentpay/requests/{rid}/approve").status_code == 200
    ok = a.post("/api/agent/v1/verify", json={"references": refs, "request_id": rid})
    assert ok.status_code == 200 and ok.json()["charged_usd"] == 0.30
    again = a.post("/api/agent/v1/verify", json={"references": refs, "request_id": rid})   # approvals are single-use
    assert again.status_code == 402
    big = a.post("/api/agent/v1/verify", json={"references": [f"R{i}. Title {i}. 2021." for i in range(30)]})
    assert big.status_code == 403 and "per-call cap" in big.json()["detail"]["reason"]
    rogue = agent(app, c.post("/api/agentpay/keys", json={"name": "rogue"}).json()["key"])
    assert rogue.post("/api/agent/v1/verify", json={"references": ["X. Y. 2020."]}).status_code == 403
    spoof = rogue.post("/api/agent/v1/verify", json={"references": ["X. Y. 2020."], "agent": "writer-bot"})
    assert spoof.status_code == 403            # a key can't claim another agent's name


def test_empty_wallet_auto_reloads_from_saved_paypal_within_mandate(env):
    app, fake = env
    c = login(app, "owner4@uni.edu")
    w = topup(c, fake, 5, save=True)
    assert w["auto_reload_ready"]
    c.post("/api/agentpay/mandate", json={"text": "$15 a month, $5 per call, 100 refs per call, never ask. Top up automatically with $10."})
    key = c.post("/api/agentpay/keys", json={"name": "bot"}).json()["key"]
    a = agent(app, key)
    refs = [f"A{i}. Paper {i}. 2019." for i in range(60)]                            # $3
    assert a.post("/api/agent/v1/verify", json={"references": refs}).json()["balance_usd"] == 2
    r = a.post("/api/agent/v1/verify", json={"references": refs})                    # needs $3, has $2 -> reload $10
    assert r.status_code == 200 and r.json()["balance_usd"] == 9
    assert "auto_reload" in [row["type"] for row in c.get("/api/agentpay/ledger").json()]
    assert any(o["_src"].get("vault_id") == "VAULT-1" for o in fake.orders.values())


def test_no_auto_reload_without_permission(env):
    app, fake = env
    c = login(app, "owner5@uni.edu")
    topup(c, fake, 5, save=True)
    c.post("/api/agentpay/mandate", json={"text": "$50 a month, $5 per call, 100 refs per call, never ask."})
    a = agent(app, c.post("/api/agentpay/keys", json={"name": "bot"}).json()["key"])
    a.post("/api/agent/v1/verify", json={"references": [f"A{i}. P {i}. 2019." for i in range(80)]})   # $4
    r = a.post("/api/agent/v1/verify", json={"references": [f"B{i}. Q {i}. 2019." for i in range(40)]})  # $2 > $1 left
    assert r.status_code == 402 and r.json()["detail"]["status"] == "insufficient_funds"


def test_withdraw_refunds_unused_balance_to_paypal(env):
    app, fake = env
    c = login(app, "owner6@uni.edu")
    topup(c, fake, 10)
    c.post("/api/agentpay/mandate", json={"text": "never ask"})
    a = agent(app, c.post("/api/agentpay/keys", json={"name": "bot"}).json()["key"])
    a.post("/api/agent/v1/verify", json={"references": ["A. Real paper. 2017."]})
    w = c.post("/api/agentpay/withdraw").json()
    assert w["balance_usd"] == 0
    assert fake.refunds[-1]["amount"] == {"currency_code": "USD", "value": "9.95"}
    assert c.post("/api/agentpay/withdraw").status_code == 400


def test_bad_or_revoked_key_is_rejected(env):
    app, _ = env
    c = login(app, "owner7@uni.edu")
    assert TestClient(app).post("/api/agent/v1/verify", json={"references": ["x"]}).status_code == 401
    made = c.post("/api/agentpay/keys", json={"name": "bot"}).json()
    c.delete(f"/api/agentpay/keys/{made['id']}")
    assert agent(app, made["key"]).post("/api/agent/v1/verify", json={"references": ["x"]}).status_code == 401
    assert login(app, "other@uni.edu").delete(f"/api/agentpay/keys/{made['id']}").status_code == 404


def test_paypal_plan_checkout_activates_a_30_day_pass(env):
    app, fake = env
    c = login(app, "buyer@uni.edu")
    oid = c.post("/api/billing/paypal/order", json={"item": "pro"}).json()["order_id"]
    assert fake.orders[oid]["purchase_units"][0]["amount"] == {"currency_code": "USD", "value": "79.00"}
    fake.approve(oid)
    assert c.post(f"/api/billing/paypal/order/{oid}/capture").json()["item"] == "pro"
    me = c.get("/api/auth/me").json()
    assert me["plan"] == "pro"


def test_rules_parser_fallback_and_clamps():
    from backend.agentpay.mandate import Mandate, clamp, decide, parse_rules
    m = clamp(parse_rules("Spend up to $9999 a month, $3 per call, ask me over $1, 20 refs per call"))
    assert m.monthly_cap_usd == get_settings().agent_max_monthly_usd and m.per_call_cap_usd == 3 and m.max_refs_per_call == 20
    m2 = Mandate(monthly_cap_usd=1, per_call_cap_usd=1, max_refs_per_call=50, approval_over_usd=0, auto_topup=False,
                 auto_topup_amount_usd=10, allowed_agents=[], summary="")
    assert decide(m2, agent="a", n_refs=10, cost_cents=50, month_spent_cents=60)[0] == "deny"
    assert decide(m2, agent="a", n_refs=10, cost_cents=40, month_spent_cents=60)[0] == "allow"
