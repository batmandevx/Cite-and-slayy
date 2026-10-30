"""LLM-dependent code paths, exercised with a stubbed provider (no network, no key).

The stub returns canned JSON so we can test parsing, retries, validation and the
"drop questions that cite unknown papers" guard. Nothing here is shown to users.
"""
import json

import pytest

from backend.cache.store import get_store, now
from backend.citeguard import claims
from backend.common.schemas import Cluster, GapRadarResult, Paper, PaperRef
from backend.gap_radar import questions
from backend.jury import personas
from backend.llm import client as llm


@pytest.fixture
def stub(monkeypatch):
    replies: list[str] = []

    async def fake(system, prompt, schema, effort, max_tokens, model=None):
        return replies.pop(0)

    monkeypatch.setattr(llm, "chain", lambda tier="main": [("anthropic", "stub")])
    monkeypatch.setattr(llm, "_cache_key", lambda *a: f"test-{len(replies)}-{id(a)}")  # no cache hits between stub replies
    monkeypatch.setitem(llm._PROVIDERS, "anthropic", fake)
    return replies


async def test_complete_json_retries_once_on_invalid_output(stub):
    stub += ["not json", json.dumps({"score": 7, "weaknesses": ["a"], "fixes": ["b"], "confidence": 0.5, "summary": "s"})]
    out = await llm.complete_json("sys", "prompt", personas._Review)
    assert out.score == 7


async def test_out_of_range_score_is_rejected(stub):
    bad = json.dumps({"score": 14, "weaknesses": [], "fixes": [], "confidence": 0.5, "summary": ""})
    stub += [bad, bad]
    r = await personas.review("Methods", "focus", "t", "body")
    assert r.score is None and r.error  # reported as "not assessed", never coerced


async def test_claim_judgments_map_back_by_id(stub):
    stub.append(json.dumps({"judgments": [
        {"id": 3, "label": "supported", "rationale": "abstract states it"},
        {"id": 5, "label": "unsupported", "rationale": "different topic"}]}))
    res = await claims.judge([(3, "s1", "t1", "a1"), (5, "s2", "t2", "a2")])
    assert res[3].label == "supported" and res[5].label == "unsupported"


async def test_questions_citing_unknown_papers_are_dropped(stub):
    store = get_store()
    papers = [Paper(id=f"W{i}", title=f"Paper {i}", year=2024, abstract="x") for i in range(1, 4)]
    cl = Cluster(cluster_id=0, label="L", description="D", label_source="keywords", size=3, counts_by_year={2024: 3},
                 growth=0.1, recency_share=0.5, cites_per_year=1.0, classification="underexplored", reasons=["r"],
                 top_papers=[PaperRef(id=p.id, title=p.title) for p in papers], keywords=["k"])
    run = GapRadarResult(run_id="test-run", query="q", n_papers=3, years=[2024], clusters=[cl], field_baseline={},
                         thresholds={}, sources_used={}, created_at=now())
    store.put("gap_run", run.run_id, run)
    store.put("gap_context", run.run_id, {"0": {"papers": [p.model_dump() for p in papers], "neighbours": {}}})
    stub.append(json.dumps({"questions": [
        {"question": "Q1", "rationale": "R1", "evidence_ids": [1, 2]},
        {"question": "Q2", "rationale": "R2", "evidence_ids": [99]},
        {"question": "Q3", "rationale": "R3", "evidence_ids": [3]}]}))
    res = await questions.generate("test-run", 0)
    assert [q.text for q in res.questions] == ["Q1", "Q3"]
    assert res.dropped == 1
    assert [p.id for p in res.questions[0].evidence] == ["W1", "W2"]
