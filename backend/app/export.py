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


_IMG = re.compile(r"!\[[^\]]*\]\([^)\s]+\)")


def _split_images(md: str) -> str:
    """Put every Markdown image on its own line (outside code fences). Writers often run the next sentence straight
    after the image on the same line, and that text must not be lost."""
    out, fence = [], False
    for ln in md.split("\n"):
        if ln.strip().startswith("```"):
            fence = not fence
        if fence or "![" not in ln or not _IMG.search(ln):
            out.append(ln)
            continue
        pos = 0
        for m in _IMG.finditer(ln):
            before = ln[pos:m.start()].strip()
            if before:
                out += [before, ""]
            out += [m.group(0), ""]
            pos = m.end()
        if ln[pos:].strip():
            out.append(ln[pos:].strip())
    return "\n".join(out)


def parse_md(md: str) -> list[Block]:
    lines = _split_images(md.replace("\r\n", "\n")).split("\n")
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
            "^": r"\textasciicircum{}", "\\": r"\textbackslash{}", "$": r"\$"}

# Characters pdfLaTeX (Overleaf's default engine) can't take as raw UTF-8: (text-mode form, math-mode form).
_GREEK = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega".split()
_UNI: dict[str, tuple[str, str]] = {
    "–": ("--", "-"), "—": ("---", "-"), "‐": ("-", "-"), "‑": ("-", "-"), "‒": ("--", "-"), "−": ("$-$", "-"),
    "‘": ("`", "'"), "’": ("'", "'"), "‚": (",", ","), "“": ("``", "''"), "”": ("''", "''"), "„": (",,", ",,"),
    "…": (r"\ldots{}", r"\ldots"), "•": (r"\textbullet{}", r"\bullet"), "·": (r"$\cdot$", r"\cdot"),
    "×": (r"$\times$", r"\times"), "÷": (r"$\div$", r"\div"), "±": (r"$\pm$", r"\pm"), "∓": (r"$\mp$", r"\mp"),
    "≤": (r"$\leq$", r"\leq"), "≥": (r"$\geq$", r"\geq"), "≠": (r"$\neq$", r"\neq"), "≈": (r"$\approx$", r"\approx"),
    "∼": (r"$\sim$", r"\sim"), "≃": (r"$\simeq$", r"\simeq"), "≡": (r"$\equiv$", r"\equiv"), "∝": (r"$\propto$", r"\propto"),
    "→": (r"$\rightarrow$", r"\rightarrow"), "←": (r"$\leftarrow$", r"\leftarrow"), "↔": (r"$\leftrightarrow$", r"\leftrightarrow"),
    "⇒": (r"$\Rightarrow$", r"\Rightarrow"), "⇔": (r"$\Leftrightarrow$", r"\Leftrightarrow"), "↑": (r"$\uparrow$", r"\uparrow"),
    "↓": (r"$\downarrow$", r"\downarrow"), "∞": (r"$\infty$", r"\infty"), "∑": (r"$\sum$", r"\sum"), "∏": (r"$\prod$", r"\prod"),
    "∫": (r"$\int$", r"\int"), "√": (r"$\surd$", r"\surd"), "∂": (r"$\partial$", r"\partial"), "∇": (r"$\nabla$", r"\nabla"),
    "∈": (r"$\in$", r"\in"), "∉": (r"$\notin$", r"\notin"), "⊂": (r"$\subset$", r"\subset"), "⊆": (r"$\subseteq$", r"\subseteq"),
    "∪": (r"$\cup$", r"\cup"), "∩": (r"$\cap$", r"\cap"), "∅": (r"$\emptyset$", r"\emptyset"), "∀": (r"$\forall$", r"\forall"),
    "∃": (r"$\exists$", r"\exists"), "¬": (r"$\neg$", r"\neg"), "∧": (r"$\wedge$", r"\wedge"), "∨": (r"$\vee$", r"\vee"),
    "⊕": (r"$\oplus$", r"\oplus"), "⊗": (r"$\otimes$", r"\otimes"), "∘": (r"$\circ$", r"\circ"), "⟨": (r"$\langle$", r"\langle"),
    "⟩": (r"$\rangle$", r"\rangle"), "′": (r"$'$", "'"), "″": (r"$''$", "''"), "°": (r"\textdegree{}", r"^\circ"),
    "²": (r"\textsuperscript{2}", "^2"), "³": (r"\textsuperscript{3}", "^3"), "¹": (r"\textsuperscript{1}", "^1"),
    "₀": (r"\textsubscript{0}", "_0"), "₁": (r"\textsubscript{1}", "_1"), "₂": (r"\textsubscript{2}", "_2"),
    "§": (r"\S{}", r"\S"), "¶": (r"\P{}", r"\P"), "©": (r"\textcopyright{}", r"\copyright"), "®": (r"\textregistered{}", "(R)"),
    "™": (r"\texttrademark{}", "TM"), "€": (r"\texteuro{}", "EUR"), "£": (r"\pounds{}", r"\pounds"), "₹": ("Rs.", "Rs."),
    "✓": (r"$\checkmark$", r"\checkmark"), "✔": (r"$\checkmark$", r"\checkmark"), "✗": (r"$\times$", r"\times"),
    "✘": (r"$\times$", r"\times"), "★": (r"$\star$", r"\star"), "\u00a0": ("~", "~"), "\u2009": (r"\,", r"\,"),
    "\u202f": (r"\,", r"\,"), "\u200b": ("", ""), "\ufeff": ("", ""), "µ": (r"$\mu$", r"\mu"),
    "ϵ": (r"$\epsilon$", r"\epsilon"), "ϑ": (r"$\vartheta$", r"\vartheta"), "ϕ": (r"$\phi$", r"\phi"), "ℓ": (r"$\ell$", r"\ell"),
    "ℝ": (r"$\mathbb{R}$", r"\mathbb{R}"), "ℕ": (r"$\mathbb{N}$", r"\mathbb{N}"), "ℤ": (r"$\mathbb{Z}$", r"\mathbb{Z}"),
    "ℙ": (r"$\mathbb{P}$", r"\mathbb{P}"), "𝔼": (r"$\mathbb{E}$", r"\mathbb{E}"), "ı": (r"\i{}", r"\imath"),
}
for _i, _n in enumerate(_GREEK):
    for _c, _name in ((chr(0x3B1 + _i + (1 if _i >= 17 else 0)), _n), (chr(0x391 + _i + (1 if _i >= 17 else 0)), _n.capitalize())):
        if _name in ("Alpha", "Beta", "Epsilon", "Zeta", "Eta", "Iota", "Kappa", "Mu", "Nu", "Omicron", "Rho", "Tau", "Chi", "omicron"):
            _UNI.setdefault(_c, ({"Omicron": "O", "omicron": "o"}.get(_name, _name[0]),) * 2)   # no LaTeX command: the Latin look-alike
        else:
            _UNI.setdefault(_c, (f"$\\{_name}$", f"\\{_name}"))
