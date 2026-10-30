"""Export a Markdown note / paper draft to LaTeX (IEEE, Springer LNCS, or plain article) or Word (.docx).

Supported Markdown: # headings, paragraphs, **bold**, *italic*, `code`, lists, - [ ] checklists, GFM tables
(an optional "Table: caption" line right above), $inline$ and $$display$$ math, ![caption](image),
fenced code, and ```mermaid diagrams (embedded as PNG when the browser sends the rendered diagram, otherwise a
clearly marked placeholder with the Mermaid source, since LaTeX/Word can't run Mermaid). "Abstract" and "References" headings are mapped to the template's own
environments. Nothing is invented: what you wrote is what gets exported.
"""
from __future__ import annotations

import io
import re
from dataclasses import dataclass, field
from typing import Literal

Template = Literal["ieee", "springer", "plain"]


@dataclass
class Assets:
    """Figure bytes for export: images keyed by their Markdown src, plus Mermaid diagrams rendered to PNG (in order)."""
    images: dict[str, bytes] = field(default_factory=dict)
    diagrams: list[bytes | None] = field(default_factory=list)
    files: dict[str, bytes] = field(default_factory=dict)      # filled by to_latex: figure files for the .zip


# ---------- tiny Markdown block parser ----------

@dataclass
class Block:
    kind: str                     # heading, para, ul, ol, check, table, code, mermaid, math, image
    text: str = ""
    level: int = 0
    items: list = field(default_factory=list)
    rows: list = field(default_factory=list)
    caption: str = ""
    lang: str = ""


def parse_md(md: str) -> list[Block]:
    lines = md.replace("\r\n", "\n").split("\n")
    out: list[Block] = []
    i = 0
    pending_caption = ""
    while i < len(lines):
        ln = lines[i]
        s = ln.strip()
        if not s:
            i += 1; continue
        if s.startswith("```"):
            lang = s[3:].strip().lower()
            body = []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith("```"):
                body.append(lines[i]); i += 1
            i += 1
            out.append(Block("mermaid" if lang == "mermaid" else "code", "\n".join(body), lang=lang, caption=pending_caption))
            pending_caption = ""; continue
        if s.startswith("$$"):
            body = [s[2:]]
            if not (s.endswith("$$") and len(s) > 4):
                i += 1
                while i < len(lines) and "$$" not in lines[i]:
                    body.append(lines[i]); i += 1
                if i < len(lines):
                    body.append(lines[i].split("$$")[0])
            else:
                body = [s[2:-2]]
            i += 1
            out.append(Block("math", "\n".join(body).strip().rstrip("$").strip())); continue
        m = re.match(r"^(#{1,4})\s+(.*)", s)
        if m:
            out.append(Block("heading", m.group(2).strip(), level=len(m.group(1)))); i += 1; continue
        m = re.match(r"^(table|figure):\s*(.+)$", s, re.I)
        if m:
            pending_caption = m.group(2).strip(); i += 1; continue
        m = re.match(r"^!\[(.*?)\]\((.*?)\)", s)
        if m:
            out.append(Block("image", m.group(2), caption=m.group(1) or pending_caption)); pending_caption = ""; i += 1; continue
        if s.startswith("|"):
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                cells = [c.strip() for c in lines[i].strip().strip("|").split("|")]
                if not all(re.fullmatch(r":?-{2,}:?", c) for c in cells):
                    rows.append(cells)
                i += 1
            out.append(Block("table", rows=rows, caption=pending_caption)); pending_caption = ""; continue
        if re.match(r"^[-*]\s+\[( |x|X)\]\s+", s):
            items = []
            while i < len(lines) and re.match(r"^\s*[-*]\s+\[( |x|X)\]\s+", lines[i]):
                mm = re.match(r"^\s*[-*]\s+\[( |x|X)\]\s+(.*)", lines[i])
                items.append((mm.group(1).lower() == "x", mm.group(2))); i += 1
            out.append(Block("check", items=items)); continue
        if re.match(r"^[-*+]\s+", s):
            items = []
            while i < len(lines) and re.match(r"^\s*[-*+]\s+", lines[i]):
                items.append(re.sub(r"^\s*[-*+]\s+", "", lines[i])); i += 1
            out.append(Block("ul", items=items)); continue
        if re.match(r"^\d+[.)]\s+", s):
            items = []
            while i < len(lines) and re.match(r"^\s*\d+[.)]\s+", lines[i]):
                items.append(re.sub(r"^\s*\d+[.)]\s+", "", lines[i])); i += 1
            out.append(Block("ol", items=items)); continue
        if s.startswith(">"):
            q_lines = []
            while i < len(lines) and lines[i].strip().startswith(">"):
                q_lines.append(re.sub(r"^\s*>\s?", "", lines[i]).strip()); i += 1
            out.append(Block("quote", "\n".join(x for x in q_lines if x))); continue
        para = [s]
        i += 1
        while i < len(lines) and lines[i].strip() and not re.match(r"^(#{1,4}\s|```|\$\$|\||>|[-*+]\s|\d+[.)]\s|!\[|(table|figure):)", lines[i].strip(), re.I):
            para.append(lines[i].strip()); i += 1
        out.append(Block("para", " ".join(para)))
    return out


