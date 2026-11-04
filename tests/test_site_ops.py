"""Public contact form and conversion counters."""
import pytest
from fastapi.testclient import TestClient

from backend.common.config import get_settings


@pytest.fixture
def client(monkeypatch, tmp_path):
    for k, v in {"AUTH_REQUIRED": "true", "DEV_SHOW_MAGIC_LINK": "true", "PUBLIC_URL": "http://testserver"}.items():
        monkeypatch.setenv(k, v)
    get_settings.cache_clear()
    from backend.app.main import app
    yield TestClient(app)
    get_settings.cache_clear()


def test_contact_is_public_and_validates(client):
    ok = client.post("/api/contact", json={"name": "Asha", "email": "asha@example.com", "topic": "billing",
                                           "message": "My UPI payment went through but the plan is not active."},
                     headers={"x-forwarded-for": "10.9.0.1"})
    assert ok.status_code == 200 and ok.json()["ok"]
    bad = client.post("/api/contact", json={"name": "A", "email": "not-an-email", "message": "hello there friends"},
                      headers={"x-forwarded-for": "10.9.0.2"})
    assert bad.status_code == 422


def test_contact_honeypot_and_rate_limit(client):
    trap = client.post("/api/contact", json={"name": "Bot", "email": "b@x.io", "message": "buy cheap stuff now!!", "website": "spam"})
    assert trap.status_code == 200
    codes = [client.post("/api/contact", json={"name": "R", "email": f"r{i}@example.com", "message": "testing the limit here"},
                         headers={"x-forwarded-for": "10.9.9.9"}).status_code for i in range(7)]
    assert codes[:5] == [200] * 5 and codes[-1] == 429


def test_events_counted_only_for_known_names(client):
    assert client.post("/api/events", json={"name": "signup", "path": "/app?x=1"}).status_code == 204
    assert client.post("/api/events", json={"name": "made_up_event"}).status_code == 204
    from backend.app.site_ops import _day
    from backend.cache.store import get_store
    rec = get_store().get("conv_day", _day())
    assert rec["counts"].get("signup", 0) >= 1 and "made_up_event" not in rec["counts"]
    assert any(k.startswith("signup /app") for k in rec["paths"])


def test_admin_views_need_owner(client):
    assert client.get("/api/admin/contact-messages").status_code == 401
    assert client.get("/api/admin/conversions").status_code == 401
