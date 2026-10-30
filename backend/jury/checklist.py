"""Checklist reviewer: deterministic, transparent submission-readiness checks (no LLM).

Each check looks for concrete evidence in the parsed paper. The score is 1 + 9 × (passed / total).
It never judges content quality; that is the LLM personas' job, and a Submit verdict requires at
least one of them.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date

from backend.common.schemas import AuditReport, PersonaReview
from backend.documents.parser import ParsedDocument

NAME = "Checklist (rule-based)"


@dataclass
class Check:
    name: str
    passed: bool
    detail: str
    fix: str


def _has(text: str, pattern: str) -> re.Match | None:
    return re.search(pattern, text, re.I | re.M)


def run_checks(doc: ParsedDocument, audit: AuditReport | None) -> list[Check]:
    text = "\n".join(doc.pages)
    body = text if not doc.refs_at else "\n".join(doc.pages[: doc.refs_at[0]] + [doc.pages[doc.refs_at[0]][: doc.refs_at[1]]])
    checks: list[Check] = []

    m = _has(body[:8000], r"^\s*abstract\b")
    checks.append(Check("Abstract present", bool(m), "found an Abstract heading" if m else "no Abstract heading in the first pages",
                        "Add a structured abstract (problem, method, result, implication)."))

    m = _has(body, r"^\s*(\d+(\.\d+)*\.?\s*)?(limitations?|threats to validity)\b")
    checks.append(Check("Limitations discussed", bool(m), "found a Limitations / Threats to validity section" if m else "no Limitations section found",
                        "Add a Limitations section: scope, failure cases, and threats to validity."))

    m = _has(text, r"(github\.com|gitlab\.com|zenodo|huggingface\.co|code (is|will be) (publicly )?available|data availability|available (at|from) https?://)")
    checks.append(Check("Code / data availability", bool(m), f"found “{m.group(0)}”" if m else "no code or data availability statement",
                        "State where code and data are available (repository URL, licence) or why they cannot be shared."))

    m = _has(text, r"(conflicts? of interest|competing interests?|ethics statement|ethical considerations|broader impact|institutional review board|\bIRB\b)")
    checks.append(Check("Ethics / conflicts statement", bool(m), f"found “{m.group(0)}”" if m else "no ethics, broader-impact or conflict-of-interest statement",
                        "Add an ethics / broader-impact statement and a conflict-of-interest declaration."))

    m = _has(body, r"(standard deviation|std\.?\b|±|\+/-|confidence interval|\bp\s*[<=]\s*0?\.\d|p-value|statistically significant|error bars?)")
    checks.append(Check("Statistical reporting", bool(m), f"found “{m.group(0)}”" if m else "no variance, confidence intervals or significance tests reported",
                        "Report variance over multiple seeds (mean ± std or CIs) and test key differences for significance."))

    m = _has(body, r"(random seed|seeds?\b|learning rate|batch size|hyperparameters?|epochs?|implementation details)")
    checks.append(Check("Reproducibility details", bool(m), f"found “{m.group(0)}”" if m else "no seeds, hyperparameters or implementation details found",
                        "List hyperparameters, seeds, hardware and training budget in an Implementation Details section."))

    figs = len(set(re.findall(r"\b(?:Figure|Fig\.)\s*(\d+)", body)))
    tabs = len(set(re.findall(r"\bTable\s*(\d+)", body)))
    checks.append(Check("Figures / tables referenced", figs + tabs >= 2, f"{figs} figure(s), {tabs} table(s) referenced in the text",
                        "Support the main claims with at least one results table or figure, referenced from the text."))

    n = len(doc.references)
    checks.append(Check("Reference depth", n >= 20, f"{n} references parsed", "Broaden related work: most venues expect 20+ references."))

    years = [r.parsed.year for r in doc.references if r.parsed.year]
    if years:
        # Anchor on the paper's own era (its newest citation), so older papers aren't penalised for their age.
        anchor = min(max(years), date.today().year)
        recent = sum(1 for y in years if y >= anchor - 5) / len(years)
        checks.append(Check("Recent literature", recent >= 0.3,
                            f"{recent:.0%} of dated references are within 5 years of the newest one ({anchor})",
                            "Cite recent work (last 5 years) so reviewers see the current state of the art."))

    if audit:
        nf, rc = audit.summary.get("not_found", 0), audit.summary.get("retracted_cited", 0)
        checks.append(Check("Citations resolvable & not retracted", nf == 0 and rc == 0,
                            f"{nf} not found, {rc} retracted (CiteGuard)", "Fix or remove the references CiteGuard flagged."))
    return checks


def review(doc: ParsedDocument, audit: AuditReport | None) -> tuple[PersonaReview, list[Check]]:
    checks = run_checks(doc, audit)
    passed = sum(c.passed for c in checks)
    failed = [c for c in checks if not c.passed]
    score = max(1, min(10, round(1 + 9 * passed / len(checks))))
    return PersonaReview(
        persona=NAME, score=score, confidence=0.6,
        weaknesses=[f"{c.name}: {c.detail}" for c in failed[:3]],
        fixes=[c.fix for c in failed[:3]],
        summary=f"{passed}/{len(checks)} readiness checks passed (deterministic; checks structure and reporting, not scientific quality).",
    ), checks