# ---------- LaTeX ----------

_TEX_ESC = {"&": r"\&", "%": r"\%", "#": r"\#", "_": r"\_", "{": r"\{", "}": r"\}", "~": r"\textasciitilde{}",
            "^": r"\textasciicircum{}", "\\": r"\textbackslash{}"}


def tex_inline(s: str) -> str:
    parts = re.split(r"(\$[^$]+\$|`[^`]+`)", s)       # keep math and code spans intact
    out = []
    for p in parts:
        if p.startswith("$") and p.endswith("$") and len(p) > 1:
            out.append(p)
        elif p.startswith("`") and p.endswith("`") and len(p) > 1:
            out.append(r"\texttt{" + "".join(_TEX_ESC.get(c, c) for c in p[1:-1]) + "}")
        else:
            t = "".join(_TEX_ESC.get(c, c) for c in p)
            t = re.sub(r"\*\*(.+?)\*\*", r"\\textbf{\1}", t)
            t = re.sub(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?!\w)", r"\\emph{\1}", t)
            t = re.sub(r"\[(.+?)\]\((https?://[^)]+)\)", r"\1\\footnote{\\url{\2}}", t)
            t = re.sub(r"\+\+(.+?)\+\+", r"\\underline{\1}", t)
            t = re.sub(r"==(.+?)==", r"\\colorbox{yellow}{\1}", t)
            t = re.sub(r"(?:\\textasciitilde\{\}){2}(.+?)(?:\\textasciitilde\{\}){2}", r"\1", t)
            t = re.sub(r"\\textasciicircum\{\}(\S+?)\\textasciicircum\{\}", r"\\textsuperscript{\1}", t)
            out.append(t)
    return "".join(out)


PREAMBLES = {
    "ieee": r"""\documentclass[journal]{IEEEtran}
\usepackage{amsmath,amssymb,amsthm,graphicx,url,array,booktabs,hyperref,xcolor}
\hypersetup{colorlinks=true,linkcolor=blue,citecolor=blue,urlcolor=blue}
\newtheorem{theorem}{Theorem}
\newtheorem{lemma}{Lemma}
\newtheorem{proposition}{Proposition}
\newtheorem{assumption}{Assumption}
\begin{document}
\title{%(title)s}
\author{\IEEEauthorblockN{%(author)s}\IEEEauthorblockA{%(affil)s}}
\maketitle
""",
    "springer": r"""\documentclass[runningheads]{llncs}
\usepackage{amsmath,amssymb,graphicx,url,array,booktabs,hyperref,xcolor}
\hypersetup{colorlinks=true,linkcolor=blue,citecolor=blue,urlcolor=blue}
\begin{document}
\title{%(title)s}
\author{%(author)s}
\institute{%(affil)s}
\maketitle
""",
    "plain": r"""\documentclass[11pt]{article}
\usepackage{amsmath,amssymb,amsthm,graphicx,url,array,booktabs,geometry,hyperref,xcolor}
\geometry{margin=1in}
\hypersetup{colorlinks=true,linkcolor=blue,citecolor=blue,urlcolor=blue}
\newtheorem{theorem}{Theorem}
\newtheorem{lemma}{Lemma}
\newtheorem{proposition}{Proposition}
\newtheorem{assumption}{Assumption}
\begin{document}
\title{%(title)s}
\author{%(author)s \\ %(affil)s}
\date{}
\maketitle
""",
}


