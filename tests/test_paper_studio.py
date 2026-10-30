"""Paper Studio safeguards: citation repair/renumbering, unmeasured-claim guard, figure embedding, vendor scrubbing."""
import io
import zipfile

from backend.app import export
from backend.llm.client import public_describe, scrub
from backend.paper_studio import figures
from backend.paper_studio.studio import _fix_citations, _renumber, _sanitize_mermaid, _unmeasured


def test_invalid_citations_removed_and_renumbered_by_first_use():
    md, removed = _fix_citations("A [3]. B [1, 99]. C [2–4].", n_refs=4)
    assert removed == 1 and "99" not in md
    md, order = _renumber(md)
    assert order == [3, 1, 2, 4] and md.startswith("A [1]. B [2]. C [1, 3, 4].")


def test_unmeasured_numbers_and_result_claims_are_flagged():
    allowed = {"12", "340"}
    method = "Citation-Calibrated RAG (CC-RAG)"
    assert _unmeasured("Our method reduces errors by 40% on 2,500 questions.", allowed, method)
    assert _unmeasured("CC-RAG achieves state-of-the-art accuracy.", allowed, method)
    assert not _unmeasured("Publications rose from 12 in 2016 to 340 in 2025 [2].", allowed, method)
    assert not _unmeasured("CC-RAG is designed to abstain when evidence is thin.", allowed, method)


def test_mermaid_labels_are_sanitised():
    md = _sanitize_mermaid("```mermaid\nflowchart LR\n  A[Input (raw) \"data\"] --> B{Is it ok?}\n```")
    assert "(" not in md.split("```mermaid")[1] and '"' not in md.split("```mermaid")[1]


def test_latex_zip_and_docx_embed_real_figures():
    png = figures.reference_years_chart([2019, 2021, 2021, 2024])
    md = "# Results\n\nFigure: Years\n![Years](/api/paper-studio/abc/fig/years.png)\n\n```mermaid\nflowchart LR\n A --> B\n```\n"
    assets = export.Assets(images={"/api/paper-studio/abc/fig/years.png": png}, diagrams=[png])
    z = zipfile.ZipFile(io.BytesIO(export.latex_zip(md, "T", "ieee", "A", "U", assets)))
    tex = z.read("main.tex").decode()
    assert {"figures/fig1.png", "figures/fig2.png"} <= set(z.namelist()) and "includegraphics" in tex and "Mermaid source" not in tex
    from docx import Document
    doc = Document(io.BytesIO(export.to_docx(md, "T", "ieee", assets=export.Assets(images=assets.images, diagrams=[png]))))
    assert len(doc.inline_shapes) == 2


def test_no_vendor_names_reach_users():
    assert "kimi" not in scrub("bedrock:moonshotai.kimi-k2.5 failed; gemini:gemini-2.5-flash 429").lower()
    d = public_describe()
    assert d["model"] == "Azora engine" and d["fallbacks"] == []


def test_math_validator_matches_katex_on_common_mistakes():
    from backend.paper_studio.studio import math_problem
    assert math_problem(r"\mathbf{H}^{\text{a}}^\top") == "double superscript"
    assert math_problem(r"\frac{1}{2") == "unbalanced braces"
    assert math_problem(r"\left( x") is not None
    for ok in (r"{x^2}^3", r"\sum_{i=1}^{N} x_i^2", r"\mathcal{L}(\theta)=\frac{1}{N}\sum_i \ell_i"):
        assert math_problem(ok) is None


def test_sections_keep_one_top_heading():
    from backend.paper_studio.studio import normalize_section
    out = normalize_section("# Related Work\n\n# Sub topic\n\nx\n\n# A long sentence that is really a paragraph and ends with a full stop.\n\n# Conclusion\n", "Related Work")
    assert out.count("\n# ") == 1 and "## Sub topic" in out and "\nA long sentence" in out and "# Conclusion" in out


def test_kit_checklist_and_reviewers_use_only_real_data():
    from backend.paper_studio.kit import checklist, reviewer_candidates
    md = ("# Abstract\n\n" + "word " * 160 + "\n\n**Keywords:** a, b, c\n\n# Method\n\nFigure: X\n```mermaid\nflowchart LR\n A --> B\n```\n\n"
          "Table: T\n| a | b |\n|---|---|\n| 1 | to be measured |\n\n# Acknowledgment\n\nAI-assisted.\n")
    c = {x["item"]: x for x in checklist({"markdown": md, "references": [{"doi": "x"}] * 16, "report": {}}, "ieee")}
    assert c["Abstract length"]["status"] == "pass" and c["Keywords"]["status"] == "pass"
    assert c["Experimental results"]["status"] == "warn" and c["Figure captions"]["status"] == "pass"
    refs = [{"title": "P1", "authors": ["Ann Lee", "Bo Chen"], "cited_by": 9, "doi": "10.1/x"},
            {"title": "P2", "authors": ["Ann Lee"], "cited_by": 3}]
    names = [r["name"] for r in reviewer_candidates(refs)]
    assert names == ["Ann Lee", "Bo Chen"]


def test_diagram_validator_flags_broken_mermaid():
    from backend.paper_studio.studio import mermaid_problems
    assert not mermaid_problems("flowchart LR\n  A[Input data] --> B[Model]\n  B -->|scores| C{Decision}")
    assert mermaid_problems("flowchart TD\nA[x (y)] --> B")
    assert mermaid_problems("graph LR\nA-->B\nThis is prose")


def test_wording_overlap_drops_after_paraphrase():
    from backend.citeguard.fixer import wording_overlap
    src = "noble metal nanoparticles remain stable inside biological environments"
    assert wording_overlap("Noble metal nanoparticles remain stable inside biological environments.", src) == 1.0
    assert wording_overlap("Gold and silver particles persist in cells without degrading.", src) == 0.0