_UNI.setdefault("ς", (r"$\varsigma$", r"\varsigma"))
_CYR = dict(zip("абвгдеёжзийклмнопрстуфхцчшщъыьэюя", "a b v g d e e zh z i y k l m n o p r s t u f kh ts ch sh shch  y  e yu ya".split(" ")))

# Latin-1 / Latin Extended-A letters that T1 + utf8 inputenc typeset natively.
_PDFLATEX_LETTERS = set("ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿĀāĂăĄąĆćĈĉĊċČčĎďĐđĒēĔĕĖėĘęĚěĜĝĞğĠġĢģĤĥĨĩĪīĬĭĮįİĲĳĴĵĶķĹĺĻļĽľŁłŃńŅņŇňŊŋŌōŎŏŐőŒœŔŕŖŗŘřŚśŜŝŞşŠšŢţŤťŨũŪūŬŭŮůŰűŲųŴŵŶŷŸŹźŻżŽž¡¿«»")


def _uni(c: str, math: bool = False) -> str:
    """One non-ASCII character as something pdfLaTeX can typeset."""
    if c in _UNI:
        return _UNI[c][1 if math else 0]
    if not math and c in _PDFLATEX_LETTERS:
        return c
    low = c.lower()
    if low in _CYR:
        t = _CYR[low]
        return t.capitalize() if c != low else t
    import unicodedata
    base = unicodedata.normalize("NFKD", c).encode("ascii", "ignore").decode()   # ș -> s, ț -> t, ﬁ -> fi
    if base:
        return base if math else "".join(_TEX_ESC.get(x, x) for x in base)
    return "" if math else "?"


def tex_math(s: str) -> str:
    return "".join(ch if ord(ch) < 128 else _uni(ch, math=True) for ch in s)


_GREEK_SUB = re.compile("([\u0391-\u03c9])_([A-Za-z0-9]{1,12})")


