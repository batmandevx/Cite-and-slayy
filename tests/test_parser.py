"""Offline tests: reference/citation parsing on the bundled real papers."""
from pathlib import Path

import pytest

from backend.documents.parser import first_author, parse_document, parse_entry

ROOT = Path(__file__).resolve().parents[1]
GARD = ROOT / "demo/autoclaw_run/deliverables/paper.pdf"
RETRACTED_TXT = ROOT / "demo/sample_pdfs/retracted_PMC9402320.txt"
SPEC = ROOT / "demo/sample_pdfs/clean_speculative_decoding_arXiv2211.17192.pdf"
HCQ = ROOT / "demo/sample_pdfs/hcq_nanoparticles_covid_preprint.pdf"


@pytest.fixture(scope="module")
def docs():
    return {p.name: parse_document(p) for p in (GARD, RETRACTED_TXT, SPEC, HCQ)}


def test_gard_numbered_refs_with_split_dois(docs):
    d = docs[GARD.name]
    assert d.title == "GARD: Gradient-Spectral Rank Allocation for LoRA Fine-Tuning"
    assert len(d.references) == 15
    assert all(r.parsed.doi for r in d.references)  # DOIs broken across lines are re-joined
    assert d.references[2].parsed.doi == "10.18653/v1/2024.findings-emnlp.802"
    assert len(d.citations) >= 20


def test_pmc_text_without_heading(docs):
    d = docs[RETRACTED_TXT.name]
    assert d.doi == "10.1155/2022/4989248"
    assert len(d.references) == 23
    assert d.references[0].parsed.first_author == "Liu"
    assert any(c.ref_indices == [1] for c in d.citations)


def test_author_year_style_and_running_headers(docs):
    d = docs[SPEC.name]
    assert d.title == "Fast Inference from Transformers via Speculative Decoding"  # not the rotated arXiv stamp
    assert len(d.references) == 28
    titles = {r.label: r.parsed.title for r in d.references}
    assert titles["Brown 2020"] == "Language models are few-shot learners"
    assert titles["Vaswani 2017"] == "Attention is all you need"
    # running header must not be spliced into the reference
    assert titles["Chelba 2013"].startswith("One billion word benchmark")
    assert len(d.citations) >= 20  # "(Vaswani et al., 2017)" and "Stern et al. (2018)" forms


def test_parenthesised_numbering(docs):
    d = docs[HCQ.name]
    assert len(d.references) == 57
    assert d.references[5].parsed.first_author == "Gautret"


def test_first_author_variants():
    assert first_author("Liu M. Zhang J. Adeli E.") == "Liu"
    assert first_author("Tianran Chen, Jiarui Chen, and Yunming Ye. Title.") == "Chen"
    assert first_author("Smith, J., and Doe, A. Title.") == "Smith"


def test_parse_entry_extracts_arxiv_and_year():
    p = parse_entry("Hinton, G., Vinyals, O., and Dean, J. Distilling the knowledge in a neural network. ArXiv, abs/1503.02531, 2015.")
    assert p.year == 2015
    assert p.title == "Distilling the knowledge in a neural network"
