"""Live tests against the real Crossref / Semantic Scholar / OpenAlex APIs.

Run with:  uv run pytest -m live
They assert facts that are public record (e.g. Crossref's retraction notice for 10.1155/2022/4989248).
"""
from pathlib import Path

import pytest

from backend.citeguard.resolver import resolve_all, resolve_reference, self_status
from backend.documents.parser import parse_document

ROOT = Path(__file__).resolve().parents[1]
pytestmark = pytest.mark.live


async def test_retracted_paper_itself_is_flagged():
    d = parse_document(ROOT / "demo/sample_pdfs/retracted_PMC9402320.txt")
    ss = await self_status(d.title, d.doi)
    assert ss.retraction == "retracted"
    assert "10.1155/2023/9780628" in ss.notices
    assert any(e.request_url for e in ss.evidence)  # evidence carries the exact API call


async def test_citation_of_retracted_journal_article_is_flagged():
    d = parse_document(ROOT / "demo/sample_pdfs/hcq_nanoparticles_covid_preprint.pdf")
    check, _ = await resolve_reference(d.references[5], check_retraction=True)  # Gautret et al. 2020, IJAA
    assert check.status == "verified"
    assert check.matched and check.matched.doi.lower() == "10.1016/j.ijantimicag.2020.105949"
    assert check.retraction == "retracted"


async def test_autoclaw_showcase_references_all_exist():
    d = parse_document(ROOT / "demo/autoclaw_run/deliverables/paper.pdf")
    results = await resolve_all(d.references, check_retraction=False)
    statuses = [c.status for c, _ in results]
    assert statuses.count("not_found") == 0
    # API hiccups may yield could_not_verify, but never a fabricated "verified"
    for c, p in results:
        if c.status == "verified":
            assert p is not None and c.evidence
