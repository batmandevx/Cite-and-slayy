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


def test_monograph_sections_venues_figure_and_ieee_latex_export():
    from backend.paper_studio.studio import SECTIONS
    keys = [k for k, *_ in SECTIONS]
    assert keys == ["intro", "related", "formulation", "method", "theory", "analysis", "protocol", "discussion"]
    png = figures.venues_chart([("IEEE Access", 14), ("NeurIPS", 9), ("ICML", 6)])
    assert png.startswith(b"\x89PNG")
    md = (
        "# Abstract\n\nFormal summary.\n\n**Keywords:** conformal prediction, drift, online calibration\n\n"
        "# Proposed Method\n\n> **Algorithm 1:** Adaptive Calibration\n> **Input:** stream $z_t$\n\n"
        "Table: Positioning across five dimensions\n"
        "| Family | Drift | O(1) | distribution-free | Tamper-evident | Notes |\n"
        "|---|---|---|---|---|---|\n"
        "| Split CP | No | Yes | Yes | No | Static |\n"
        "| Ours | Yes | Yes | Yes | Yes | Adaptive |\n"
    )
    tex = export.to_latex(md, "ADITI: Drift-Aware Intervals", "ieee", "A. Author", "VIT")
    assert "\\begin{IEEEkeywords}" in tex
    assert "\\toprule" in tex and "\\bottomrule" in tex
    assert "\\begin{table*}" in tex
    assert "\\fbox{\\parbox" in tex


def test_unmeasured_ignores_theorem_and_assumption_labels():
    allowed = {"25"}
    assert not _unmeasured("Under Assumption A12 and Proposition 14, the design targets non-stationary streams.", allowed, "ADITI")


def test_demo_showcase_papers_endpoints():
    from fastapi.testclient import TestClient
    from backend.app.main import app
    c = TestClient(app)
    res = c.get("/api/demo-papers")
    assert res.status_code == 200
    items = res.json()
    assert [x["slug"] for x in items] == ["aditi", "aliza", "cast"]
    pdf = c.get("/api/demo-papers/aditi/pdf")
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")
    imp = c.post("/api/demo-papers/aliza/import")
    assert imp.status_code == 200 and imp.json()["title"].startswith("ALIZA:")
    samples = c.get("/api/documents/samples")
    assert samples.status_code == 200
    titles = [s.get("title") or "" for s in samples.json()]
    assert any("ADITI:" in t for t in titles) and any("ALIZA:" in t for t in titles) and any("Chiral Amplification" in t for t in titles)


def test_venue_finder_handles_coined_camel_case_and_hyphenated_titles():
    import asyncio
    from backend.app import venue_finder

    title = "ResidentLoop: Hardware-Software Co-Design for Autonomous GPU-Resident Closed-Loop Control with Bounded End-to-End Latency"
    abstract = (
        "Embedded autonomous systems increasingly deploy GPU-accelerated neural networks for time-critical control, "
        "yet contemporary architectures retain the CPU as mediator of every sensor-to-actuator iteration."
    )
    qs = venue_finder.build_search_queries(title, abstract)
    assert len(qs) >= 2
    # Must drop coined CamelCase system name 'ResidentLoop' and split hyphens like 'GPU-Resident'
    assert all("ResidentLoop" not in q for q in qs)
    assert any("GPU" in q for q in qs)

    # Mock OpenAlex client to verify venue aggregation + source fallback works even if /sources returns empty
    class _FakeFetched:
        def __init__(self, data):
            self.data = data

    class _FakeClient:
        async def get(self, url, params=None):
            if url.endswith("/works"):
                return _FakeFetched({
                    "results": [
                        {
                            "id": "https://openalex.org/W1",
                            "doi": "https://doi.org/10.1109/TCAD.2024.1",
                            "title": "Hardware-Software Co-Design for Real-Time GPU Control Systems",
                            "publication_year": 2024,
                            "abstract_inverted_index": {"GPU": [0], "control": [1], "latency": [2]},
                            "primary_location": {
                                "source": {
                                    "id": "https://openalex.org/S111",
                                    "display_name": "IEEE Transactions on Computer-Aided Design of Integrated Circuits and Systems",
                                    "type": "journal",
                                    "host_organization_name": "IEEE",
                                    "is_oa": False,
                                }
                            },
                        }
                    ]
                })
            return _FakeFetched({"results": []})

    orig_client = venue_finder.openalex.client
    venue_finder.openalex.client = lambda: _FakeClient()
    try:
        res = asyncio.run(venue_finder.find(title, abstract, kind="any", oa_only=False))
        assert len(res["venues"]) >= 1
        assert "IEEE Transactions" in res["venues"][0]["name"]
    finally:
        venue_finder.openalex.client = orig_client


