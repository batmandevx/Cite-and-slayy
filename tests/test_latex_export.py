"""LaTeX export: papers must compile on Overleaf (pdfLaTeX) with nothing running off the page and no text lost."""
import re
import shutil
import subprocess

import pytest

from backend.app import export
from backend.paper_studio.studio import _clip, _merge_duplicate_refs, repair_fences
from backend.common.schemas import Paper

PAPER = """# Abstract

We study x ≤ 5 ± 0.2 with β = 0.3 and β_int effects [1].

**Keywords:** drift, calibration

# Results

Table: Representative works
| Ref. | Title | Year | Venue | Citations |
|---|---|---|---|---|
| [1] | A very long title about calibration of predictive models under distribution shift in practice | 2021 | Journal of Machine Learning Research | 1,204 |
| [2] | Another long title on conformal prediction for streaming data with change points | 2023 | Transactions on Pattern Analysis | 88 |

![Trend of works](/api/paper-studio/abc/fig/trend.png) This sentence follows the image on the same line and must survive.

$$Y_{ij} = \\beta_0 + \\beta_1 L_{ij} + \\beta_2 A_{ij} + \\beta_3 (L_{ij} \\times A_{ij}) + \\beta_4 \\mathrm{Age}_i + \\beta_5 \\mathrm{Sex}_i + u_{0i} + \\varepsilon_{ij}$$

As shown in [1, 2] and [1–2], results hold; Şahin and Пётр agree — mostly.

# References

1. A. Author, "Calibration", *JMLR*, 2021. doi: 10.1000/ab_c.
2. B. Author, "Conformal", *TPAMI*, 2023.
"""


def test_rows_starting_with_a_bracket_cannot_become_a_length_argument():
    tex = export.to_latex(PAPER, "T", "ieee", "A", "U")
    assert not re.search(r"\\\\\s*\n\s*\[", tex)            # "\\" followed by "[" is read as \\[<length>]
    assert "\\tabularnewline" in tex


def test_unicode_is_pdflatex_safe_and_citations_link():
    tex = export.to_latex(PAPER, "T", "ieee", "A", "U")
    body = tex.split("\\begin{document}", 1)[1]
    assert "$\\leq$" in body and "$\\pm$" in body and "$\\beta_{\\mathrm{int}}$" in body
    assert "Petr" in body and "≤" not in body and "—" not in body
    assert "\\cite{r1,r2}" in body and "\\bibitem{r2}" in body
    assert "doi: \\url{10.1000/ab_c}" in body


def test_text_after_an_inline_image_is_kept():
    tex = export.to_latex(PAPER, "T", "ieee", "A", "U")
    assert "must survive" in tex


def test_long_equation_is_broken_for_a_two_column_page():
    tex = export.to_latex(PAPER, "T", "ieee", "A", "U")
    eq = tex[tex.index("\\begin{equation}"):tex.index("\\end{equation}")]
    assert "\\begin{aligned}" in eq and "&=" in eq


def test_text_heavy_tables_wrap_instead_of_overflowing():
    tex = export.to_latex(PAPER, "T", "ieee", "A", "U")
    assert "\\begin{tabularx}" in tex and "\\resizebox" not in tex


def test_prose_run_onto_a_table_row_becomes_a_paragraph():
    md = "| Year | n |\n|---|---|\n| 2025 | 484 | This growth suggests the construct is proliferating quickly.\n"
    out = repair_fences(md)
    assert "| 2025 | 484 |\n\nThis growth" in out


def test_duplicate_references_are_merged():
    refs = [Paper(id="W1", title="Digital divide among higher education faculty", doi="10.1186/x"),
            Paper(id="s2:abc", title="Digital divide among higher education faculty", doi="10.1186/X"),
            Paper(id="W3", title="Something else entirely different here", doi="10.1/y")]
    md, n = _merge_duplicate_refs("A [1], [2]. B [2, 3].", refs)
    assert n == 1 and md == "A [1]. B [1, 3]."


def test_clip_never_cuts_mid_word():
    assert _clip("Using mobile phones to improve educational outcomes: An analysis", 40) == "Using mobile phones to improve…"


@pytest.mark.skipif(not shutil.which("tectonic"), reason="tectonic not installed")
@pytest.mark.parametrize("template", ["ieee", "plain", "springer"])
def test_paper_compiles_without_overfull_boxes(tmp_path, template):
    tex = export.to_latex(PAPER.replace("![Trend of works](/api/paper-studio/abc/fig/trend.png)", ""), "A Title", template, "A", "U")
    (tmp_path / "main.tex").write_text(tex)
    p = subprocess.run(["tectonic", "--keep-logs", "--chatter", "minimal", "main.tex"], cwd=tmp_path, capture_output=True, text=True, timeout=600)
    log = (tmp_path / "main.log").read_text(errors="ignore")
    assert p.returncode == 0, p.stderr[-800:]
    overfull = re.findall(r"Overfull \\hbox.*\n.*", log)
    assert not overfull, overfull
    assert not re.search(r"(Citation|Reference) `[^']+' .*undefined", log)
