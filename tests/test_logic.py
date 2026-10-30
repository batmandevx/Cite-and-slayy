"""Offline unit tests for matching, scoring, verdict rules, phrase list and LLM schema handling.

Inputs here are hand-built objects that exercise the rules; they are test fixtures, not data
presented to users.
"""
from datetime import datetime, timezone

from backend.citeguard import score
from backend.citeguard.phrases import find_phrases, load_phrases
from backend.citeguard.resolver import assess, author_matches
from backend.common.schemas import (
    AuditReport, FieldDiff, Paper, ParsedRef, PersonaReview, ReferenceCheck, SelfStatus,
)
from backend.jury.verdict import decide
from backend.llm.client import strict_schema
from backend.jury.personas import _Review
from backend.sources.crossref import classify_updates

NOW = datetime.now(timezone.utc)


def ref(raw, title=None, year=None, fa=None):
    return ParsedRef(raw=raw, title=title, year=year, first_author=fa)


# ---------- matching ----------

def test_similar_title_different_paper_is_rejected():
    r = ref("Brown, T. B., Mann, B. Language models are few-shot learners. NeurIPS 2020.",
            "Language models are few-shot learners", 2020, "Brown")
    other = Paper(id="x", title="Making Pre-trained Language Models Better Few-shot Learners", year=2021, authors=["Tianyu Gao"])
    assert not assess(r, other, by_doi=False).matched


def test_same_title_wrong_year_and_author_is_rejected():
    r = ref("Elbayad, M. Depth-adaptive transformer. ArXiv 2019.", "Depth-adaptive transformer", 2019, "Elbayad")
    other = Paper(id="x", title="Depth-Adaptive Transformer", year=2026, authors=["A. Toor"])
    assert not assess(r, other, by_doi=False).matched


def test_year_mismatch_is_reported_with_diff():
    r = ref("Vaswani, A. Attention is all you need. NeurIPS 2017.", "Attention is all you need", 2017, "Vaswani")
    rec = Paper(id="x", title="Attention Is All You Need", year=2025, authors=["Ashish Vaswani"])
    a = assess(r, rec, by_doi=False)
    assert a.matched and [d.field for d in a.diffs] == ["year"]


def test_doi_resolving_to_other_work_flags_title():
    r = ref("X. Some title about graphs. 2020. doi:10.1/abc", "Some title about graphs", 2020, "X")
    rec = Paper(id="x", title="Completely unrelated chemistry paper", year=2020, authors=["X"])
    a = assess(r, rec, by_doi=True)
    assert a.matched and "title" in [d.field for d in a.diffs]


def test_author_match_tolerates_dropped_diacritics():
    assert author_matches("Burduel", ["Alexandra-Cristina Burdușel", "Oana Gherasim"])
    assert author_matches("Rger", ["Robert Rüger"])
    assert not author_matches("Brown", ["Tianyu Gao", "Adam Fisch"])


def test_crossref_update_classification():
    updated_by = [{"DOI": "10.1155/2023/9780628", "type": "retraction", "source": "retraction-watch"}]
    st, notices, _ = classify_updates(updated_by, [], "10.1155/2022/4989248")
    assert st == "retracted" and notices == ["10.1155/2023/9780628"]
    st, notices, _ = classify_updates([], [], "10.1/x")
    assert st == "none_found" and notices == []


# ---------- score ----------

def _ref(i, status, retraction="none_found"):
    return ReferenceCheck(ref_index=i, label=f"[{i}]", parsed=ParsedRef(raw="r"), status=status, retraction=retraction)


def test_score_excludes_unverifiable_and_penalises_retractions():
    refs = [_ref(1, "verified"), _ref(2, "verified", "retracted"), _ref(3, "could_not_verify")]
    s, terms, low = score.compute(refs, [], [], [], 10, None, {"refs", "phrases", "overlap"})
    names = {t.name: t for t in terms}
    assert names["References"].value == 40  # could_not_verify excluded from the denominator
    assert s == 100 - 15
    assert low  # 1/3 could not be verified (>30%)


def test_self_retracted_scores_zero():
    ss = SelfStatus(doi="10.1/x", title="t", resolved=None, retraction="retracted")
    s, _, _ = score.compute([_ref(1, "verified")], [], [], [], 5, ss, {"refs", "phrases", "overlap"})
    assert s == 0


# ---------- verdict ----------

def _audit(score_value, **summary):
    base = {"not_found": 0, "retracted_cited": 0, "self_retracted": 0}
    base.update(summary)
    return AuditReport(audit_id="a", document_id="d", checks_run=[], self_status=None, references=[], claims=[],
                       phrases=[], overlaps=[], highlights=[], score=score_value, score_terms=[], low_confidence=False,
                       warnings=[], summary=base, created_at=NOW)


def _jury(*scores):
    return [PersonaReview(persona=f"P{i}", score=s, confidence=0.8) for i, s in enumerate(scores)]


def test_submit_needs_everything():
    assert decide(_audit(90), _jury(8, 8, 7, 8))[0] == "submit"


def test_not_found_forces_at_least_revise():
    assert decide(_audit(90, not_found=1), _jury(9, 9, 9, 9))[0] == "revise"


def test_three_not_found_is_dont_submit():
    assert decide(_audit(90, not_found=3), _jury(9, 9, 9, 9))[0] == "dont_submit"


def test_retracted_citation_forces_revise_and_self_retraction_blocks():
    assert decide(_audit(90, retracted_cited=1), _jury(9, 9, 9, 9))[0] == "revise"
    assert decide(_audit(90, self_retracted=1), _jury(9, 9, 9, 9))[0] == "dont_submit"


def test_missing_jury_or_audit_cannot_submit():
    assert decide(_audit(95), [PersonaReview(persona="M", error="no LLM")])[0] == "revise"
    assert decide(None, _jury(9, 9, 9, 9))[0] == "revise"


def test_low_persona_blocks_submit():
    assert decide(_audit(95), _jury(9, 9, 9, 4))[0] == "revise"


# ---------- phrases & schema ----------

def test_phrase_list_loads_from_source_and_matches_across_linebreaks():
    phrases = load_phrases()
    assert len(phrases) >= 50
    assert all(p.source_url for p in phrases)  # every entry cites its published source
    hits = find_phrases(["We used a profound neural\norganization and colossal information."], None)
    assert {h.phrase for h in hits} == {"profound neural organization", "colossal information"}


def test_strict_schema_closes_objects():
    sch = strict_schema(_Review)
    assert sch["additionalProperties"] is False
    assert set(sch["required"]) == {"score", "weaknesses", "fixes", "confidence", "summary"}
    assert "maximum" not in str(sch)  # range constraints are re-checked by Pydantic instead