def _esc_text(s: str) -> str:
    return "".join(_TEX_ESC.get(ch) or (ch if ord(ch) < 128 else _uni(ch)) for ch in s)


def _tex_text(s: str) -> str:
    """Plain text -> LaTeX. 'β_int' written as plain text is a subscripted symbol, so it is typeset as one."""
    out, pos = [], 0
    for m in _GREEK_SUB.finditer(s):
        out += [_esc_text(s[pos:m.start()]), f"${_uni(m.group(1), math=True)}_{{\\mathrm{{{m.group(2)}}}}}$"]
        pos = m.end()
    return "".join(out) + _esc_text(s[pos:])


_CITE = re.compile(r"\[(\d{1,3}(?:\s*(?:,|--|-|–)\s*\d{1,3})*)\](?!\()")


def _cite(m: re.Match, n_refs: int) -> str:
    """[3], [3, 5] or [2-4] -> \\cite{r3}, ... when every number is a real reference; anything else is left as text."""
    keys: list[int] = []
    for part in re.split(r"\s*,\s*", m.group(1)):
        ends = [int(x) for x in re.split(r"\s*(?:--|-|–)\s*", part)]
        lo, hi = ends[0], ends[-1]
        keys += list(range(lo, hi + 1)) if 0 < lo <= hi and hi - lo < 30 else ends
    if not keys or not all(1 <= k <= n_refs for k in keys):
        return m.group(0)
    return "\\cite{" + ",".join(f"r{k}" for k in keys) + "}"


def tex_inline(s: str, n_refs: int = 0) -> str:
    parts = re.split(r"(\$[^$]+\$|`[^`]+`)", s)       # keep math and code spans intact
    out = []
    for p in parts:
        if p.startswith("$") and p.endswith("$") and len(p) > 1:
            out.append(tex_math(p))
        elif p.startswith("`") and p.endswith("`") and len(p) > 1:
            out.append(r"\texttt{" + _tex_text(p[1:-1]) + "}")
        else:
            t = _tex_text(p)
            t = re.sub(r"\*\*(.+?)\*\*", r"\\textbf{\1}", t)
            t = re.sub(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?!\w)", r"\\emph{\1}", t)
            t = re.sub(r"\[(.+?)\]\((https?://[^)]+)\)", lambda m: m.group(1) + "\\footnote{\\url{" + m.group(2).replace("\\_", "_").replace("\\%", "\\%").replace("\\#", "\\#") + "}}", t)
            t = re.sub(r"(?<![{/\w])(https?://[^\s}]+[^\s}.,;:)])", lambda m: "\\url{" + m.group(1).replace("\\_", "_") + "}", t)
            t = re.sub(r"\b[Dd][Oo][Ii]:\s*(10\.\d{4,9}/[^\s]+[^\s.,;])", lambda m: "doi: \\url{" + m.group(1).replace("\\_", "_") + "}", t)
            t = re.sub(r"\+\+(.+?)\+\+", r"\\underline{\1}", t)
            t = re.sub(r"==(.+?)==", r"\\colorbox{yellow}{\1}", t)
            t = re.sub(r"(?:\\textasciitilde\{\}){2}(.+?)(?:\\textasciitilde\{\}){2}", r"\1", t)
            t = re.sub(r"\\textasciicircum\{\}(\S+?)\\textasciicircum\{\}", r"\\textsuperscript{\1}", t)
            if n_refs:
                t = _CITE.sub(lambda m: _cite(m, n_refs), t)
            out.append(t)
    return "".join(out)


_COMMON = r"""\usepackage[T1]{fontenc}
\usepackage[utf8]{inputenc}
\usepackage{textcomp,amsmath,amssymb,graphicx,array,booktabs,tabularx,xcolor}
\usepackage{xurl}
"""
_TAIL = r"""\usepackage{hyperref}
\hypersetup{colorlinks=true,linkcolor=blue,citecolor=blue,urlcolor=blue}
\setlength{\emergencystretch}{3em}
\renewcommand{\arraystretch}{1.15}
"""
_THEOREMS = r"""\newtheorem{theorem}{Theorem}
\newtheorem{lemma}{Lemma}
\newtheorem{proposition}{Proposition}
\newtheorem{assumption}{Assumption}
"""

