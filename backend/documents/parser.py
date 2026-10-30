"""Document parsing: PDF (PyMuPDF) or plain text -> pages, references, in-text citations, paragraphs.

All offsets are (page, start, end) into `pages[page]`, the exact text the UI renders,
so highlights line up with what the user sees.
"""
from __future__ import annotations

import bisect
import re
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path

from backend.common.schemas import ParsedRef

REF_HEADING = re.compile(
    r"^\s*(?:(?:\d{1,2}|[IVX]{1,5})(?:\.\d{1,2})?\.?\s+)?(references|bibliography|works cited|literature cited|reference list)\s*$",
    re.I | re.M,
)
STOP_AFTER_REFS = re.compile(r"^\s*(appendix|appendices|supplementary material|neurips paper checklist|[A-H](?:\.\d+)?\s{1,3}[A-Z][A-Za-z\- ]{2,60})\s*$", re.M)
CAPTION = re.compile(r"^\s*(figure|fig\.|table)\s+\d+[:.]", re.I)
DOI_RE = re.compile(r"10\.\d{4,9}/[^\s\"<>]+", re.I)
ARXIV_RE = re.compile(r"(?:arxiv[:.\s/]*|abs/)(\d{4}\.\d{4,5})", re.I)
YEAR_RE = re.compile(r"(?<!\d)(19[5-9]\d|20[0-4]\d)(?!\d)")
NUM_CITE = re.compile(r"\[(\d{1,3}(?:\s*[,–—-]\s*\d{1,3})*)\]")
AY_CITE = re.compile(r"\(([^()]*?\b(?:19|20)\d{2}[a-z]?[^()]*)\)")
NARR_CITE = re.compile(r"\b([A-Z][A-Za-zÀ-ſ'\-]+)(?:\s+et\s+al\.?|\s+(?:and|&)\s+[A-Z][A-Za-z'\-]+)?\s+\(((?:19|20)\d{2})[a-z]?\)")
AY_ITEM = re.compile(r"([A-Z][A-Za-zÀ-ſ'\-]+)(?:\s+et\s+al\.?|\s+(?:and|&)\s+[A-Z][A-Za-z'\-]+)?,?\s+((?:19|20)\d{2})")


@dataclass
class RefEntry:
    index: int          # 1-based position in the reference list
    label: str          # "[3]" / "3" / "Smith 2020"
    number: int | None  # explicit number if the style is numeric
    parsed: ParsedRef


@dataclass
class Citation:
    page: int
    start: int          # marker span
    end: int
    ref_indices: list[int]
    sentence: str
    s_start: int
    s_end: int


@dataclass
class Paragraph:
    page: int
    start: int
    end: int
    text: str


@dataclass
class ParsedDocument:
    pages: list[str]
    title: str | None
    doi: str | None
    references: list[RefEntry]
    citations: list[Citation]
    paragraphs: list[Paragraph]
    refs_at: tuple[int, int] | None   # (page, offset) where the reference section starts
    parser: str
    warnings: list[str] = field(default_factory=list)


# ---------- text utilities ----------

def fold(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


def norm(s: str) -> str:
    s = re.sub(r"\\[a-zA-Z]+", " ", s)      # LaTeX commands in some records, e.g. $\texttt{t5x}$
    s = fold(s).lower()
    s = re.sub(r"-\s*\n\s*", "", s)
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def one_line(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"(\w)-\n(\w)", r"\1\2", s)).strip()


# ---------- loading ----------

def load_pdf(path: Path) -> tuple[list[str], list[list[tuple[int, int]]], str | None]:
    import pymupdf

    doc = pymupdf.open(path)
    pages, blocks_per_page = [], []
    title = None
    for i, page in enumerate(doc):
        text, spans = "", []
        for b in page.get_text("blocks", sort=False):
            if b[6] != 0:      # image block
                continue
            t = b[4]
            if not t.strip():
                continue
            spans.append((len(text), len(text) + len(t)))
            text += t
        pages.append(text)
        blocks_per_page.append(spans)
        if i == 0:
            title = _pdf_title(page)
    return pages, blocks_per_page, title


def _pdf_title(page) -> str | None:
    best: list[tuple[float, str]] = []
    for b in page.get_text("dict").get("blocks", []):
        for line in b.get("lines", []):
            if abs(line.get("dir", (1, 0))[1]) > 0.1:   # rotated text (e.g. arXiv margin stamp)
                continue
            for s in line.get("spans", []):
                if s["text"].strip() and not s["text"].lstrip().lower().startswith("arxiv:"):
                    best.append((s["size"], s["text"].strip()))
    if not best:
        return None
    top = max(sz for sz, _ in best)
    parts = [t for sz, t in best if abs(sz - top) < 0.5]
    title = " ".join(parts).strip()
    return title if 10 <= len(title) <= 300 else None