def to_latex(md: str, title: str, template: Template = "ieee", author: str = "Author Name", affil: str = "Affiliation",
             assets: Assets | None = None) -> str:
    blocks = parse_md(md)
    assets = assets or Assets()
    n_diag = 0
    out = [PREAMBLES[template] % {"title": tex_inline(title), "author": tex_inline(author), "affil": tex_inline(affil)}]
    in_refs = False
    refs: list[str] = []
    fig = tab = 0
    i = 0
    while i < len(blocks):
        b = blocks[i]
        if b.kind == "heading":
            name = b.text.strip().lower()
            if name == "abstract":
                body = []
                kw_line = ""
                while i + 1 < len(blocks) and blocks[i + 1].kind == "para":
                    i += 1
                    raw_p = blocks[i].text.strip()
                    km = re.match(r"^\*\*(?:Keywords|Index Terms):\*\*\s*(.+)$", raw_p, re.I)
                    if km:
                        kw_line = tex_inline(km.group(1).strip())
                    else:
                        body.append(tex_inline(raw_p))
                if template == "springer" and kw_line:
                    out.append("\\begin{abstract}\n" + "\n\n".join(body) + f"\n\\keywords{{{kw_line}}}\n\\end{{abstract}}\n")
                else:
                    out.append("\\begin{abstract}\n" + "\n\n".join(body) + "\n\\end{abstract}\n")
                    if kw_line and template == "ieee":
                        out.append(f"\\begin{{IEEEkeywords}}\n{kw_line}\n\\end{{IEEEkeywords}}\n")
                    elif kw_line:
                        out.append(f"\\noindent\\textbf{{Keywords:}} {kw_line}\n")
            elif name in ("references", "bibliography"):
                in_refs = True
            else:
                in_refs = False
                cmd = {1: "section", 2: "subsection", 3: "subsubsection", 4: "paragraph"}[min(b.level, 4)]
                out.append(f"\\{cmd}{{{tex_inline(b.text)}}}\n")
        elif in_refs and b.kind in ("ol", "ul", "para"):
            refs += b.items if b.kind != "para" else [b.text]
        elif b.kind == "para":
            out.append(tex_inline(b.text) + "\n")
        elif b.kind == "quote":
            q_body = " \\\\\n".join(tex_inline(ln) for ln in b.text.splitlines() if ln.strip())
            if re.search(r"algorithm\s+\d", b.text, re.I):
                out.append("\\par\\smallskip\\noindent\\fbox{\\parbox{0.96\\linewidth}{\\small\n" + q_body + "\n}}\\smallskip\\par\n")
            else:
                out.append("\\begin{quote}\n" + q_body + "\n\\end{quote}\n")
        elif b.kind in ("ul", "ol"):
            env = "itemize" if b.kind == "ul" else "enumerate"
            out.append(f"\\begin{{{env}}}\n" + "".join(f"  \\item {tex_inline(x)}\n" for x in b.items) + f"\\end{{{env}}}\n")
        elif b.kind == "check":
            box_done, box_open = r"$\boxtimes$", r"$\square$"
            items = "".join("  \\item[" + (box_done if d else box_open) + "] " + tex_inline(x) + "\n" for d, x in b.items)
            out.append("\\begin{itemize}\n" + items + "\\end{itemize}\n")
        elif b.kind == "math":
            out.append("\\begin{equation}\n" + b.text + "\n\\end{equation}\n")
        elif b.kind == "table" and b.rows:
            tab += 1
            ncol = max(len(r) for r in b.rows)
            rows = [r + [""] * (ncol - len(r)) for r in b.rows]
            wide = template == "ieee" and (ncol >= 5 or max((sum(len(c) for c in r) for r in rows), default=0) > 55)
            env_t = "table*" if (template == "ieee" and ncol >= 5) else "table"
            hdr = " & ".join(f"\\textbf{{{tex_inline(c)}}}" for c in rows[0]) + r" \\ \midrule"
            body_lines = [" & ".join(tex_inline(c) for c in r) + r" \\" for r in rows[1:]]
            tabular = f"\\begin{{tabular}}{{{'l' * ncol}}}\n\\toprule\n" + "\n".join([hdr] + body_lines) + "\n\\bottomrule\n\\end{tabular}"
            if wide and env_t == "table":
                tabular = f"\\resizebox{{\\columnwidth}}{{!}}{{{tabular}}}"
            elif env_t == "table*":
                tabular = f"\\resizebox{{\\textwidth}}{{!}}{{{tabular}}}" if max((sum(len(c) for c in r) for r in rows), default=0) > 110 else tabular
            out.append(f"\\begin{{{env_t}}}[t]\n\\centering\n" + (f"\\caption{{{tex_inline(b.caption)}}}\n" if b.caption else "")
                       + f"\\label{{tab:{tab}}}\n{tabular}\n\\end{{{env_t}}}\n")
        elif b.kind == "image":
            fig += 1
            path = b.text
            if b.text in assets.images:
                path = f"figures/fig{fig}.png"
                assets.files[path] = assets.images[b.text]
            out.append(f"\\begin{{figure}}[t]\n\\centering\n\\includegraphics[width=\\linewidth]{{{path}}}\n"
                       + (f"\\caption{{{tex_inline(b.caption)}}}\n" if b.caption else "") + f"\\label{{fig:{fig}}}\n\\end{{figure}}\n")
        elif b.kind == "mermaid" and n_diag < len(assets.diagrams) and assets.diagrams[n_diag]:
            fig += 1
            path = f"figures/fig{fig}.png"
            assets.files[path] = assets.diagrams[n_diag]  # type: ignore[assignment]
            n_diag += 1
            out.append(f"\\begin{{figure}}[t]\n\\centering\n\\includegraphics[width=\\linewidth]{{{path}}}\n"
                       + (f"\\caption{{{tex_inline(b.caption)}}}\n" if b.caption else "") + f"\\label{{fig:{fig}}}\n\\end{{figure}}\n")
        elif b.kind == "mermaid":
            fig += 1
            n_diag += 1
            src = "\n".join("% " + x for x in b.text.splitlines())
            out.append("\\begin{figure}[t]\n\\centering\n\\fbox{\\parbox{0.9\\linewidth}{\\centering Diagram: export the Mermaid source below to PDF "
                       "(e.g. mermaid.live or mermaid-cli) and replace this box with \\texttt{\\textbackslash includegraphics}.}}\n"
                       + (f"\\caption{{{tex_inline(b.caption)}}}\n" if b.caption else "\\caption{Diagram}\n") + f"\\label{{fig:{fig}}}\n{src}\n\\end{{figure}}\n")
        elif b.kind == "code":
            out.append("\\begin{verbatim}\n" + b.text + "\n\\end{verbatim}\n")
        i += 1
    if refs:
        out.append("\\begin{thebibliography}{99}\n" + "".join(f"\\bibitem{{r{n}}} {tex_inline(r)}\n" for n, r in enumerate(refs, 1)) + "\\end{thebibliography}\n")
    out.append("\\end{document}\n")
    return "\n".join(out)


