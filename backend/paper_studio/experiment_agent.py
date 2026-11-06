"""Experiment Agent: analyses real open data in the sandbox, the way a researcher works in a notebook.

Loop (at most 5 executions):
  1. write analysis code for the research design and the dataset profile;
  2. run it in the sandbox (load_data() gives it the dataset; no network, no files);
  3. on an error, read the traceback and printed output and fix the code;
  4. on success, a critic reviews code + output for leakage, wrong splits, missing uncertainty, misread variables or
     overclaiming, and returns corrected code if needed (up to two critic rounds).
The best successful run wins. Every number the paper reports from it comes from execution.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field

from pydantic import BaseModel, Field

from backend.llm import client as llm
from backend.paper_studio import sandbox
from backend.paper_studio.datasets import Dataset

RULES = """Write ONE self-contained Python analysis script for REAL DATA.
Load the data with:  df = load_data("{name}")   (a pandas DataFrame; it is the only data available)
Allowed imports only: numpy, pandas, scipy, statsmodels (api / formula.api), sklearn, matplotlib.pyplot, math, statistics,
random, itertools, functools, collections. No files, network, OS access, open(), eval/exec, getattr, dunder attributes,
read_csv or savefig. Must finish in under 100 seconds on one CPU core (subsample with a fixed seed if needed).
Report results ONLY through: report(name, value) for scalar NUMBERS only (put intervals, strings and lists in tables), report_table(title, header, rows) (<= 12 rows each,
<= 4 tables) and save_figure(name, caption) (<= 3 figures). print() short diagnostics (shapes, missingness, sample sizes).
Scientific standards (reviewers will check):
- Clean first: handle missing values explicitly and report the analysed N.
- For prediction / machine learning: a held-out test set or k-fold cross-validation with a fixed seed, at least two
  baselines including a simple one, fit preprocessing on training folds only (no leakage), report mean ± sd across folds.
- For relationships in panel / observational data: descriptive statistics, then regression with appropriate controls
  (e.g. year fixed effects, log of skewed variables, cluster-robust standard errors by country when data are repeated),
  effect sizes with 95% confidence intervals; never claim causality.
