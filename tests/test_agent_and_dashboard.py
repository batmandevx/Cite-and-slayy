"""Tests for Azora AI tools, dashboard analytics, low-confidence Jury gate, numbered ref headings, and HTTP URL redaction."""
from datetime import datetime, timezone

from fastapi.testclient import TestClient

from backend.agent import tools as agent_tools
from backend.app.main import app
from backend.cache.store import get_store
from backend.common.schemas import AuditReport, PersonaReview
from backend.documents.parser import REF_HEADING
from backend.jury.verdict import decide
from backend.sources.http import SourceClient

client = TestClient(app)
NOW = datetime.now(timezone.utc)


def test_agent_has_registered_tools():
    assert len(agent_tools.TOOLS) >= 16
    for expected in (
        "search_papers", "trend_experiment", "venue_fit_experiment", "text_integrity_test",
        "check_citation", "check_retraction", "test_claim", "list_papers", "audit_paper",
        "review_paper", "write_paper", "scan_field", "research_questions", "save_note", "pin_stickies", "add_todos",
    ):
        assert expected in agent_tools.TOOLS


async def test_text_integrity_test_flags_real_tortured_phrases_and_overclaims():
    res = await agent_tools.text_integrity_test(
        "Our profound neural organization [1, 2] achieves 100% accuracy on colossal information "
        "and completely solves hallucination across 3 seeds."
    )
    data = res["data"]
    found = {p["phrase"] for p in data["tortured_phrases"]}
    assert {"profound neural organization", "colossal information"} <= found
    assert data["inline_citations"] >= 1
    assert len(data["overclaim_triggers"]) >= 2
    assert res["chart"]["type"] == "bar"


async def test_agent_workspace_action_tools_persist_and_return_deep_links():
    note = await agent_tools.save_note("Ablation Plan", "# Ablation\n\n$$L = L_{ce}$$\n", template="ieee")
    assert note["link"]["tab"] == "notes" and note["link"]["notesView"] == "pages"
    pages = client.get("/api/workspace/pages").json()["items"]
    assert any(p["id"] == note["data"]["note_id"] and p["title"] == "Ablation Plan" for p in pages)

    st = await agent_tools.pin_stickies(["Test draft lengths 4, 8, 16", "Compare Eagle-2 vs Medusa"])
    assert st["link"]["notesView"] == "stickies"
    stickies = client.get("/api/workspace/stickies").json()["items"]
    assert any("Eagle-2" in s["text"] for s in stickies)

    td = await agent_tools.add_todos(["Run 3 seeds on GSM8K", "Add confidence intervals"], priority="high")
    assert td["link"]["notesView"] == "todos"
    todos = client.get("/api/workspace/todos").json()["items"]
    assert any(t["text"] == "Run 3 seeds on GSM8K" and t["prio"] == "high" for t in todos)


def test_dashboard_endpoint_includes_velocity_streaks_and_workspace():
    r = client.get("/api/dashboard")
    assert r.status_code == 200
    body = r.json()
    assert "streaks" in body and "weekly_velocity" in body and "workspace" in body
    assert len(body["weekly_velocity"]) == 12
    assert body["workspace"]["pages"] >= 1


def test_low_confidence_audit_blocks_submit():
    audit = AuditReport(
        audit_id="a1", document_id="d1", checks_run=["refs", "phrases", "overlap"], self_status=None,
        references=[], claims=[], phrases=[], overlaps=[], highlights=[], score=95.0, score_terms=[],
        low_confidence=True, warnings=["API unreachable"],
        summary={"not_found": 0, "retracted_cited": 0, "self_retracted": 0, "references": 10, "verified": 0, "could_not_verify": 10},
        created_at=NOW,
    )
    jury = [PersonaReview(persona=f"P{i}", score=9, confidence=0.9) for i in range(4)]
    decision, fired, _ = decide(audit, jury)
    assert decision == "revise"
    assert any("Low-confidence" in f for f in fired)


def test_numbered_reference_headings_match():
    for heading in ("References", "6 References", "7. Bibliography", "VII. REFERENCES", "6.1 Literature Cited"):
        assert REF_HEADING.search(heading), f"failed to match {heading!r}"


async def test_source_client_redacts_default_params_from_public_url_and_hits_legacy_cache():
    store = get_store()
    sc = SourceClient("openalex", 0.0, default_params={"mailto": "secret@example.com", "api_key": "SECRET123"})
    url = "https://api.openalex.org/works"
    legacy_key = store.request_key("GET", url, {"mailto": "secret@example.com", "api_key": "SECRET123", "search": "lora"})
    store.cache_put(legacy_key, "openalex", url, 200, {"data": {"results": []}, "status": 200})

    fetched = await sc.get(url, {"search": "lora"})
    assert fetched.from_cache is True
    assert "SECRET123" not in fetched.url
    assert "secret@example.com" not in fetched.url
    assert "search=lora" in fetched.url


def test_billing_plans_and_upi_claim_persists():
    r = client.get("/api/billing/plans")
    assert r.status_code == 200
    data = r.json()
    assert data["upi_id"] == "8374579275@superyes"

    bad = client.post("/api/billing/upi-claim", json={"item": "pro", "utr": "123"})
    assert bad.status_code == 400

    ok = client.post("/api/billing/upi-claim", json={"item": "pro", "utr": "430498765432", "email": "researcher@example.org"})
    assert ok.status_code == 200
    claim = ok.json()
    assert claim["ok"] is True
    assert claim["amount_inr"] == 6999
    assert claim["upi_id"] == "8374579275@superyes"
    stored = get_store().get("upi_claim", claim["claim_id"])
    assert stored is not None and stored["utr"] == "430498765432"


