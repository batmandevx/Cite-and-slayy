"""The private AutoResearchClaw LLM bridge: per-run keys, budget cap, invisible through the public proxy."""
from fastapi.testclient import TestClient

from backend.common.config import get_settings


def test_bridge_keys_budget_and_proxy(monkeypatch):
    from backend.app.main import app
    from backend.autoclaw_bridge import llm_bridge
    from backend.llm import client as llm

    async def fake_complete(system, prompt, **kw):
        return "pong"
    monkeypatch.setattr(llm, "complete", fake_complete)
    c = TestClient(app)
    body = {"model": "azora-pro", "messages": [{"role": "system", "content": "s"}, {"role": "user", "content": "ping"}]}
    assert c.post("/internal/llm/v1/chat/completions", json=body).status_code == 401
    assert c.post("/internal/llm/v1/chat/completions", json=body, headers={"Authorization": "Bearer rc-nope"}).status_code == 401

    key = llm_bridge.issue_key("local", "run1", 100.0)
    ok = c.post("/internal/llm/v1/chat/completions", json=body, headers={"Authorization": f"Bearer {key}"})
    assert ok.status_code == 200 and ok.json()["choices"][0]["message"]["content"] == "pong"
    # requests that came through the public proxy never see the bridge
    assert c.post("/internal/llm/v1/chat/completions", json=body,
                  headers={"Authorization": f"Bearer {key}", "X-Forwarded-For": "1.2.3.4"}).status_code == 404

    monkeypatch.setattr(llm_bridge, "run_spend", lambda k: 150.0)          # over budget
    assert c.post("/internal/llm/v1/chat/completions", json=body, headers={"Authorization": f"Bearer {key}"}).status_code == 402
    monkeypatch.setattr(llm_bridge, "run_spend", lambda k: 0.0)
    llm_bridge.revoke_key(key)
    assert c.post("/internal/llm/v1/chat/completions", json=body, headers={"Authorization": f"Bearer {key}"}).status_code == 401


def test_live_drafting_is_founder_only(monkeypatch):
    for k, v in {"AUTH_REQUIRED": "true", "PUBLIC_URL": "http://testserver"}.items():
        monkeypatch.setenv(k, v)
    get_settings.cache_clear()
    from backend.app.main import app
    from backend.accounts import auth
    from backend.cache.store import get_store
    c = TestClient(app)
    c.post("/api/auth/register", json={"email": "maxuser@x.org", "password": "Research2026"})
    u = auth.get_user(get_store().get("user_email", "maxuser@x.org")["uid"]); u["plan"] = "max"; get_store().put("user", u["uid"], u)
    r = c.post("/api/autoclaw/runs", json={"topic": "graph neural networks", "demo": False})
    assert r.status_code == 403
    get_settings.cache_clear()