- One robustness check (alternative specification, subsample or period) and, where several tests are run, a Holm correction.
- Format p-values sensibly: '< 0.001' for tiny values and '> 0.99' for adjusted values capped at 1 (never '1.0000').
- Analyse exactly the population the research design names (e.g. only developing countries if that is the question).
- Figures: clearly labelled axes with units, legend, title; one figure of the main relationship or comparison.
- Name metrics descriptively (e.g. 'gdp_coef_per_log_unit', 'cv_f1_gradient_boosting_mean').
Return only the code."""


class _Code(BaseModel):
    code: str


class _Critique(BaseModel):
    ok: bool = Field(description="True if the analysis is sound enough to report as is")
    problems: list[str]
    revised_code: str = Field(description="Corrected full script if ok is false, else empty")


@dataclass
class DataExperiment:
    facts: list[str] = field(default_factory=list)
    tables: list[str] = field(default_factory=list)
    figures: dict[str, tuple[bytes, str]] = field(default_factory=dict)
    code: str = ""
    log: list[str] = field(default_factory=list)
    report: dict = field(default_factory=dict)


def _clean(code: str) -> str:
    return code.strip().removeprefix("```python").removeprefix("```").removesuffix("```").strip()


def _summary(res: sandbox.SandboxResult) -> str:
    tabs = "\n".join(f"TABLE {t['title']}: {t['header']} / " + " / ".join(map(str, t["rows"][:6])) for t in res.tables)
    return (f"PRINTED OUTPUT:\n{res.stdout[-2500:]}\n\nREPORTED METRICS: {dict(list(res.metrics.items())[:30])}\n{tabs}\n"
            f"FIGURES: {[c for _, c, _ in res.figures]}")


async def run(ds: Dataset, design: str, say=None, prefer: list[str] | None = None) -> DataExperiment:
    out = DataExperiment()
    rules = RULES.replace("{name}", ds.name)
    task = (f"RESEARCH DESIGN (what the paper asks and hypothesises):\n{design}\n\nDATASET '{ds.name}' PROFILE:\n{ds.profile}\n\n"
            f"SOURCES: {[s['title'] for s in ds.sources]}\n\n{rules}")
    try:
        code = _clean((await llm.complete_json("You are a careful quantitative researcher writing analysis code.", task, _Code,
                                               effort="medium", max_tokens=9000, prefer=prefer)).code)
    except llm.LLMError as e:
        out.report["error"] = f"model error: {e}"[:200]
        return out
    best: tuple[sandbox.SandboxResult, str] | None = None
    critiques = 0
    for attempt in range(5):
        if say:
            await say("experimenter", "run", f"Running analysis on real data (attempt {attempt + 1})…")
        try:
            res = await asyncio.to_thread(sandbox.run, code, {ds.name: ds.csv}, 110, 160)
            if not (res.metrics or res.tables):
                raise sandbox.SandboxError("the script reported no results; call report()/report_table()")
        except sandbox.SandboxError as e:
            out.log.append(f"attempt {attempt + 1}: {str(e)[:200]}")
            try:
                code = _clean((await llm.complete_json(
                    "You fix analysis code that failed in a restricted sandbox. Keep the scientific design; make it run.",
                    f"{task}\n\nCURRENT CODE:\n{code}\n\nERROR:\n{e}", _Code, effort="medium", max_tokens=9000, prefer=prefer)).code)
            except llm.LLMError:
                break
            continue
        best = (res, code)
        out.log.append(f"attempt {attempt + 1}: ran · {len(res.metrics)} metrics · {len(res.tables)} tables · {len(res.figures)} figures")
        if critiques >= 2:
            break
        try:
            cr = await llm.complete_json(
                "You are a demanding methods reviewer auditing an analysis before it goes into a paper. Check: data leakage, "
                "train/test discipline, wrong or misread variables, missing uncertainty (CIs / sd across folds / robust SEs), "
                "inappropriate models, causal overclaiming in names or captions, figures that do not show the main result. "
                "If it is sound, ok=true. Otherwise return the complete corrected script.",
                f"{task}\n\nCODE:\n{code}\n\nRESULTS:\n{_summary(res)}", _Critique, effort="medium", max_tokens=9000, prefer=prefer)
        except llm.LLMError:
            break
        critiques += 1
        out.log.append(f"critic {critiques}: {'sound' if cr.ok else '; '.join(cr.problems)[:240]}")
        if cr.ok or not cr.revised_code.strip():
            break
        code = _clean(cr.revised_code)
    if not best:
        out.report["error"] = "the analysis could not be run: " + (out.log[-1] if out.log else "unknown")
        return out
    res, out.code = best
    srcs = "; ".join(f"{s['title']} ({s.get('url') or ''})" for s in ds.sources)
    out.facts.append(f"- Open dataset analysed: {srcs}; {ds.rows:,} rows and {len(ds.columns)} variables as downloaded "
                     "(analysis code executed by the pipeline in an isolated sandbox).")
    out.facts += [f"- {k.replace('_', ' ')} = {v:.6g}" for k, v in list(res.metrics.items())[:40]]
    for t in res.tables[:4]:
        head = [h.replace("|", "/") for h in t["header"]]
        out.tables.append(f"Table: {t['title']} (executed on the open dataset)\n| " + " | ".join(head) + " |\n|" + "---|" * len(head) + "\n"
                          + "\n".join("| " + " | ".join(str(c).replace("|", "/") for c in r[:len(head)]) + " |" for r in t["rows"]))
        out.facts.append(f"- Table “{t['title']}”: " + " ; ".join(", ".join(map(str, r)) for r in t["rows"][:12]))
    for k, (name, cap, png) in enumerate(res.figures[:3]):
        out.figures[f"data{k}"] = (png, f"{cap} (computed from the open dataset)")
    out.report.update(metrics=len(res.metrics), tables=len(res.tables), figures=len(res.figures), attempts=len(out.log),
                      critic_rounds=critiques, log=out.log[-6:])
    return out