def load_text(path: Path) -> tuple[list[str], list[list[tuple[int, int]]], str | None]:
    raw = path.read_text(encoding="utf-8", errors="replace")
    pages = raw.split("\f") if "\f" in raw else [raw]
    blocks = []
    for p in pages:
        spans = []
        for m in re.finditer(r"(?:[^\n]+\n?)+", p):
            spans.append((m.start(), m.end()))
        blocks.append(spans)
    title = None
    # PMC-style text exports put the title as the first long line after ARTICLE INFORMATION.
    m = re.search(r"(?:Subjects:[^\n]*\n\s*\n)([^\n]{15,300})\n", raw)
    if m:
        title = m.group(1).strip()
    return pages, blocks, title


# ---------- references ----------

def find_ref_heading(pages: list[str]) -> tuple[int, int] | None:
    found = None
    for i, p in enumerate(pages):
        for m in REF_HEADING.finditer(p):
            found = (i, m.end())   # keep the last occurrence
    return found


def find_numbered_tail(pages: list[str]) -> tuple[int, int] | None:
    """For exports without a heading (e.g. PMC .txt): a trailing run of lines '1 ...', '2 ...'."""
    for pi in range(len(pages) - 1, -1, -1):
        p = pages[pi]
        starts = [m for m in re.finditer(r"^(\d{1,3})[ .]\s*\S", p, re.M)]
        run: list[re.Match] = []
        for m in starts:
            n = int(m.group(1))
            if run and n == int(run[-1].group(1)) + 1:
                run.append(m)
            elif n == 1:
                run = [m]
        if len(run) >= 5:
            return (pi, run[0].start())
    return None


def repeated_lines(pages: list[str]) -> set[str]:
    """Running headers/footers: non-trivial lines present on at least half the pages."""
    if len(pages) < 4:
        return set()
    counts: dict[str, int] = {}
    for p in pages:
        for ln in {l.strip() for l in p.split("\n")}:
            if len(ln) > 12:
                counts[ln] = counts.get(ln, 0) + 1
    return {ln for ln, c in counts.items() if c >= len(pages) / 2}


def _clean_ref_region(text: str, drop: set[str] = frozenset()) -> str:
    lines, out, skipping = text.split("\n"), [], False
    for ln in lines:
        s = ln.strip()
        if re.fullmatch(r"\d{1,4}", s) or s in drop:          # page numbers, running headers
            continue
        if CAPTION.match(s):
            skipping = True
            continue
        if skipping:
            if re.match(r"^\[\d+\]|^\d{1,3}[ .]\s", s):
                skipping = False
            else:
                continue
        out.append(ln)
    return "\n".join(out)


def split_references(region: str, drop: set[str] = frozenset()) -> list[tuple[str, int | None]]:
    region = _clean_ref_region(region, drop)
    stop = STOP_AFTER_REFS.search(region)
    if stop and stop.start() > 200:
        region = region[:stop.start()]
    candidates: list[list[tuple[str, int | None]]] = []
    for pat in (r"^\s*\[(\d{1,3})\]\s*", r"^\s*\((\d{1,3})\)\s*", r"^\s*(\d{1,3})[.)]?\s+(?=\S)"):
        seq, expect = [], 1
        for m in re.finditer(pat, region, re.M):
            if int(m.group(1)) == expect:
                seq.append(m)
                expect += 1
        if len(seq) >= 3:
            candidates.append(_cut(region, seq))
    # author-year: a new entry starts on a line beginning "Surname, X." after a line ending in "."
    entries, cur = [], []
    for ln in region.split("\n"):
        if cur and re.match(r"^[A-Z][A-Za-z\u00C0-\u017F'\-]+,\s+(?:[A-Z]\.|[A-Z][a-z]+)", ln) \
                and cur[-1].rstrip().endswith("."):
            entries.append(("\n".join(cur), None))
            cur = []
        if ln.strip():
            cur.append(ln)
    if cur:
        entries.append(("\n".join(cur), None))
    candidates.append([e for e in entries if len(e[0]) > 25])
    return max(candidates, key=len)


def _cut(region: str, ms: list[re.Match]) -> list[tuple[str, int | None]]:
    out = []
    for i, m in enumerate(ms):
        end = ms[i + 1].start() if i + 1 < len(ms) else min(len(region), m.end() + 700)
        out.append((region[m.end():end].strip(), int(m.group(1))))
    return out