# ---------- Word ----------

def _runs(par, text: str):
    for part in re.split(r"(\*\*.+?\*\*|\+\+.+?\+\+|==.+?==|~~.+?~~|\^\S+?\^|\*[^*]+\*|`[^`]+`|\$[^$]+\$)", text):
        if not part:
            continue
        if part.startswith("++") and len(part) > 4:
            par.add_run(part[2:-2]).underline = True
        elif part.startswith("==") and len(part) > 4:
            r = par.add_run(part[2:-2]); r.font.highlight_color = 7   # WD_COLOR_INDEX.YELLOW
        elif part.startswith("~~") and len(part) > 4:
            par.add_run(part[2:-2]).font.strike = True
        elif part.startswith("^") and len(part) > 2:
            par.add_run(part[1:-1]).font.superscript = True
        elif part.startswith("**"):
            par.add_run(part[2:-2]).bold = True
        elif part.startswith("`") or part.startswith("$"):
            r = par.add_run(part.strip("`$")); r.font.name = "Consolas"
        elif part.startswith("*"):
            par.add_run(part[1:-1]).italic = True
        else:
            par.add_run(part)


def latex_zip(md: str, title: str, template: Template, author: str, affil: str, assets: Assets) -> bytes:
    """main.tex + figures/*.png in one .zip (upload it to Overleaf via New Project > Upload Project)."""
    import zipfile
    tex = to_latex(md, title, template, author, affil, assets)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("main.tex", tex)
        for path, data in assets.files.items():
            z.writestr(path, data)
        z.writestr("README.txt", f"Compile main.tex with pdfLaTeX. Template: {template}. "
                   + ("IEEEtran.cls ships with TeX Live/Overleaf." if template == "ieee" else
                      "llncs.cls is available on Overleaf or from Springer's LNCS author kit." if template == "springer" else ""))
    return buf.getvalue()