def test_turnitin_scanner_verbatim_and_ai_stylometric_signals():
    import asyncio
    from backend.citeguard import turnitin

    sources = [
        {
            "key": "10.1000/test1",
            "openalex_id": "W999",
            "title": "Adaptive Conformal Calibration Under Non-Stationary Covariate Drift",
            "authors": ["A. Gibbs", "E. Candes"],
            "year": 2023,
            "venue": "NeurIPS",
            "doi": "10.1000/test1",
            "url": "https://doi.org/10.1000/test1",
            "abstract": "Online adaptive conformal inference updates miscoverage levels via gradient step sizes on the pinball loss under distribution shift.",
            "sentences": [
                "Online adaptive conformal inference updates miscoverage levels via gradient step sizes on the pinball loss under distribution shift."
            ],
        }
    ]
    text = (
        "In the realm of streaming uncertainty quantification, calibration plays a pivotal role in safety-critical decisions, "
        "highlighting its multifaceted importance across deployments. "
        "Online adaptive conformal inference updates miscoverage levels via gradient step sizes on the pinball loss under distribution shift. "
        "Moreover, this framework meticulously balances interval width against empirical validity, underscoring the resilience of online quantile tracking."
    )
    scored = asyncio.run(turnitin._score_manuscript("Test Conformal Manuscript", text, sources, exclude_quotes=True))
    assert scored["similarity_pct"] > 20
    assert scored["verbatim_pct"] > 20
    assert len(scored["sources"]) == 1 and scored["sources"][0]["id"] == 1
    assert scored["ai_pct"] > 30
    assert scored["cliche_count"] >= 3



def test_tables_with_unmeasured_numbers_are_removed_but_plans_kept():
    from backend.paper_studio.studio import strip_unmeasured_tables
    md = ("Table: Posterior evolution in a synthetic scenario\n\n| t | a | b |\n|---|---|---|\n| 25 | 8.47 | 0.236 |\n| 50 | 2.31 | 1.203 |\n\n"
          "Table: Planned benchmark comparison\n| Method | AUC |\n|---|---|\n| Ours | to be measured |\n\n"
          "Table: Summary of mathematical notation\n| Symbol | Meaning |\n|---|---|\n| x | 12.5 |\n")
    out, n = strip_unmeasured_tables(md, allowed={"12"})
    assert n == 1 and "synthetic" not in out and "Planned benchmark" in out and "notation" in out


def test_deck_data_comes_from_the_paper():
    from backend.paper_studio.deck import extract_data
    md = ("# Proposed Method\n\nFigure: Architecture of the proposed framework\n```mermaid\nflowchart LR\n  subgraph S\n  A[Input<br>data] --> B{Gate}\n  B --> C[Model]\n  end\n```\n\n"
          "Table: Annual OpenAlex publication counts matching each phrase\n| Year | foo |\n|---|---|\n| 2023 | 5 |\n| 2024 | 9 |\n")
    d = extract_data({"markdown": md, "references": [{"n": 1, "title": "T", "year": 2024, "cited_by": 7}], "words": 10})
    assert [n["label"] for n in d["architecture"]["nodes"]] == ["Input data", "Gate", "Model"]
    assert d["architecture"]["nodes"][1]["decision"] and d["trend"]["series"][0]["values"] == [5, 9]
    assert d["stats"]["references"] == 1 and d["ref_years"] == {"labels": ["2024"], "values": [1]}


def test_palette_from_template_cover_is_readable():
    import io
    from PIL import Image, ImageDraw
    from backend.paper_studio.palette import _contrast, palette_from_image
    im = Image.new("RGB", (400, 225), (248, 243, 238))
    d = ImageDraw.Draw(im)
    d.rectangle((0, 0, 120, 225), fill=(21, 13, 44))        # navy band
    d.ellipse((200, 40, 330, 170), fill=(226, 54, 33))      # red accent
    buf = io.BytesIO(); im.save(buf, "JPEG")
    p = palette_from_image(buf.getvalue())
    rgb = lambda h: tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
    assert p["ink"].startswith(("1", "0", "2")) and rgb(p["accent"])[0] > 180
    assert _contrast(rgb(p["accent"]), (255, 255, 255)) >= 3.2 and _contrast(rgb(p["ink"]), (255, 255, 255)) >= 10