PREAMBLES = {
    "ieee": r"\documentclass[journal]{IEEEtran}" + "\n" + _COMMON + "\\usepackage{amsthm}\n\\usepackage{cite}\n" + _TAIL + _THEOREMS + r"""\begin{document}
\title{%(title)s}
\author{%(author)s\\{}\textit{%(affil)s}}
\maketitle
""",
    "springer": r"\documentclass[runningheads]{llncs}" + "\n" + _COMMON + _TAIL + r"""\begin{document}
\title{%(title)s}
\author{%(author)s}
\institute{%(affil)s}
\maketitle
""",
    "plain": r"\documentclass[11pt]{article}" + "\n" + _COMMON + "\\usepackage{amsthm,geometry}\n\\usepackage{cite}\n\\geometry{margin=1in}\n" + _TAIL + _THEOREMS + r"""\begin{document}
\title{%(title)s}
\author{%(author)s \\ %(affil)s}
\date{}
\maketitle
""",
}

# Roughly how many characters of table text fit across one line (footnotesize for IEEE, small otherwise).
_CAP = {("ieee", False): 58, ("ieee", True): 122, ("springer", False): 70, ("plain", False): 86}
_NUMERIC = re.compile(r"^[\s$\\]*[-+−–<>≤≥~≈]?\s*[\d.,]+[\d.,%\s±()\[\]×eE\-+−–/:*]*$")


def _plain_len(cell: str) -> int:
    return len(re.sub(r"\*\*|`|\$|\\[a-z]+|[{}]", "", cell))


def _longest_word(rows: list[list[str]], c: int) -> int:
    return max((sum(1.35 if ch.isupper() else 1.0 for ch in w) for r in rows for w in re.sub(r"\*\*|`|\$", "", r[c]).split()),
               default=4)   # capitals are wider than an average letter


def _table(rows: list[list[str]], caption: str, template: str, n: int, n_refs: int) -> str:
    ncol = max(len(r) for r in rows)
    rows = [r + [""] * (ncol - len(r)) for r in rows]
    body = rows[1:] or rows
    lens = [[_plain_len(r[c]) for r in rows] for c in range(ncol)]
    longest = [max(col) for col in lens]
    numeric = [all(_NUMERIC.match(r[c].strip()) or not r[c].strip() for r in body) and any(r[c].strip() for r in body) for c in range(ncol)]
    need = sum(min(x, 60) for x in longest) + 2 * ncol
    wide = template == "ieee" and (ncol >= 5 or need > _CAP[("ieee", False)] * 1.6)
    cap = _CAP.get((template, wide), _CAP[(template, False)])
    if need <= cap * 0.9:      # fits as is: natural column widths, numbers right-aligned
        spec = "".join("r" if numeric[c] else "l" for c in range(ncol))
        open_t, close_t = f"\\begin{{tabular}}{{{spec}}}", "\\end{tabular}"
    else:                      # wrap the text columns, share the width by how much text each one holds
        fixed = [numeric[c] or longest[c] <= 12 for c in range(ncol)]
        if all(fixed):          # every column is short or numeric: let them all wrap, numbers still flush right
            fixed = [False] * ncol
        weights = {c: max(4.0, sum(lens[c]) / len(lens[c])) ** 0.7 for c in range(ncol) if not fixed[c]}
        tot = sum(weights.values())
        avail = max(10.0, cap - sum(longest[c] + 2 for c in range(ncol) if fixed[c]) - 2 * len(weights))
        # each wrapped column gets its share, but never less than its longest word (a word can't wrap)
        width = {c: max(weights[c] / tot * avail, _longest_word(rows, c) + 1.5) for c in weights}
        mean_w = sum(width.values()) / len(width)
        spec = "".join(("r" if numeric[c] else "l") if fixed[c] else
                       f">{{\\{'raggedleft' if numeric[c] else 'raggedright'}\\arraybackslash\\hspace{{0pt}}\\hsize={width[c] / mean_w:.2f}\\hsize}}X"
                       for c in range(ncol))
        open_t, close_t = f"\\begin{{tabularx}}{{\\linewidth}}{{{spec}}}", "\\end{tabularx}"
    nl = " \\tabularnewline\n"                     # never "\\": a next row starting with "[12]" would be read as \\[12]
    head = " & ".join(f"\\textbf{{{tex_inline(c, n_refs)}}}" for c in rows[0]) + nl + "\\midrule\n"
    lines = "".join(" & ".join(tex_inline(c, n_refs) for c in r) + nl for r in rows[1:])
    float_env = "table*" if wide else "table"
    size = "\\footnotesize" if template == "ieee" else "\\small"
    return (f"\\begin{{{float_env}}}[!t]\n\\centering\n{size}\n" + (f"\\caption{{{tex_inline(caption, n_refs)}}}\n" if caption else "")
            + f"\\label{{tab:{n}}}\n{open_t}\n\\toprule\n{head}{lines}\\bottomrule\n{close_t}\n\\end{{{float_env}}}\n")


