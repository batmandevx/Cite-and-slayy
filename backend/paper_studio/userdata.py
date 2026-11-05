"""Bring your own data: analyse a user's CSV so the paper reports real results.

The model only *chooses* analyses from a fixed menu and names the columns; this code runs them (numpy/scipy) and every
number in the paper's Results comes from here, the same way data-to-paper keeps results traceable to the code that made
them. Hypothesis tests get a Holm correction across the family.

Menu: describe, compare_groups (Welch t / Mann-Whitney or ANOVA / Kruskal-Wallis with effect sizes), correlate
(Pearson + Spearman with 95% CI), regress (OLS with standard errors and R^2), chi_square (with Cramér's V).
"""
from __future__ import annotations

import csv
import io
import math
from dataclasses import dataclass, field
from typing import Literal

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from pydantic import BaseModel, Field  # noqa: E402
from scipy import stats  # noqa: E402

from backend.llm import client as llm  # noqa: E402

MAX_BYTES = 5_000_000
MAX_ROWS = 200_000


class DataError(ValueError):
    pass


@dataclass
class Table:
    columns: dict[str, list]                      # name -> values (float or str, None for missing)
    kinds: dict[str, Literal["numeric", "categorical"]]
    n: int


def parse_csv(raw: bytes) -> Table:
    if len(raw) > MAX_BYTES:
        raise DataError("The file is larger than 5 MB.")
    text = raw.decode("utf-8-sig", errors="replace")
    try:
        dialect = csv.Sniffer().sniff(text[:5000], delimiters=",;\t")
    except csv.Error:
        dialect = csv.excel
    rows = list(csv.reader(io.StringIO(text), dialect))
    if len(rows) < 6:
        raise DataError("The file needs a header row and at least 5 data rows.")
    head = [h.strip() or f"col{i + 1}" for i, h in enumerate(rows[0])][:60]
    body = [r for r in rows[1:MAX_ROWS + 1] if any(c.strip() for c in r)]
    cols: dict[str, list] = {h: [] for h in head}
    kinds: dict[str, Literal["numeric", "categorical"]] = {}
    for j, h in enumerate(head):
        raw_vals = [(r[j].strip() if j < len(r) else "") for r in body]
        nums = []
        for v in raw_vals:
            try:
                nums.append(float(v.replace(",", "")) if v and v.lower() not in ("na", "nan", "null", "none", "-") else None)
            except ValueError:
                nums.append("x")
        present = [x for x in nums if x is not None]
        if present and sum(isinstance(x, float) for x in present) / len(present) >= 0.95:
            cols[h] = [x if isinstance(x, float) and math.isfinite(x) else None for x in nums]
            kinds[h] = "numeric"
        else:
            cols[h] = [v if v and v.lower() not in ("na", "nan", "null", "none") else None for v in raw_vals]
            kinds[h] = "categorical"
    return Table(cols, kinds, len(body))


def profile(t: Table) -> str:
    lines = [f"Rows: {t.n}; columns: {len(t.columns)}"]
    for h, vals in t.columns.items():
        miss = sum(v is None for v in vals)
        if t.kinds[h] == "numeric":
            x = np.array([v for v in vals if v is not None])
            if len(x):
                lines.append(f"- {h} (numeric): mean {x.mean():.3g}, sd {x.std(ddof=1) if len(x) > 1 else 0:.3g}, "
                             f"min {x.min():.3g}, max {x.max():.3g}, distinct {len(set(x.tolist()))}, missing {miss}")
        else:
            c = {}
            for v in vals:
                if v is not None:
                    c[v] = c.get(v, 0) + 1
            top = sorted(c.items(), key=lambda kv: -kv[1])[:6]
            lines.append(f"- {h} (categorical, {len(c)} levels): " + ", ".join(f"{k} ({n})" for k, n in top) + f"; missing {miss}")
    return "\n".join(lines)


class Analysis(BaseModel):
    kind: Literal["compare_groups", "correlate", "regress", "chi_square"]
    hypothesis: str = Field(description="Which hypothesis this tests, e.g. 'H1'")
    outcome: str = Field(description="Outcome / y column (for chi_square: the first categorical column)")
    predictors: list[str] = Field(description="Group column, x column, regression predictors, or the second categorical column")
    rationale: str