def to_docx(md: str, title: str, template: Template = "ieee", author: str = "", affil: str = "",
            assets: Assets | None = None) -> bytes:
    from docx import Document
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.shared import Inches, Pt

    assets = assets or Assets()
    n_diag = 0

    doc = Document()
    style = doc.styles["Normal"]
    style.font.name = "Times New Roman"
    style.font.size = Pt(10 if template == "ieee" else 11)
    h = doc.add_heading(title, level=0); h.alignment = WD_ALIGN_PARAGRAPH.CENTER
    if author or affil:
        p = doc.add_paragraph(f"{author}\n{affil}".strip()); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    for b in parse_md(md):
        if b.kind == "heading":
            doc.add_heading(b.text, level=min(max(b.level, 1), 3))
        elif b.kind == "para":
            _runs(doc.add_paragraph(), b.text)
        elif b.kind == "quote":
            qp = doc.add_paragraph()
            qp.paragraph_format.left_indent = Inches(0.3)
            _runs(qp, b.text)
        elif b.kind in ("ul", "ol"):
            for x in b.items:
                _runs(doc.add_paragraph(style="List Bullet" if b.kind == "ul" else "List Number"), x)
        elif b.kind == "check":
            for d, x in b.items:
                _runs(doc.add_paragraph(("☒ " if d else "☐ ")), x)
        elif b.kind == "math":
            p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            r = p.add_run(b.text); r.italic = True; r.font.name = "Cambria Math"
        elif b.kind == "table" and b.rows:
            if b.caption:
                c = doc.add_paragraph(); c.add_run(b.caption).bold = True
            ncol = max(len(r) for r in b.rows)
            t = doc.add_table(rows=len(b.rows), cols=ncol); t.style = "Table Grid"
            for ri, row in enumerate(b.rows):
                for ci in range(ncol):
                    cell = t.cell(ri, ci); cell.text = ""
                    _runs(cell.paragraphs[0], row[ci] if ci < len(row) else "")
                    if ri == 0:
                        for run in cell.paragraphs[0].runs:
                            run.bold = True
        elif b.kind in ("mermaid", "image") and (
                (b.kind == "image" and b.text in assets.images)
                or (b.kind == "mermaid" and n_diag < len(assets.diagrams) and assets.diagrams[n_diag])):
            data = assets.images[b.text] if b.kind == "image" else assets.diagrams[n_diag]
            if b.kind == "mermaid":
                n_diag += 1
            p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            p.add_run().add_picture(io.BytesIO(data), width=Inches(6.0 if template == "plain" else 5.5))
            if b.caption:
                c = doc.add_paragraph(); c.alignment = WD_ALIGN_PARAGRAPH.CENTER
                c.add_run(b.caption).italic = True
        elif b.kind in ("mermaid", "image"):
            if b.kind == "mermaid":
                n_diag += 1
            p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            p.add_run(f"[{'Diagram' if b.kind == 'mermaid' else 'Figure'}: {b.caption or b.text[:60]} (insert the exported image here)]").italic = True
        elif b.kind == "code":
            r = doc.add_paragraph().add_run(b.text); r.font.name = "Consolas"; r.font.size = Pt(9)
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


PAPER_TEMPLATE = """# Abstract
One paragraph: the problem, your approach, the key result, why it matters.

# Introduction
Motivation and the gap you address. State your contributions:
- Contribution 1
- Contribution 2

# Related Work
Group prior work by theme and say how yours differs.

# Method
Describe the approach. Number the key equations:

$$\\mathcal{L}(\\theta) = \\frac{1}{N}\\sum_{i=1}^{N} \\ell\\big(f_\\theta(x_i), y_i\\big) + \\lambda \\lVert \\theta \\rVert_2^2$$

Figure: System architecture
```mermaid
flowchart LR
  A[Input data] --> B[Preprocessing]
  B --> C[Model]
  C --> D[Evaluation]
  D --> E[Results]
```

# Experimental Setup
Datasets, baselines, metrics, hardware and seeds.

Figure: Experiment workflow
```mermaid
flowchart TD
  S[Start] --> P[Prepare data]
  P --> T[Train with 3+ seeds]
  T --> V{Validation better?}
  V -- yes --> R[Report mean ± std]
  V -- no --> H[Tune hyperparameters] --> T
```

# Results
Table: Main results (replace with YOUR measured numbers: mean ± std over seeds)
| Method | Dataset A | Dataset B |
|---|---|---|
| Baseline | ... | ... |
| Ours | ... | ... |

# Discussion and Limitations
What worked, what didn't, threats to validity.

# Conclusion
Summary and future work.

# References
1. Author, A. Title of the paper. Venue, Year.
"""
