"""Bundled showcase research papers (20-page IEEE-style monographs) available across Landing, Paper Studio & CiteGuard."""
from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any

from backend.common.config import ROOT
from backend.common.schemas import DocumentInfo
from backend.documents import service as docs

SHOWCASE_DIR: Path = ROOT / "demo" / "showcase_papers"

SHOWCASE_PAPERS: list[dict[str, Any]] = [
    {
        "slug": "aditi",
        "acronym": "ADITI",
        "title": "ADITI: Adaptive Drift-aware Intervals for Time-series Inference",
        "authors": "Ayush Upadhyay",
        "affiliation": "Vellore Institute of Technology (VIT), Chennai",
        "venue_style": "IEEE Monograph · Online Conformal Prediction",
        "pages": 21,
        "words": 12949,
        "n_references": 25,
        "filename": "ADITI_Drift_Aware_Conformal_Intervals.pdf",
        "summary": (
            "Distribution-free online conformal intervals combining dual-EMA volatility scale normalization "
            "with multi-timescale quantile tracking, complete with finite-sample long-run coverage proofs, "
            "O(1) per-step complexity, 12 tables, and explicit failure-mode bounds."
        ),
        "highlights": [
            "Propositions 1–3 + formal proofs",
            "Algorithm 1 · O(1) time & space",
            "12 tables incl. notation & ablations",
            "Explicit failure-mode analysis",
        ],
        "topic_seed": "Adaptive conformal prediction intervals under non-stationary concept drift in time series",
        "angle_seed": "Combine volatility-normalized residual scoring with multi-timescale online quantile tracking and prove finite-sample coverage bounds alongside failure-mode conditions.",
    },
    {
        "slug": "aliza",
        "acronym": "ALIZA",
        "title": "ALIZA: Autonomous Learning Intelligence for Zero-trust Agents",
        "authors": "Ayush Upadhyay, Aliza Bano, and Kumaran K",
        "affiliation": "Vellore Institute of Technology (VIT), Chennai",
        "venue_style": "IEEE Security Architecture · Zero-Trust LLM Agents",
        "pages": 20,
        "words": 13374,
        "n_references": 31,
        "filename": "ALIZA_Zero_Trust_Agents_20pp.pdf",
        "summary": (
            "Zero-trust reference monitor for tool-using LLM agents featuring task-scoped capability synthesis, "
            "multi-signal behavioral risk scoring, and cryptographic hash-chained audit logging against "
            "indirect prompt injection and confused-deputy privilege escalation."
        ),
        "highlights": [
            "Formal threat model & safety invariants",
            "Hash-chain tamper-evidence theorem",
            "13 tables + capability lattice design",
            "Honest trust-creep boundary analysis",
        ],
        "topic_seed": "Zero-trust capability attenuation and behavioral anomaly detection for tool-using LLM agents",
        "angle_seed": "Enforce task-scoped least-privilege capability tokens at an external deterministic reference monitor with cryptographic hash-chained audit logs.",
    },
    {
        "slug": "cast",
        "acronym": "CAST",
        "title": "Chiral Amplification Self-Training: An Exact Asymmetric-Catalysis Theory of Agreement-Filtered Pseudo-Labeling",
        "authors": "Ayush Upadhyay and Shivam Goel",
        "affiliation": "Vellore Institute of Technology (VIT)",
        "venue_style": "IEEE Access · Statistical Learning Theory",
        "pages": 19,
        "words": 14779,
        "n_references": 57,
        "filename": "CAST_IEEE_Access_Paper.pdf",
        "summary": (
            "Exact dynamical theory mapping Soai asymmetric autocatalysis onto multi-view agreement-filtered "
            "pseudo-labeling via a scalar chiral excess order parameter, deriving pitchfork bifurcation "
            "thresholds, Lyapunov convergence rates, and finite-pool Kramers escape bounds."
        ),
        "highlights": [
            "Exact bifurcation & Lyapunov theorems",
            "57 verified ML & chemistry references",
            "IEEE Access two-column monograph",
            "Stochastic drift-diffusion & ablations",
        ],
        "topic_seed": "Theoretical dynamics of agreement-filtered pseudo-labeling and confirmation bias in semi-supervised learning",
        "angle_seed": "Formulate multi-view pseudo-label confirmation bias as a nonlinear dynamical system with exact fixed-point stability and finite-sample variance bounds.",
    },
]


def _by_slug(slug: str) -> dict[str, Any] | None:
    s = slug.strip().lower()
    return next((p for p in SHOWCASE_PAPERS if p["slug"] == s), None)


def pdf_path(slug: str) -> tuple[dict[str, Any], Path] | None:
    item = _by_slug(slug)
    if not item:
        return None
    p = SHOWCASE_DIR / item["filename"]
    return (item, p) if p.exists() else None


def list_public() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for item in SHOWCASE_PAPERS:
        p = SHOWCASE_DIR / item["filename"]
        if not p.exists():
            continue
        doc_id = hashlib.sha256(p.read_bytes()).hexdigest()[:16]
        out.append({
            **item,
            "document_id": doc_id,
            "pdf_url": f"/api/demo-papers/{item['slug']}/pdf",
            "download_url": f"/api/demo-papers/{item['slug']}/pdf?download=1",
        })
    return out


def register_one(slug: str) -> DocumentInfo | None:
    found = pdf_path(slug)
    if not found:
        return None
    item, p = found
    return docs.save_path(p, filename=item["filename"], title=item["title"])


def register_all() -> list[DocumentInfo]:
    out: list[DocumentInfo] = []
    for item in SHOWCASE_PAPERS:
        p = SHOWCASE_DIR / item["filename"]
        if p.exists():
            out.append(docs.save_path(p, filename=item["filename"], title=item["title"]))
    return out