def extract_doi(entry: str) -> str | None:
    compact = re.sub(r"\s+", "", entry)
    for pat in (r"doi\.org/(10\.\d{4,9}/.+?)(?=URL|https?:|$)",
                r"doi:(10\.\d{4,9}/.+?)(?=URL|https?:|$)"):
        m = re.search(pat, compact, re.I)
        if m:
            return m.group(1).rstrip(".,;")
    m = DOI_RE.search(one_line(entry))
    return m.group(0).rstrip(".,;)") if m else None


def parse_entry(raw: str) -> ParsedRef:
    text = one_line(raw)
    doi = extract_doi(raw)
    arxiv = None
    m = ARXIV_RE.search(text) or (re.search(r"arxiv\.(\d{4}\.\d{4,5})", doi or "", re.I) if doi else None)
    if m:
        arxiv = m.group(1)
    no_ids = re.sub(r"(https?://\S+|doi:\s*\S+|10\.\d{4,9}/\S+)", " ", text, flags=re.I)
    years = YEAR_RE.findall(no_ids)
    year = int(years[-1]) if years else None

    title = None
    q = re.search(r"[“\"]([^”\"]{10,300})[”\"]", text)
    if q:
        title = q.group(1).strip(" ,.")
    elif (apa := re.match(r"^((?:(?:and\s+|&\s+)?(?:(?:van|von|de|der|den|da|di|le|la|del|te|ten|du|dos|das)\s)*[A-Z\u00C0-\u017F][\w'\u00B4\u00C0-\u017F\-]+(?:\s[A-Z\u00C0-\u017F][\w'\u00B4\u00C0-\u017F\-]+)?,\s(?:[A-Z\u00C0-\u017F][a-z]?\.\s?-?)+(?:,|;)?\s*)+)(?:et al\.\s*)?(?:\(\d{4}\)\.?\s*)?(.+)$", text)) and len(apa.group(2)) > 15:
        # APA / ICML style: "Surname, A., Surname, B., and Surname, C. Title. Venue, 2020."
        title = re.split(r"(?<=[a-z0-9\)])[.?!]\s", apa.group(2), maxsplit=1)[0].strip()
    else:
        # natbib/ACL style: "A. Author, B. Author, and C. Author. Title. Venue, 2020."
        m = re.search(r"(?<=[A-Za-zÀ-ſ]{2})\.\s+(?=[A-Z0-9])(.{10,300}?)(?:[.?!]\s|$)", text)
        if m and not re.match(r"^(In|Proceedings|arXiv|URL)\b", m.group(1)):
            title = m.group(1).strip()
        else:
            # Vancouver without punctuation: "Liu M. Zhang J. Title words ..."
            v = re.match(r"^(?:[A-Z][\w'\-]+(?:\s[A-Z][\w'\-]+)*\s(?:[A-Z]\.\s?){1,3}\s*)+(.*)$", text)
            if v and v.group(1):
                title = " ".join(v.group(1).split()[:18])
    return ParsedRef(raw=text, doi=doi, arxiv_id=arxiv, title=title, year=year,
                     first_author=first_author(text))


def first_author(text: str) -> str | None:
    seg = re.split(r",|\band\b", text, maxsplit=1)[0].strip()
    words = [w.strip(".") for w in seg.split() if w.strip(".")]
    if not words:
        return None
    if len(words) == 1:
        return words[0]
    if re.fullmatch(r"[A-Z]{1,3}", words[1]):          # "Liu M" / "Smith JA"
        return words[0]
    cand = words[-1] if len(words) <= 4 else words[0]
    return cand if re.match(r"^[A-ZÀ-ſ]", cand) else None


# ---------- citations & sentences ----------

_ABBR = r"(?<!\bal)(?<!\bFig)(?<!\bEq)(?<!\be\.g)(?<!\bi\.e)(?<!\bvs)(?<!\bet)"
SENT_END = re.compile(_ABBR + r"[.!?](?=\s+[A-Z\[(])")


def sentence_bounds(text: str) -> list[int]:
    return [0] + [m.end() for m in SENT_END.finditer(text)] + [len(text)]


def _expand(nums: str) -> list[int]:
    out: list[int] = []
    for part in re.split(r"\s*,\s*", nums):
        r = re.split(r"\s*[–—-]\s*", part)
        if len(r) == 2 and r[0].isdigit() and r[1].isdigit() and int(r[1]) - int(r[0]) < 30:
            out.extend(range(int(r[0]), int(r[1]) + 1))
        elif part.strip().isdigit():
            out.append(int(part))
    return out