class AnalysisPlan(BaseModel):
    analyses: list[Analysis]


@dataclass
class DataResult:
    facts: list[str] = field(default_factory=list)
    tables: list[str] = field(default_factory=list)
    figures: dict[str, tuple[bytes, str]] = field(default_factory=dict)
    report: dict = field(default_factory=dict)


def _png(fig) -> bytes:
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=200, bbox_inches="tight")
    plt.close(fig)
    return buf.getvalue()


def _f(x: float, d: int = 3) -> str:
    if x is None or not math.isfinite(x):
        return "n/a"
    return f"{x:.{d}g}" if abs(x) >= 1e-3 else f"{x:.2e}"


def _p(p: float) -> str:
    return "< 0.001" if p < 0.001 else f"{p:.3f}"


def _pe(p: float) -> str:
    """'< 0.001' or '= 0.042', for use right after a 'p'."""
    return "< 0.001" if p < 0.001 else f"= {p:.3f}"


def _pairs(t: Table, a: str, b: str):
    return [(x, y) for x, y in zip(t.columns[a], t.columns[b]) if x is not None and y is not None]


def run_analyses(t: Table, plan: AnalysisPlan, prefix: str = "data") -> DataResult:
    out = DataResult()
    # descriptives table
    rows = []
    for h, vals in t.columns.items():
        if t.kinds[h] == "numeric":
            x = np.array([v for v in vals if v is not None])
            if len(x) > 1:
                rows.append(f"| {h} | {len(x)} | {_f(x.mean())} | {_f(x.std(ddof=1))} | {_f(float(np.median(x)))} | {_f(x.min())} | {_f(x.max())} |")
    if rows:
        out.tables.append("Table: Descriptive statistics of the numeric variables in the provided dataset\n"
                          "| Variable | N | Mean | SD | Median | Min | Max |\n|---|---|---|---|---|---|---|\n" + "\n".join(rows[:20]))
    out.facts.append(f"- Provided dataset: {t.n} rows and {len(t.columns)} variables "
                     f"({sum(k == 'numeric' for k in t.kinds.values())} numeric, {sum(k == 'categorical' for k in t.kinds.values())} categorical).")
    tests: list[dict] = []
    for k, a in enumerate(plan.analyses[:6]):
        try:
            cols = [a.outcome, *a.predictors]
            if any(c not in t.columns for c in cols):
                raise DataError(f"unknown column in {cols}")
            if a.kind == "compare_groups":
                y, g = a.outcome, a.predictors[0]
                if t.kinds[y] != "numeric":
                    raise DataError(f"{y} is not numeric")
                groups: dict[str, list[float]] = {}
                for yy, gg in _pairs(t, y, g):
                    groups.setdefault(str(gg), []).append(yy)
                groups = {kk: v for kk, v in groups.items() if len(v) >= 3}
                if not 2 <= len(groups) <= 8:
                    raise DataError(f"{g} needs 2-8 groups with 3+ rows each")
                names = list(groups)
                arrs = [np.array(groups[n]) for n in names]
                desc = "; ".join(f"{n}: n = {len(x)}, mean {_f(x.mean())} (SD {_f(x.std(ddof=1))})" for n, x in zip(names, arrs))
                if len(arrs) == 2:
                    tt = stats.ttest_ind(arrs[0], arrs[1], equal_var=False)
                    mw = stats.mannwhitneyu(arrs[0], arrs[1])
                    sp = math.sqrt(((len(arrs[0]) - 1) * arrs[0].var(ddof=1) + (len(arrs[1]) - 1) * arrs[1].var(ddof=1)) / (len(arrs[0]) + len(arrs[1]) - 2))
                    d = (arrs[0].mean() - arrs[1].mean()) / sp if sp else float("nan")
                    tests.append({"h": a.hypothesis, "p": float(tt.pvalue), "text":
                                  f"{a.hypothesis} ({y} by {g}): {desc}. Welch t = {_f(float(tt.statistic))}, p {_pe(float(tt.pvalue))}; "
                                  f"Cohen's d = {_f(d)}; Mann-Whitney U = {_f(float(mw.statistic))}, p {_pe(float(mw.pvalue))}"})
                else:
                    an = stats.f_oneway(*arrs)
                    kw = stats.kruskal(*arrs)
                    allv = np.concatenate(arrs)
                    ssb = sum(len(x) * (x.mean() - allv.mean()) ** 2 for x in arrs)
                    eta = ssb / ((allv - allv.mean()) ** 2).sum()
                    tests.append({"h": a.hypothesis, "p": float(an.pvalue), "text":
                                  f"{a.hypothesis} ({y} by {g}): {desc}. ANOVA F = {_f(float(an.statistic))}, p {_pe(float(an.pvalue))}; "
                                  f"eta squared = {_f(eta)}; Kruskal-Wallis H = {_f(float(kw.statistic))}, p {_pe(float(kw.pvalue))}"})
                fig, ax = plt.subplots(figsize=(5.5, 3.6))
                ax.boxplot(arrs)
                ax.set_xticks(range(1, len(names) + 1), [n[:14] for n in names])
                ax.set_ylabel(y)
                ax.set_xlabel(g)
                ax.set_title(f"{y} by {g}")
                out.figures[f"{prefix}{k}"] = (_png(fig), f"Distribution of {y} by {g} in the provided dataset ({a.hypothesis}).")
            elif a.kind == "correlate":
                x, y = a.predictors[0], a.outcome
                pr = _pairs(t, x, y)
                if t.kinds[x] != "numeric" or t.kinds[y] != "numeric" or len(pr) < 8:
                    raise DataError("correlation needs two numeric columns with 8+ complete rows")
                xa, ya = np.array([p[0] for p in pr]), np.array([p[1] for p in pr])
                r, p = stats.pearsonr(xa, ya)
                rho, ps = stats.spearmanr(xa, ya)
                z, se = math.atanh(max(min(r, 0.999999), -0.999999)), 1 / math.sqrt(len(pr) - 3)
                lo, hi = math.tanh(z - 1.96 * se), math.tanh(z + 1.96 * se)
                tests.append({"h": a.hypothesis, "p": float(p), "text":
                              f"{a.hypothesis} ({x} vs {y}, n = {len(pr)}): Pearson r = {_f(float(r))} (95% CI {_f(lo)} to {_f(hi)}), "
                              f"p {_pe(float(p))}; Spearman rho = {_f(float(rho))}, p {_pe(float(ps))}"})
                fig, ax = plt.subplots(figsize=(5.2, 3.8))
                ax.scatter(xa, ya, s=10, alpha=0.6)
                m, b = np.polyfit(xa, ya, 1)
                xs = np.linspace(xa.min(), xa.max(), 50)
                ax.plot(xs, m * xs + b, linewidth=2)
                ax.set_xlabel(x)
                ax.set_ylabel(y)
                ax.set_title(f"{y} against {x}")
                out.figures[f"{prefix}{k}"] = (_png(fig), f"Relationship between {x} and {y} with a least-squares line ({a.hypothesis}).")
            elif a.kind == "regress":
                y, xs = a.outcome, [c for c in a.predictors if t.kinds.get(c) == "numeric"][:8]
                if t.kinds[y] != "numeric" or not xs:
                    raise DataError("regression needs a numeric outcome and numeric predictors")
                rows_ = [r for r in zip(*(t.columns[c] for c in [y, *xs])) if all(v is not None for v in r)]
                if len(rows_) < len(xs) + 10:
                    raise DataError("too few complete rows for regression")
                M = np.array(rows_, dtype=float)
                Y, X = M[:, 0], np.column_stack([np.ones(len(M)), M[:, 1:]])
                beta, *_ = np.linalg.lstsq(X, Y, rcond=None)
                resid = Y - X @ beta
                dof = len(Y) - X.shape[1]
                s2 = resid @ resid / dof
                se = np.sqrt(np.diag(s2 * np.linalg.pinv(X.T @ X)))
                tv = beta / se
                pv = 2 * stats.t.sf(np.abs(tv), dof)
                r2 = 1 - (resid @ resid) / ((Y - Y.mean()) @ (Y - Y.mean()))
                adj = 1 - (1 - r2) * (len(Y) - 1) / dof
                coef = "; ".join(f"{c}: b = {_f(beta[i + 1])} (SE {_f(se[i + 1])}), p {_pe(pv[i + 1])}" for i, c in enumerate(xs))
                tests.append({"h": a.hypothesis, "p": float(min(pv[1:])), "text":
                              f"{a.hypothesis} (OLS of {y} on {', '.join(xs)}, n = {len(Y)}): {coef}; R squared = {_f(r2)}, adjusted {_f(adj)}"})
                out.tables.append(f"Table: Ordinary least squares regression of {y} ({a.hypothesis}; n = {len(Y)}, R squared = {_f(r2)})\n"
                                  "| Term | Coefficient | SE | t | p |\n|---|---|---|---|---|\n"
                                  + "\n".join(f"| {nm} | {_f(beta[i])} | {_f(se[i])} | {_f(tv[i])} | {_p(pv[i])} |"
                                              for i, nm in enumerate(["Intercept", *xs])))
            elif a.kind == "chi_square":
                a_col, b_col = a.outcome, a.predictors[0]
                pr = _pairs(t, a_col, b_col)
                la, lb = sorted({str(p[0]) for p in pr}), sorted({str(p[1]) for p in pr})
                if not (2 <= len(la) <= 10 and 2 <= len(lb) <= 10):
                    raise DataError("chi-square needs two categorical columns with 2-10 levels")
                tab = np.zeros((len(la), len(lb)))
                for p0, p1 in pr:
                    tab[la.index(str(p0)), lb.index(str(p1))] += 1
                chi, p, dof, _ = stats.chi2_contingency(tab)
                v = math.sqrt(chi / (tab.sum() * (min(tab.shape) - 1)))
                tests.append({"h": a.hypothesis, "p": float(p), "text":
                              f"{a.hypothesis} ({a_col} by {b_col}, n = {int(tab.sum())}): chi squared({dof}) = {_f(chi)}, p {_pe(float(p))}; Cramér's V = {_f(v)}"})
        except Exception as e:  # noqa: BLE001 - one bad analysis never stops the others
            out.report.setdefault("skipped", []).append(f"{a.kind} {a.outcome}: {e}"[:160])
    # Holm correction across the family of hypothesis tests
    if tests:
        order = sorted(range(len(tests)), key=lambda i: tests[i]["p"])
        m, running = len(tests), 0.0
        for rank, i in enumerate(order):
            running = max(running, min(1.0, (m - rank) * tests[i]["p"]))
            tests[i]["p_holm"] = running
        for tst in tests:
            out.facts.append(f"- {tst['text']}; Holm-adjusted p {_pe(tst['p_holm'])} across {m} test(s).")
        out.tables.append("Table: Hypothesis tests on the provided dataset (Holm-adjusted)\n| Hypothesis | Raw p | Holm-adjusted p |\n|---|---|---|\n"
                          + "\n".join(f"| {tst['h']} | {_p(tst['p'])} | {_p(tst['p_holm'])} |" for tst in tests))
    out.report.update(analyses=len(tests), figures=len(out.figures))
    return out


async def analyse(raw: bytes, note: str, hypotheses: str, say=None) -> DataResult:
    t = parse_csv(raw)
    prof = profile(t)
    try:
        plan = await llm.complete_json(
            "You are a careful statistician. Choose analyses ONLY from the menu and ONLY with columns that exist, matching each "
            "to a hypothesis. compare_groups: numeric outcome + one categorical group column (2-8 groups). correlate: numeric "
            "outcome + one numeric predictor. regress: numeric outcome + numeric predictors. chi_square: two categorical columns.",
            f"DATASET PROFILE:\n{prof}\n\nWHAT THE USER SAYS THE DATA IS:\n{note or '(no description)'}\n\nHYPOTHESES:\n{hypotheses}\n\n"
            "Choose 1-5 analyses.", AnalysisPlan, effort="low", tier="fast")
    except llm.LLMError:
        plan = AnalysisPlan(analyses=[])
    if say:
        await say("statistician", "run", f"Running {len(plan.analyses)} analyses on {t.n} rows…")
    res = run_analyses(t, plan)
    res.report["profile"] = prof
    return res