def _visual_len(tex: str) -> int:
    """About how many glyphs a formula prints (a command is one glyph; braces, scripts and spacing are free)."""
    t = re.sub(r"\\(left|right|big|Big|bigg|Bigg)\b", "", tex)
    t = re.sub(r"\\(mathrm|mathbf|mathit|text|operatorname|mathcal|mathbb|boldsymbol)\b", "", t)
    t = re.sub(r"\\[a-zA-Z]+", "x", t)
    return len(re.sub(r"[{}^_\s&]|\\[,;:! ]", "", t))


def _break_long(body: str, width: int) -> str | None:
    """Split a one-line formula at top-level =, + and - into an aligned block, each line within `width` glyphs."""
    cuts, depth, lr, i = [], 0, 0, 0
    while i < len(body):
        c = body[i]
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
        elif body.startswith("\\left", i):
            lr += 1
        elif body.startswith("\\right", i):
            lr -= 1
        elif depth == 0 and lr == 0 and c in "=+-" and i > 0 and body[i - 1] not in "^_{(\\" and body[i - 1:i + 1] != "--":
            cuts.append(i)
        i += 1
    if not cuts:
        return None
    eq = next((k for k in cuts if body[k] == "="), None)
    head = ""
    if eq is not None:                       # "lhs =" stays on the first line, aligned on the =
        head, cuts = body[:eq].strip() + " &", [k for k in cuts if k > eq]
        atoms_from = eq
    else:
        atoms_from = 0
    bounds = [atoms_from] + cuts + [len(body)]
    atoms = [body[bounds[j]:bounds[j + 1]].strip() for j in range(len(bounds) - 1) if body[bounds[j]:bounds[j + 1]].strip()]
    budget = width * 0.9
    lines, cur = [], ""
    for atom in atoms:
        if cur and _visual_len(cur + atom) + (_visual_len(head) if not lines else 4) > budget:
            lines.append(cur)
            cur = ""
        cur = f"{cur} {atom}".strip()
    lines.append(cur)
    if len(lines) < 2:
        return None
    out = [f"{head}{lines[0]}" if head else f"&{lines[0]}"] + [f"&\\quad {ln}" for ln in lines[1:]]
    return "\\begin{aligned}\n" + " \\\\\n".join(out) + "\n\\end{aligned}"


def _equation(body: str, width: int = 0) -> str:
    body = tex_math(body.strip())
    if re.match(r"\\begin\{(equation|align|gather|multline|eqnarray)\*?\}", body):
        return body + "\n"                          # already a complete display environment
    if "\\\\" in body and "\\begin{" not in body:   # several lines: align on & if given, else centre each line
        inner = "aligned" if "&" in body else "gathered"
        body = f"\\begin{{{inner}}}\n{body}\n\\end{{{inner}}}"
    elif width and "\\begin{" not in body and "&" not in body and _visual_len(body) > width:
        body = _break_long(body, width) or body     # too wide for the column: break it at top-level = + -
    return "\\begin{equation}\n" + body + "\n\\end{equation}\n"


def _ref_text(s: str) -> str:
    return re.sub(r"^\s*(\[\d+\]|\d+[.)])\s*", "", s)


def _aspect(png: bytes) -> float:
    """Width / height of a PNG from its header (1.0 if it isn't one)."""
    if png[:8] != b"\x89PNG\r\n\x1a\n" or len(png) < 24:
        return 1.0
    w, h = int.from_bytes(png[16:20], "big"), int.from_bytes(png[20:24], "big")
    return w / h if h else 1.0