def find_citations(pages: list[str], refs: list[RefEntry], refs_at: tuple[int, int] | None) -> list[Citation]:
    by_number = {r.number: r.index for r in refs if r.number is not None}
    by_author_year: dict[tuple[str, int], int] = {}
    for r in refs:
        if r.parsed.first_author and r.parsed.year:
            by_author_year.setdefault((norm(r.parsed.first_author), r.parsed.year), r.index)
    cites: list[Citation] = []
    for pi, text in enumerate(pages):
        limit = len(text)
        if refs_at and pi > refs_at[0]:
            break
        if refs_at and pi == refs_at[0]:
            limit = refs_at[1]
        bounds = sentence_bounds(text)
        hits: list[tuple[int, int, list[int]]] = []
        if by_number:
            for m in NUM_CITE.finditer(text, 0, limit):
                idx = [by_number[n] for n in _expand(m.group(1)) if n in by_number]
                if idx:
                    hits.append((m.start(), m.end(), idx))
        if by_author_year:
            for m in AY_CITE.finditer(text, 0, limit):
                idx = []
                for a in AY_ITEM.finditer(m.group(1)):
                    k = (norm(a.group(1)), int(a.group(2)))
                    if k in by_author_year:
                        idx.append(by_author_year[k])
                if idx:
                    hits.append((m.start(), m.end(), idx))
            for m in NARR_CITE.finditer(text, 0, limit):
                k = (norm(m.group(1)), int(m.group(2)))
                if k in by_author_year:
                    hits.append((m.start(), m.end(), [by_author_year[k]]))
        for s, e, idx in hits:
            j = bisect.bisect_right(bounds, s) - 1
            ss, se = bounds[j], bounds[min(j + 1, len(bounds) - 1)]
            while ss < se and text[ss].isspace():
                ss += 1
            sentence = one_line(text[ss:se])
            if len(sentence) < 20:
                continue
            cites.append(Citation(pi, s, e, idx, sentence, ss, se))
    return cites


# ---------- main entry ----------

def parse_document(path: Path) -> ParsedDocument:
    is_pdf = path.suffix.lower() == ".pdf"
    pages, blocks, title = load_pdf(path) if is_pdf else load_text(path)
    warnings: list[str] = []
    full_first = pages[0] if pages else ""
    doi = None
    m = re.search(r"\bDOI:?\s*(10\.\d{4,9}/[^\s]+)", full_first[:6000], re.I) or \
        re.search(r"doi\.org/(10\.\d{4,9}/[^\s]+)", full_first[:6000], re.I)
    if m:
        doi = m.group(1).rstrip(".,;")

    refs_at = find_ref_heading(pages) or find_numbered_tail(pages)
    refs: list[RefEntry] = []
    if refs_at is None:
        warnings.append("No reference section found.")
    else:
        pi, off = refs_at
        region = pages[pi][off:] + "".join("\n" + p for p in pages[pi + 1:])
        for i, (raw, num) in enumerate(split_references(region, repeated_lines(pages)), start=1):
            parsed = parse_entry(raw)
            label = f"[{num}]" if num is not None else (
                f"{parsed.first_author or '?'} {parsed.year or ''}".strip())
            refs.append(RefEntry(index=i, label=label, number=num, parsed=parsed))
        if not refs:
            warnings.append("Reference section found but no entries could be split.")

    citations = find_citations(pages, refs, refs_at)
    paragraphs: list[Paragraph] = []
    for pi, spans in enumerate(blocks):
        cur: list[tuple[int, int]] = []
        for s, e in spans + [(-1, -1)]:
            in_refs = refs_at and (pi > refs_at[0] or (pi == refs_at[0] and s >= refs_at[1]))
            if s >= 0 and not in_refs:
                cur.append((s, e))
            text = one_line(pages[pi][cur[0][0]:cur[-1][1]]) if cur else ""
            if cur and (s < 0 or in_refs or (len(text.split()) >= 40 and text.endswith((".", "?", "!")))):
                if len(text.split()) >= 40:
                    paragraphs.append(Paragraph(pi, cur[0][0], cur[-1][1], text))
                cur = []
    return ParsedDocument(pages=pages, title=title, doi=doi, references=refs, citations=citations,
                          paragraphs=paragraphs, refs_at=refs_at,
                          parser="pymupdf" if is_pdf else "plaintext", warnings=warnings)
