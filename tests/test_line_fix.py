"""Line-level similarity: exact shared phrases, cited/uncited, and honest per-line fixes."""
import pytest

from backend.cache.store import get_store
from backend.citeguard import turnitin
from backend.llm import client as llm

SRC = "Graph neural networks propagate information along edges to learn node representations for prediction tasks."
SENT = "In our setting, graph neural networks propagate information along edges to learn node representations efficiently."


def _scan(sid="scanfix1"):
    get_store().put("originality_scan", sid, {
        "scan_id": sid, "title": "t",
        "paragraphs": [{"index": 0, "kind": "prose", "raw": SENT, "sentences": [{
            "id": "p0-s0", "text": SENT, "match": {"kind": "verbatim", "matched_sentence": SRC, "source_title": "GNN survey",
                                                     "source_year": 2021, "source_url": "https://doi.org/x"}}]}],
        "_candidate_sources": [{"title": "GNN survey", "authors": ["Jie Zhou", "Ganqu Cui"], "year": 2021}],
    })
    return sid


def test_shared_phrases_finds_the_copied_run():
    runs = turnitin.shared_phrases(turnitin._word_tokens(SENT), turnitin._word_tokens(SRC))
    assert runs and "graph neural networks propagate information along edges to learn node representations" in runs[0]


async def test_quote_and_cite():
    r = await turnitin.fix_line(_scan(), "p0-s0", "quote")
    assert r["after"].startswith("“") and "(Zhou et al., 2021)" in r["after"] and r["citation_added"]


async def test_rewrite_must_drop_source_wording(monkeypatch):
    attempts = iter([SENT, "Message passing over edges lets these models build node embeddings that support prediction (Zhou et al., 2021)."])

    async def fake(system, prompt, model, **kw):
        return model(sentence=next(attempts))
    monkeypatch.setattr(llm, "complete_json", fake)
    monkeypatch.setattr(llm, "available", lambda: True)
    r = await turnitin.fix_line(_scan("scanfix2"), "p0-s0", "rewrite")
    assert r["overlap_after"] == 0 and "(Zhou et al., 2021)" in r["after"]          # first copy-heavy attempt was rejected


async def test_paraphrase_cannot_be_quoted():
    sid = _scan("scanfix3")
    rec = get_store().get("originality_scan", sid)
    rec["paragraphs"][0]["sentences"][0]["match"]["kind"] = "paraphrase"
    get_store().put("originality_scan", sid, rec)
    with pytest.raises(ValueError):
        await turnitin.fix_line(sid, "p0-s0", "quote")