def to_latex(md: str, title: str, template: Template = "ieee", author: str = "Author Name", affil: str = "Affiliation",
             assets: Assets | None = None) -> str:
    blocks = parse_md(md)
    assets = assets or Assets()
    # number of references, so [n] in the text can become \cite{rn}
    n_refs, in_r = 0, False
    for b in blocks:
        if b.kind == "heading":
            in_r = b.text.strip().lower() in ("references", "bibliography")
        elif in_r:
            n_refs += len(b.items) if b.kind in ("ol", "ul") else (1 if b.kind == "para" else 0)
    T = lambda s: tex_inline(s, n_refs)  # noqa: E731
    fig_w = "\\linewidth" if template == "ieee" else "0.8\\linewidth"   # charts are drawn at about one journal column
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
                        kw_line = T(km.group(1).strip())
                    else:
                        body.append(T(raw_p))
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
                heading = re.sub(r"^(?:[IVX]+|\d+(?:\.\d+)*)[.)]?\s+(?=[A-Za-z])", "", b.text.strip())   # the class numbers sections
                out.append(f"\\{cmd}{{{T(heading)}}}\n")
        elif in_refs and b.kind in ("ol", "ul", "para"):
            refs += [_ref_text(x) for x in (b.items if b.kind != "para" else [b.text])]
        elif b.kind == "para":
            out.append(T(b.text) + "\n")
        elif b.kind == "quote":
            q_body = "\\\\{}\n".join(T(ln) for ln in b.text.splitlines() if ln.strip())
            if re.search(r"algorithm\s+\d", b.text, re.I):
                out.append("\\par\\smallskip\\noindent\\fbox{\\parbox{0.96\\linewidth}{\\small\n" + q_body + "\n}}\\smallskip\\par\n")
            else:
                out.append("\\begin{quote}\n" + q_body + "\n\\end{quote}\n")
        elif b.kind in ("ul", "ol"):
            env = "itemize" if b.kind == "ul" else "enumerate"
            out.append(f"\\begin{{{env}}}\n" + "".join(f"  \\item {T(x)}\n" for x in b.items) + f"\\end{{{env}}}\n")
        elif b.kind == "check":
            box_done, box_open = r"$\boxtimes$", r"$\square$"
            items = "".join("  \\item[" + (box_done if d else box_open) + "] " + T(x) + "\n" for d, x in b.items)
            out.append("\\begin{itemize}\n" + items + "\\end{itemize}\n")
        elif b.kind == "math":
            out.append(_equation(b.text, {"ieee": 44, "springer": 62}.get(template, 80)))
        elif b.kind == "table" and b.rows:
            tab += 1
            out.append(_table(b.rows, b.caption, template, tab, n_refs))
        elif b.kind == "image":
            fig += 1
            path = b.text
            env_f, width = "figure", fig_w
            if b.text in assets.images:
                path = f"figures/fig{fig}.png"
                assets.files[path] = assets.images[b.text]
                if template == "ieee" and _aspect(assets.images[b.text]) > 2.2:   # multi-panel: span both columns
                    env_f, width = "figure*", "0.92\\textwidth"
            out.append(f"\\begin{{{env_f}}}[!t]\n\\centering\n\\includegraphics[width={width}]{{{path}}}\n"
                       + (f"\\caption{{{T(b.caption)}}}\n" if b.caption else "") + f"\\label{{fig:{fig}}}\n\\end{{{env_f}}}\n")
        elif b.kind == "mermaid" and n_diag < len(assets.diagrams) and assets.diagrams[n_diag]:
            fig += 1
            path = f"figures/fig{fig}.png"
            assets.files[path] = assets.diagrams[n_diag]  # type: ignore[assignment]
            n_diag += 1
            out.append(f"\\begin{{figure}}[!t]\n\\centering\n\\includegraphics[width={fig_w}]{{{path}}}\n"
                       + (f"\\caption{{{T(b.caption)}}}\n" if b.caption else "") + f"\\label{{fig:{fig}}}\n\\end{{figure}}\n")
        elif b.kind == "mermaid":
            fig += 1
            n_diag += 1
            src = "\n".join("% " + tex_math(x) for x in b.text.splitlines())
            out.append("\\begin{figure}[!t]\n\\centering\n\\fbox{\\parbox{0.9\\linewidth}{\\centering Diagram: export the Mermaid source below to PDF "
                       "(e.g. mermaid.live or mermaid-cli) and replace this box with \\texttt{\\textbackslash includegraphics}.}}\n"
                       + (f"\\caption{{{T(b.caption)}}}\n" if b.caption else "\\caption{Diagram}\n") + f"\\label{{fig:{fig}}}\n{src}\n\\end{{figure}}\n")
        elif b.kind == "code":
            out.append("\\begin{verbatim}\n" + tex_math(b.text) + "\n\\end{verbatim}\n")
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
