"""Checklist reviewer, checklist-only verdicts, Markdown reports and claim-id fallback."""
import json
from datetime import datetime, timezone
from pathlib import Path

from backend.app.reports import audit_markdown, verdict_markdown
from backend.citeguard import claims
from backend.common.schemas import AuditReport, PersonaReview, Verdict
from backend.documents.parser import parse_document
from backend.jury import checklist
from backend.jury.verdict import RULES, decide
from backend.llm import client as llm

ROOT = Path(__file__).resolve().parents[1]
NOW = datetime.now(timezone.utc)


def _audit(score=95, **summary):
    base = {"not_found": 0, "retracted_cited": 0, "self_retracted": 0, "references": 10, "verified": 10}
    base.update(summary)
    return AuditReport(audit_id="a", document_id="d", checks_run=[], self_status=None, references=[], claims=[], phrases=[],
                       overlaps=[], highlights=[], score=score, score_terms=[], low_confidence=False, warnings=[],
                       summary=base, created_at=NOW)


def test_checklist_on_real_paper_is_evidence_based():
    doc = parse_document(ROOT / "demo/autoclaw_run/deliverables/paper.pdf")
    review, checks = checklist.review(doc, _audit())
    names = {c.name: c for c in checks}
    assert names["Abstract present"].passed
    assert names["Reference depth"].passed is False and "15 references" in names["Reference depth"].detail
    assert 1 <= review.score <= 10 and review.persona == checklist.NAME
    assert len(review.fixes) == min(3, sum(not c.passed for c in checks))


def test_checklist_alone_cannot_submit():
    only_checklist = [PersonaReview(persona=checklist.NAME, score=10, confidence=0.6)]
    decision, fired, _ = decide(_audit(), only_checklist)
    assert decision == "revise" and any("content reviewer" in f for f in fired)


def test_reports_render():
    md = audit_markdown(_audit(), None)
    assert "Integrity score:** **95/100" in md
    v = Verdict(review_id="r", document_id="d", audit_id="a", decision="revise", personas=[], weighted_mean=None,
                integrity=95, triggered_rules=[RULES[6]], rules=RULES, ranked_fixes=[], venue_suggestions=[], venue=None,
                created_at=NOW)
    assert "REVISE" in verdict_markdown(v, None)


async def test_claim_judgments_fall_back_to_order(monkeypatch):
    async def fake(system, prompt, schema, effort, max_tokens, model=None):
        return json.dumps({"judgments": [{"id": 1, "label": "unsupported", "rationale": "x"},
                                         {"id": 2, "label": "supported", "rationale": "y"}]})
    monkeypatch.setattr(llm, "chain", lambda tier="main": [("anthropic", "stub")])
    monkeypatch.setattr(llm, "_cache_key", lambda *a: f"t-{id(a)}")
    monkeypatch.setitem(llm._PROVIDERS, "anthropic", fake)
    res = await claims.judge([(17, "s1", "t", "a"), (23, "s2", "t", "a")])
    assert res[17].label == "unsupported" and res[23].label == "supported"


def test_auto_prefers_local_model_over_cloud_key(monkeypatch):
    class S:
        llm_provider = "auto"; anthropic_api_key = None; openai_api_key = None; gemini_api_key = "k"; llm_model = None
        def default_model_for(self, p): return {"gemini": "gemini-2.5-flash"}.get(p, "")
    monkeypatch.setattr(llm, "get_settings", lambda: S())
    monkeypatch.setattr(llm, "_ollama_model", lambda: "qwen2.5:7b")
    assert llm.resolve() == ("ollama", "qwen2.5:7b")          # free local model wins
    monkeypatch.setattr(llm, "_ollama_model", lambda: None)
    assert llm.resolve() == ("gemini", "gemini-2.5-flash")    # cloud only as fallback


async def test_fallback_chain_uses_backup_when_primary_fails(monkeypatch):
    calls = []

    async def bedrock_down(system, prompt, schema, effort, max_tokens, model=None):
        calls.append("bedrock")
        raise llm.LLMError("bedrock HTTP 503")

    async def gemini_ok(system, prompt, schema, effort, max_tokens, model=None):
        calls.append("gemini")
        return "fine"

    monkeypatch.setattr(llm, "chain", lambda tier="main": [("bedrock", "anthropic.claude-sonnet-5-5"), ("gemini", "gemini-2.5-flash")])
    monkeypatch.setitem(llm._PROVIDERS, "bedrock", bedrock_down)
    monkeypatch.setitem(llm._PROVIDERS, "gemini", gemini_ok)
    assert await llm.complete("sys", f"prompt-{id(calls)}") == "fine"
    assert calls == ["bedrock", "gemini"]


def test_fast_tier_routes_bulk_work_to_cheaper_models(monkeypatch):
    from backend.common.config import Settings
    s = Settings(llm_provider="bedrock", bedrock_region="us-east-1", llm_fallback="gemini", gemini_api_key="k",
                 llm_model=None, llm_model_fast=None)
    monkeypatch.setattr(llm, "get_settings", lambda: s)
    assert llm.chain("main") == [("bedrock", "moonshotai.kimi-k2.5"), ("gemini", "gemini-2.5-flash")]
    assert llm.chain("fast") == [("bedrock", "moonshotai.kimi-k2.5"), ("gemini", "gemini-2.5-flash")]
    s.llm_model, s.llm_model_fast = "anthropic.claude-sonnet-5-5", "anthropic.claude-haiku-5-5"   # Claude tiering
    assert llm.chain("main")[0] == ("bedrock", "anthropic.claude-sonnet-5-5")
    assert llm.chain("fast")[0] == ("bedrock", "anthropic.claude-haiku-5-5")


async def test_bedrock_routes_non_claude_models_to_converse(monkeypatch):
    seen = {}

    def fake_converse(system, prompt, schema, max_tokens, model):
        seen["model"] = model
        return '{"ok": true}', (10, 5)

    monkeypatch.setattr(llm, "_converse_sync", fake_converse)
    out = await llm._bedrock("sys", "p", {"type": "object"}, "low", 100, "moonshotai.kimi-k2.5")
    assert out == '{"ok": true}' and seen["model"] == "moonshotai.kimi-k2.5"
