"""Pilot experiments that actually run, so papers report real measured results.

Two kinds, both executed on our server:

* Vetted experiments: the model only *chooses* from a fixed menu (public dataset, classifiers, a hyperparameter sweep,
  label-noise and class-imbalance studies). Our code runs them: repeated stratified cross-validation, confusion matrix,
  paired significance test, and charts. The model never writes this code and never supplies a number.
* A custom simulation: the model writes a small, self-contained script (e.g. a toy version of the proposed mechanism),
  which runs in `sandbox.py`. If it fails validation or execution twice, it is skipped and the paper says nothing about it.

Everything returned (facts, tables, figures) is derived from the runs, and the paper labels the section as pilot
experiments on public benchmark data and a toy simulation, not a full-scale evaluation of the proposed method.
"""
from __future__ import annotations

import asyncio
import math
import re
import time
from dataclasses import dataclass, field
from typing import Literal

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from pydantic import BaseModel, Field  # noqa: E402
from scipy import stats  # noqa: E402
from sklearn import datasets  # noqa: E402
from sklearn.base import clone  # noqa: E402
from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier  # noqa: E402
from sklearn.linear_model import LogisticRegression  # noqa: E402
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score  # noqa: E402
from sklearn.model_selection import StratifiedKFold, cross_val_predict  # noqa: E402
from sklearn.naive_bayes import GaussianNB  # noqa: E402
from sklearn.neighbors import KNeighborsClassifier  # noqa: E402
from sklearn.neural_network import MLPClassifier  # noqa: E402
from sklearn.pipeline import make_pipeline  # noqa: E402
from sklearn.preprocessing import StandardScaler  # noqa: E402
from sklearn.svm import SVC  # noqa: E402
from sklearn.tree import DecisionTreeClassifier  # noqa: E402

from backend.llm import client as llm  # noqa: E402
from backend.paper_studio import sandbox  # noqa: E402
from backend.paper_studio.figures import INK, MUTED, SERIES, _RC, _png, _style  # noqa: E402

Dataset = Literal["breast_cancer", "digits", "wine", "iris", "synthetic_hard", "synthetic_imbalanced"]
Model = Literal["logistic_regression", "random_forest", "svm_rbf", "mlp", "gradient_boosting", "knn", "naive_bayes", "decision_tree"]

DATASET_INFO = {
    "breast_cancer": "Wisconsin Diagnostic Breast Cancer (569 samples, 30 features, 2 classes; UCI, via scikit-learn)",
    "digits": "UCI optical handwritten digits (1,797 samples, 64 features, 10 classes; via scikit-learn)",
    "wine": "UCI Wine recognition (178 samples, 13 features, 3 classes; via scikit-learn)",
    "iris": "Fisher's Iris (150 samples, 4 features, 3 classes; via scikit-learn)",
    "synthetic_hard": "synthetic classification task (2,000 samples, 20 features, 8 informative, 4 classes, 5% label flips; scikit-learn make_classification, seed 7)",
    "synthetic_imbalanced": "synthetic imbalanced binary task (2,000 samples, 20 features, 90/10 class ratio; scikit-learn make_classification, seed 7)",
}
MODEL_NAMES = {
    "logistic_regression": "Logistic regression", "random_forest": "Random forest", "svm_rbf": "RBF-kernel SVM", "mlp": "MLP (1 hidden layer)",
    "gradient_boosting": "Gradient boosting", "knn": "k-nearest neighbours", "naive_bayes": "Gaussian naive Bayes", "decision_tree": "Decision tree",
}
SWEEPS = {   # model -> (parameter label, sklearn param, allowed values)
    "random_forest": ("number of trees", "n_estimators", [5, 10, 25, 50, 100, 200]),
    "svm_rbf": ("regularisation C", "C", [0.01, 0.1, 1, 10, 100]),
    "mlp": ("hidden units", "hidden_layer_sizes", [4, 8, 16, 32, 64, 128]),
    "knn": ("neighbours k", "n_neighbors", [1, 3, 5, 9, 15, 25]),
    "decision_tree": ("maximum depth", "max_depth", [1, 2, 4, 8, 16]),
    "gradient_boosting": ("boosting stages", "n_estimators", [10, 25, 50, 100, 200]),
    "logistic_regression": ("inverse regularisation C", "C", [0.001, 0.01, 0.1, 1, 10]),
}


class _Plan(BaseModel):
    relevance: Literal["direct", "weak", "none"] = Field(
        default="direct",
        description="'direct' only if the paper's own task is classification on data like the chosen dataset; otherwise weak/none")
    dataset: Dataset
    models: list[Model] = Field(min_length=2, max_length=5)
    sweep_model: Model
    noise_study: bool
    rationale: str
    custom_title: str = ""
    custom_description: str = ""


class _Code(BaseModel):
    code: str


@dataclass
class Experiments:
    facts: list[str] = field(default_factory=list)
    figures: dict[str, tuple[bytes, str]] = field(default_factory=dict)
    markdown: str = ""
    report: dict = field(default_factory=dict)
    code: str = ""                       # the executed simulation script (published with the paper)


def _load(name: str):
    if name == "breast_cancer":
        return datasets.load_breast_cancer(return_X_y=True)
    if name == "digits":
        return datasets.load_digits(return_X_y=True)
    if name == "wine":
        return datasets.load_wine(return_X_y=True)
    if name == "iris":
        return datasets.load_iris(return_X_y=True)
    if name == "synthetic_hard":
        return datasets.make_classification(n_samples=2000, n_features=20, n_informative=8, n_redundant=4, n_classes=4,
                                            flip_y=0.05, class_sep=0.9, random_state=7)
    return datasets.make_classification(n_samples=2000, n_features=20, n_informative=6, weights=[0.9, 0.1], flip_y=0.01, random_state=7)


def _model(name: str, **params):
    base = {
        "logistic_regression": lambda: LogisticRegression(max_iter=3000),
        "random_forest": lambda: RandomForestClassifier(n_estimators=100, random_state=0, n_jobs=1),
        "svm_rbf": lambda: SVC(kernel="rbf", gamma="scale"),
        "mlp": lambda: MLPClassifier(hidden_layer_sizes=(32,), max_iter=400, early_stopping=True, random_state=0),
        "gradient_boosting": lambda: GradientBoostingClassifier(random_state=0),
        "knn": lambda: KNeighborsClassifier(),
        "naive_bayes": lambda: GaussianNB(),
        "decision_tree": lambda: DecisionTreeClassifier(random_state=0),
    }[name]()
    if params:
        if "hidden_layer_sizes" in params:
            params = {"hidden_layer_sizes": (int(params["hidden_layer_sizes"]),)}
        if name in ("random_forest", "gradient_boosting", "knn", "decision_tree") and params:
            params = {k: int(v) for k, v in params.items()}
        base.set_params(**params)
    return make_pipeline(StandardScaler(), base)


def _cv_scores(model, X, y, seeds=(0, 1, 2), folds=5):
    acc, f1 = [], []
    for s in seeds:
        for tr, te in StratifiedKFold(folds, shuffle=True, random_state=s).split(X, y):
            m = clone(model).fit(X[tr], y[tr])
            p = m.predict(X[te])
            acc.append(accuracy_score(y[te], p))
            f1.append(f1_score(y[te], p, average="macro"))
    return np.array(acc), np.array(f1)


def _fmt(m, s):
    return f"{100 * m:.1f} ± {100 * s:.1f}"


# ---------- charts (drawn from the runs) ----------

def _bar(names, means, stds, title):
    with plt.rc_context(_RC):
        fig, ax = plt.subplots(figsize=(4.6, 3.0))
        order = np.argsort(means)[::-1]
        xs = np.arange(len(names))
        ax.bar(xs, np.array(means)[order] * 100, yerr=np.array(stds)[order] * 100, color=[SERIES[i % 4] for i in range(len(names))],
               capsize=4, edgecolor="white", linewidth=1)
        for x, m in zip(xs, np.array(means)[order]):
            ax.text(x, m * 100 + 0.6, f"{100 * m:.1f}", ha="center", va="bottom", fontsize=8, color=INK)
        ax.set_xticks(xs, [names[i] for i in order], rotation=15, ha="right")
        lo = max(0, min(np.array(means) * 100) - 15)
        ax.set_ylim(lo, 100.5)
        _style(ax, title, "", "Macro-F1 (%)")
        return _png(fig)


def _cm(cm, labels, title):
    with plt.rc_context(_RC):
        n = len(labels)
        fig, ax = plt.subplots(figsize=(min(6.2, 2.4 + 0.42 * n), min(5.4, 2.1 + 0.38 * n)))
        norm = cm / np.maximum(1, cm.sum(axis=1, keepdims=True))
        im = ax.imshow(norm, cmap="Blues", vmin=0, vmax=1)
        for i in range(n):
            for j in range(n):
                ax.text(j, i, str(cm[i, j]), ha="center", va="center", fontsize=7 if n > 6 else 9,
                        color="white" if norm[i, j] > 0.55 else INK)
        ax.set_xticks(range(n), labels, fontsize=8)
        ax.set_yticks(range(n), labels, fontsize=8)
        ax.set_xlabel("Predicted class", fontsize=9, color=INK)
        ax.set_ylabel("True class", fontsize=9, color=INK)
        ax.set_title(title, fontsize=10.5, color=INK, loc="left", pad=10, fontweight="bold")
        fig.colorbar(im, ax=ax, fraction=0.046, pad=0.04).ax.tick_params(labelsize=7, colors=MUTED)
        return _png(fig)


def _line(xs, means, stds, title, xlabel, ylabel, logx=False):
    with plt.rc_context(_RC):
        fig, ax = plt.subplots(figsize=(4.6, 3.0))
        m, s = np.array(means) * 100, np.array(stds) * 100
        ax.plot(xs, m, marker="o", color=SERIES[0], linewidth=2, markersize=5)
        ax.fill_between(xs, m - s, m + s, color=SERIES[0], alpha=0.15, linewidth=0)
        if logx:
            ax.set_xscale("log")
        _style(ax, title, xlabel, ylabel)
        return _png(fig)


# ---------- the vetted battery ----------

def _run_vetted(plan: _Plan, deadline: float) -> Experiments:
    out = Experiments()
    X, y = _load(plan.dataset)
    X = np.asarray(X, dtype=float)
    y = np.asarray(y)
    classes = [str(c) for c in sorted(set(y.tolist()))]
    rows, scores = [], {}
    models = list(dict.fromkeys(plan.models))[:5]
    for name in models:
        if time.time() > deadline:
            break
        acc, f1 = _cv_scores(_model(name), X, y)
        scores[name] = (acc, f1)
        rows.append((MODEL_NAMES[name], acc, f1))
    if len(scores) < 2:
        return out
    rows.sort(key=lambda r: -r[2].mean())
    best_key = max(scores, key=lambda k: scores[k][1].mean())
    second_key = sorted(scores, key=lambda k: -scores[k][1].mean())[1]
    t, p = stats.ttest_rel(scores[best_key][1], scores[second_key][1])
    try:
        w_p = stats.wilcoxon(scores[best_key][1], scores[second_key][1]).pvalue
    except ValueError:
        w_p = float("nan")
    ds = DATASET_INFO[plan.dataset]
    out.facts.append(f"- Pilot benchmark (executed by the pipeline): {ds}; 5-fold stratified cross-validation repeated with 3 seeds (15 folds per model); features standardised inside each fold.")
    for name, acc, f1 in rows:
        out.facts.append(f"- {name}: accuracy {_fmt(acc.mean(), acc.std())}%, macro-F1 {_fmt(f1.mean(), f1.std())}% (mean ± s.d. over 15 folds).")
    out.facts.append(f"- Paired comparison of the two best models ({MODEL_NAMES[best_key]} vs. {MODEL_NAMES[second_key]}) on macro-F1: "
                     f"paired t-test p = {p:.3g}" + (f", Wilcoxon signed-rank p = {w_p:.3g}" if math.isfinite(w_p) else "") + ".")
    table = ("Table: Pilot benchmark results (mean ± s.d. over 15 cross-validation folds, executed by the pipeline)\n"
             "| Model | Accuracy (%) | Macro-F1 (%) |\n|---|---|---|\n"
             + "\n".join(f"| {n} | {_fmt(a.mean(), a.std())} | {_fmt(f.mean(), f.std())} |" for n, a, f in rows))
    out.figures["exp_bar"] = (_bar([r[0] for r in rows], [r[2].mean() for r in rows], [r[2].std() for r in rows],
                                   "Pilot benchmark: macro-F1 by model"),
                              f"Macro-F1 (mean ± s.d., 15 folds) of each model on the {ds.split(' (')[0]} task, measured by the pipeline.")
    pred = cross_val_predict(_model(best_key), X, y, cv=StratifiedKFold(5, shuffle=True, random_state=0))
    cm = confusion_matrix(y, pred)
    out.figures["exp_cm"] = (_cm(cm, classes, f"Confusion matrix: {MODEL_NAMES[best_key]}"),
                             f"Out-of-fold confusion matrix of the best model ({MODEL_NAMES[best_key]}), 5-fold cross-validation, seed 0.")
    worst = int(np.argmin(cm.diagonal() / np.maximum(1, cm.sum(axis=1))))
    out.facts.append(f"- Confusion matrix of {MODEL_NAMES[best_key]} (out-of-fold, seed 0): {int(cm.diagonal().sum())} of {int(cm.sum())} samples correct; "
                     f"lowest per-class recall is class {classes[worst]} at {100 * cm[worst, worst] / max(1, cm[worst].sum()):.1f}%.")
    md = [table]

    # hyperparameter sweep
    if time.time() < deadline and plan.sweep_model in SWEEPS:
        label, param, values = SWEEPS[plan.sweep_model]
        means, stds = [], []
        for v in values:
            if time.time() > deadline:
                break
            acc, f1 = _cv_scores(_model(plan.sweep_model, **{param: v}), X, y, seeds=(0,), folds=5)
            means.append(f1.mean()); stds.append(f1.std())
        if len(means) >= 3:
            xs = values[:len(means)]
            out.figures["exp_sweep"] = (_line(xs, means, stds, f"Sensitivity: {MODEL_NAMES[plan.sweep_model]}", label.capitalize(), "Macro-F1 (%)",
                                              logx=max(xs) / max(min(xs), 1e-9) > 50),
                                        f"Macro-F1 of {MODEL_NAMES[plan.sweep_model]} as the {label} varies (5-fold CV, mean ± s.d.).")
            k = int(np.argmax(means))
            out.facts.append(f"- Hyperparameter sensitivity ({MODEL_NAMES[plan.sweep_model]}, {label}): macro-F1 ranged from "
                             f"{100 * min(means):.1f}% to {100 * max(means):.1f}%, best at {label} = {xs[k]}.")
            md.append("Table: Hyperparameter sensitivity (macro-F1 %, 5-fold CV)\n| " + label.capitalize() + " | Macro-F1 (%) |\n|---|---|\n"
                      + "\n".join(f"| {x} | {_fmt(m, s)} |" for x, m, s in zip(xs, means, stds)))

    # label-noise robustness (noise injected into training folds only)
    if plan.noise_study and time.time() < deadline:
        rates, means, stds = [0.0, 0.1, 0.2, 0.3], [], []
        rng = np.random.default_rng(0)
        for r in rates:
            f1s = []
            for tr, te in StratifiedKFold(5, shuffle=True, random_state=0).split(X, y):
                ytr = y[tr].copy()
                flip = rng.random(len(ytr)) < r
                ytr[flip] = rng.choice(np.unique(y), flip.sum())
                m = clone(_model(best_key)).fit(X[tr], ytr)
                f1s.append(f1_score(y[te], m.predict(X[te]), average="macro"))
            means.append(float(np.mean(f1s))); stds.append(float(np.std(f1s)))
        out.figures["exp_noise"] = (_line([int(r * 100) for r in rates], means, stds, f"Robustness to label noise: {MODEL_NAMES[best_key]}",
                                          "Training labels corrupted (%)", "Macro-F1 (%)"),
                                    "Macro-F1 when a share of training labels is replaced at random (test labels untouched; 5-fold CV).")
        out.facts.append(f"- Label-noise robustness ({MODEL_NAMES[best_key]}): macro-F1 {100 * means[0]:.1f}% with clean labels, "
                         f"{100 * means[-1]:.1f}% with 30% of training labels corrupted.")
    out.markdown = "\n\n".join(md)
    out.report = {"dataset": plan.dataset, "models": len(rows), "folds_per_model": 15, "best": MODEL_NAMES[best_key],
                  "p_value": float(p) if math.isfinite(p) else None}
    return out


_SANDBOX = """Allowed imports only: numpy, scipy (stats, optimize, special, linalg, integrate, signal, spatial, sparse, interpolate),
sklearn, pandas, statsmodels (api / formula.api), matplotlib.pyplot, math, statistics, random, itertools, functools,
collections, warnings, time, re, copy. No file, network or OS access: no open(), eval, exec, getattr, dunder attributes,
np.save/np.load, read_csv, fetch_* or savefig. Write plain top-level code (no `if __name__` guard needed).
Report results ONLY through these provided functions (do not import or define them):
  report(name: str, value: float)                      -> one scalar number (descriptive snake_case name)
  report_table(title: str, header: list, rows: list)   -> a results table (<= 12 rows, <= 7 columns, short cells)
  save_figure(name: str, caption: str)                 -> saves the current matplotlib figure (call instead of savefig)
Matplotlib already uses a clean publication style sized for one journal column: do not change figure sizes or fonts.
Every figure needs axis labels with units, a legend when there are several series, and error bars or bands for
uncertainty. Use numpy vectorisation; total runtime must stay under {budget} seconds on one CPU core."""

CODE_RULES = """Write ONE self-contained Python experiment script.
""" + _SANDBOX + """
Build a small, seeded simulation that illustrates the proposed mechanism against a simple baseline on synthetic data,
and report 3-8 metrics, one table and 1-2 clearly labelled figures. Return only the code."""

STUDY_RULES = """Write ONE self-contained Python script for a CONTROLLED SIMULATION STUDY of the proposed method.
""" + _SANDBOX + """
The study MUST:
1. Generate synthetic data from a generator that matches the formal setting and assumptions (state them in comments);
   keep each run small (<= 3,000 samples) so the whole study fits the time budget.
2. Implement a faithful, simplified version of the proposed method AND at least two baselines named after families in the
   cited literature (a standard method and a strong simple heuristic).
3. Run every method over 10 random seeds (0-9) and report mean and standard deviation of 2-3 metrics that match the
   hypotheses.
4. Run one ablation: the proposed method with its key component removed.
5. Run one sweep of a stress parameter into the failure regime described below (>= 5 levels), for the proposed method
   and the best baseline, with error bars across seeds.
6. Compare the proposed method with the best baseline using PAIRED differences over the same seeds: report the mean
   difference, its 95% confidence interval (t-interval over seeds) and a paired test p-value (scipy.stats.ttest_rel or
   wilcoxon), e.g. report('diff_<metric>_vs_<baseline>_mean', ...), '..._ci_low', '..._ci_high', '..._p'.
7. Report: a main results table (rows = methods incl. the ablation, columns = metrics, cells 'mean ± sd'); a table of the
   paired comparisons; figure 1 = the stress sweep (x = stress level, y = metric, one line per method with error bars);
   figure 2 = the main comparison (bar or box plot across seeds).
Report honestly whatever the numbers are, including when the proposed method does not win. Return only the code."""

DESIGN_RULES = """Write ONE self-contained Python script for a SIMULATION-BASED DESIGN ANALYSIS (a Monte Carlo study of the
planned statistical analysis, as in the methods literature on power and design). No real participants exist: the
simulation tells the reader how well the proposed design and analysis can answer the research question.
""" + _SANDBOX + """
The script MUST:
1. Write a data-generating process that mirrors the study design (units, repeated measures or clusters, covariates,
   measurement error, missingness/attrition). Take plausible effect sizes and variances from the cited evidence given
   below where it states them; otherwise use conventional small / medium values. State every assumed value in a
   comment AND report it with report('assumed_<name>', value).
2. Fit exactly the planned analysis model to each simulated dataset (statsmodels OLS/GLM/MixedLM or a fast equivalent;
   use a simpler but faithful estimator if MixedLM would be too slow).
3. Estimate, over >= 200 replications per condition (fewer only if needed for the time budget; report the number):
   statistical power for each hypothesis at the planned sample size; the false-positive rate when the true effect is 0;
   bias and 95% CI coverage of the main estimate; and the minimum detectable effect size at 80% power.
4. Sweep the sample size (>= 5 levels around the plan) and, for one hypothesis, the effect size; also one robustness
   condition (e.g. 20% attrition or a violated assumption).
5. Report: a table 'Power by sample size and hypothesis'; a table 'Operating characteristics' (bias, coverage,
   false-positive rate, MDES); figure 1 = power curves versus N with the 0.80 line and Monte Carlo error bars;
   figure 2 = power versus effect size (or the robustness comparison).
Use Monte Carlo standard errors where relevant. Report honestly, including when the planned N is underpowered.
Return only the code."""

CRITIC = ("You are a demanding methods reviewer auditing a simulation before it goes into a paper. Check that it does what "
          "the brief asks: a data generator matching the stated assumptions, faithful method and baselines (or the planned "
          "analysis), enough seeds/replications, paired uncertainty (CIs, p-values) for the headline comparison, no bugs "
          "that make results meaningless (wrong axis, a baseline that is crippled, leakage, metrics computed on the wrong "
          "data), and figures that show the main result with labelled axes and error bars. For design simulations also check "
          "that the false-positive rate is near alpha, CI coverage near 95%, power rises with N, and each hypothesis's test "
          "uses the variance structure of the generator (a moderator or mediator built so it carries no signal is a bug). "
          "If it is sound, ok=true. "
          "Otherwise list each concrete problem; the author will fix them.")


class _Verdict(BaseModel):
    ok: bool = Field(description="True if the simulation is sound enough to report as is")
    problems: list[str] = Field(description="Concrete problems to fix (empty if ok)")


_FENCE = re.compile(r"```(?:python|py)?[ \t]*\n(.*?)```", re.S)


async def write_code(system: str, prompt: str, *, prefer: list[str] | None = None, tokens: int = 10000) -> str:
    """Ask for a script as plain text in a ```python block. Code is never wrapped in JSON: backslashes in plots
    (r"$\\rho$") and regexes made JSON replies invalid and silently killed whole studies."""
    ask = prompt + "\n\nReply with the complete script in ONE ```python code block and nothing else."
    for _ in range(2):
        text = await llm.complete(system, ask, effort="medium", max_tokens=tokens, prefer=prefer)
        blocks = _FENCE.findall(text)
        code = max(blocks, key=len) if blocks else (text if re.search(r"^\s*(import|from)\s", text, re.M) else "")
        if code.strip():
            return sandbox.autofix(code)
        ask = prompt + "\n\nYour previous reply contained no code. Reply with ONE ```python block containing the full script."
    raise llm.LLMError("the model returned no code")


def _enough(res: sandbox.SandboxResult, need_figure: bool) -> str:
    """'' if the run reported enough to support a results section, else what is missing."""
    missing = []
    if len(res.metrics) < 3:
        missing.append("at least 3 report() metrics")
    if not res.tables:
        missing.append("a report_table() results table")
    if need_figure and not res.figures:
        missing.append("at least one save_figure() figure")
    return ("it must report " + ", ".join(missing)) if missing else ""


def _identical_rows(res: sandbox.SandboxResult) -> str:
    """Two methods with byte-identical result cells almost always means one method's output was reused for another."""
    for t in res.tables:
        seen: dict[tuple, str] = {}
        for r in t["rows"]:
            cells = tuple(str(c).strip() for c in r[1:])
            if len(cells) >= 1 and any(re.search(r"\d", c) for c in cells) and cells in seen:
                return (f"in table '{t['title']}', '{seen[cells]}' and '{r[0]}' have identical results {list(cells)}: one method's "
                        "output is almost certainly reused for the other, or the component that distinguishes them never acts. "
                        "Check that each method computes its own predictions from its own inputs.")
            seen[cells] = str(r[0])
    return ""


def study_checks(res: sandbox.SandboxResult) -> str:
    if (dup := _identical_rows(res)):
        return dup
    main = max(res.tables, key=lambda t: len(t["rows"]), default=None)
    if main is None or len(main["rows"]) < 4:
        return ("the main results table must have one row per method: the proposed method, at least two baselines and the "
                "ablation (proposed method without its key component)")
    names = " ".join(res.metrics).lower()
    if not ("ci" in names or "conf" in names) or not re.search(r"(^|_)p($|_|val)", names.replace("pvalue", "p_value")):
        return ("report the paired comparison with the best baseline as metrics: mean difference, 95% CI low/high and a p-value "
                "(e.g. diff_mae_vs_gcn_mean, diff_mae_vs_gcn_ci_low, diff_mae_vs_gcn_ci_high, diff_mae_vs_gcn_p)")
    return ""


def _lead_float(cell: object) -> float | None:
    m = re.match(r"\s*[<>~≈]?\s*(-?\d+(?:\.\d+)?(?:e-?\d+)?)", str(cell))
    return float(m.group(1)) if m else None


def design_checks(res: sandbox.SandboxResult) -> str:
    """Operating characteristics a correct simulation must show. Reviewers spot violations at once."""
    for k, v in res.metrics.items():
        lk = k.lower()
        if re.search(r"(^|_)(fpr|false_?pos|type_?i(_|$)|type1|size_)", lk) and "assumed" not in lk and not 0.01 <= v <= 0.10:
            return (f"{k} = {v:.3f}: with alpha = 0.05 a valid test rejects a true null about 5% of the time (0.01-0.10 allowing "
                    "Monte Carlo error). This means the standard errors ignore the data structure (clustering / repeated "
                    "measures / paired seeds) or the null data still contain the effect. Use cluster-robust or person-level "
                    "inference that matches the data-generating process, and generate null data with the effect set to 0.")
        if "coverage" in lk and "assumed" not in lk and not 0.88 <= v <= 0.99:
            return (f"{k} = {v:.3f}: 95% intervals should cover the true value about 95% of the time (0.88-0.99). The interval "
                    "or its standard error is wrong (ignored clustering, wrong degrees of freedom, or the 'true value' compared "
                    "is not the estimand the model targets).")
    for t in res.tables:
        if "power" not in t["title"].lower() or len(t["rows"]) < 3:
            continue
        ns = [_lead_float(r[0]) for r in t["rows"]]
        if None in ns or ns != sorted(ns):
            continue                                   # not a power-by-N table
        for j in range(1, max(len(r) for r in t["rows"])):
            col = [_lead_float(r[j]) if j < len(r) else None for r in t["rows"]]
            if None in col:
                continue
            drops = [a - b for a, b in zip(col, col[1:])]
            if max(drops, default=0) > 0.06:
                return (f"in '{t['title']}', power in column '{t['header'][j] if j < len(t['header']) else j}' falls as N grows "
                        f"({col}). Power cannot decrease with sample size under a fixed effect: the estimator, the effect "
                        "used, or the data generation changes with N. Fix it so the same model and effect are used at every N.")
    names = " ".join(res.metrics).lower()
    if "power" not in names and not any("power" in t["title"].lower() for t in res.tables):
        return "report the power of each hypothesis at the planned sample size (report('power_h1_planned_n', ...)) and a power table"
    if not any(k.lower().startswith("assumed") for k in res.metrics):
        return "report every assumed input (effect sizes, variances, ICC, attrition) with report('assumed_<name>', value)"
    return ""


def _results_summary(res: sandbox.SandboxResult) -> str:
    tabs = "\n".join(f"TABLE {t['title']}: {t['header']} / " + " / ".join(map(str, t["rows"][:8])) for t in res.tables)
    return (f"PRINTED OUTPUT:\n{res.stdout[-2000:]}\nMETRICS: {dict(list(res.metrics.items())[:40])}\n{tabs}\n"
            f"FIGURES: {[c for _, c, _ in res.figures]}")


class _SimDesign(BaseModel):
    generator: str = Field(description="How synthetic data are generated: variables, distributions, structure, ground truth")
    stress: str = Field(description="How the stress / failure / design factor enters the data, and its levels")
    methods: list[str] = Field(description="Each method (or analysis) and exactly what it computes from which inputs")
    mechanism: str = Field(description="Why the key component should change the outcome here, and in which direction")
    metrics: list[str] = Field(description="Metrics, each computed on which data")
    sanity: list[str] = Field(description="Checks that would reveal a bug (e.g. at zero stress methods should agree)")


async def develop(system: str, task: str, *, prefer: list[str] | None = None, attempts: int = 5, critic_rounds: int = 1,
                  need_figure: bool = True, cpu: int = 75, wall: int = 120, say=None, label: str = "simulation",
                  checks=None, plan_first: bool = False) -> tuple[sandbox.SandboxResult | None, str, list[str]]:
    """Design -> write -> validate -> run -> check -> fix -> critique, like a researcher iterating in a notebook.
    Validation failures and failed sanity `checks` come back like runtime errors. Returns (best result, its code, log)."""
    log: list[str] = []
    if plan_first:
        try:
            d = await llm.complete_json(system + " First design the simulation precisely; code comes later.",
                                        task + "\n\nDo NOT write code yet. Design the simulation so that the proposed component "
                                        "has a real mechanism through which it can matter, and the baselines are fair.",
                                        _SimDesign, effort="high", max_tokens=6000, prefer=prefer)
            task += ("\n\nSIMULATION DESIGN TO IMPLEMENT EXACTLY:\n" + d.model_dump_json(indent=1)
                     + "\nPrint the sanity checks' values with print() so reviewers can verify them.")
            log.append("design: " + d.mechanism[:200])
        except llm.LLMError as e:
            log.append(f"design skipped: {e}"[:200])

    async def ask(prompt: str, tokens: int = 12000) -> str | None:
        try:
            return await write_code(system, prompt, prefer=prefer, tokens=tokens)
        except llm.LLMError as e:
            log.append(f"model error: {e}"[:200])
            return None

    code = await ask(task)
    best: tuple[sandbox.SandboxResult, str] | None = None
    critiques = 0
    for attempt in range(attempts):
        if code is None:
            break
        try:
            sandbox.validate(code)
            if say:
                await say("experimenter", "run", f"Running the {label} (attempt {attempt + 1})…")
            res = await asyncio.to_thread(sandbox.run, code, None, cpu, wall)
            if (gap := _enough(res, need_figure) or (checks(res) if checks else "")):
                raise sandbox.SandboxError(gap)
        except sandbox.SandboxError as e:
            log.append(f"attempt {attempt + 1}: {str(e)[:240]}")
            code = await ask(f"{task}\n\nCURRENT CODE:\n{code}\n\nIT FAILED WITH:\n{e}\n\nFix the cause and return the complete "
                             "script. If it timed out, cut replications, sample sizes or sweep levels, and vectorise.")
            continue
        best = (res, code)
        log.append(f"attempt {attempt + 1}: ran · {len(res.metrics)} metrics · {len(res.tables)} tables · {len(res.figures)} figures")
        if critiques >= critic_rounds:
            break
        try:
            cr = await llm.complete_json(CRITIC, f"{task}\n\nCODE:\n{code}\n\nRESULTS:\n{_results_summary(res)}", _Verdict,
                                         effort="medium", max_tokens=4000, prefer=prefer)
        except llm.LLMError:
            break
        critiques += 1
        log.append(f"critic {critiques}: {'sound' if cr.ok else '; '.join(cr.problems)[:240]}")
        if cr.ok or not cr.problems:
            break
        revised = await ask(f"{task}\n\nCURRENT CODE:\n{code}\n\nRESULTS IT PRODUCED:\n{_results_summary(res)}\n\n"
                            "A methods reviewer found these problems; fix every one and return the complete script:\n- "
                            + "\n- ".join(cr.problems))
        if revised is None:
            break
        code = revised                                 # the corrected script runs next; the last good run is kept if it fails
    return (best[0], best[1], log) if best else (None, "", log)


async def study(topic: str, method: str, summary: str, design: str, prefer: list[str] | None = None, say=None
                ) -> tuple[sandbox.SandboxResult | None, str, list[str]]:
    """A seeded, multi-baseline simulation with an ablation, a failure-regime sweep and paired statistics."""
    task = (f"Topic: {topic}\nProposed method: {method}\nMethod summary: {summary}\nFORMAL DESIGN (assumptions, claim, failure "
            f"regime, contributions):\n{design}\n\n{STUDY_RULES.replace('{budget}', '60')}")
    return await develop("You are a meticulous research engineer who writes correct, deterministic, vectorised simulation studies.",
                         task, prefer=prefer, say=say, label="controlled simulation study", checks=study_checks,
                         plan_first=True, critic_rounds=2, attempts=6)


async def design_study(topic: str, question: str, hypotheses: list[str], design: str, evidence: str,
                       prefer: list[str] | None = None, say=None) -> tuple[sandbox.SandboxResult | None, str, list[str]]:
    """Monte Carlo design analysis for an empirical study with no data yet: power, error rates, bias and coverage."""
    task = (f"Topic: {topic}\nResearch question: {question}\nHypotheses: {hypotheses}\nSTUDY DESIGN AND ANALYSIS PLAN:\n{design}\n\n"
            f"CITED EVIDENCE (use effect sizes stated here, else conventional values):\n{evidence[:5000]}\n\n"
            f"{DESIGN_RULES.replace('{budget}', '70')}")
    return await develop("You are a methodologist who writes fast, correct Monte Carlo design analyses.", task, prefer=prefer,
                         say=say, cpu=85, wall=130, label="simulation-based design analysis", checks=design_checks,
                         plan_first=True, critic_rounds=2, attempts=6)


async def _custom(topic: str, method: str, summary: str, plan: _Plan) -> tuple[sandbox.SandboxResult | None, str]:
    task = (f"Topic: {topic}\nProposed method: {method}\nMethod summary: {summary}\n"
            f"Simulation to build: {plan.custom_title or 'toy simulation of the core mechanism'} — {plan.custom_description}\n\n"
            f"{CODE_RULES.replace('{budget}', '40')}")
    res, _, log = await develop("You are a careful research engineer who writes small, correct, deterministic simulations.", task,
                                attempts=3, critic_rounds=0, need_figure=False, cpu=50, wall=80)
    return res, (log[-1] if log else "")


def _fmt_metric(v: float) -> str:
    if v == 0 or 1e-3 <= abs(v) < 1e5:
        return f"{v:.4g}"
    return f"{v:.3g}" if abs(v) >= 1e5 else ("< 0.001" if 0 < v < 1e-3 else f"{v:.2e}")


def _cell(c: object, is_p: bool) -> str:
    """Readable table cells: '±' not '+/-', p-values as '< 0.001', at most 4 significant figures."""
    t = str(c).replace("+/-", "±").replace("+-", "±").strip()
    try:
        v = float(t)
    except ValueError:
        return re.sub(r"(\d+\.\d{4})\d+", r"\1", t)        # long decimals inside text cells
    if is_p:
        return "< 0.001" if v < 0.001 else ("> 0.99" if v > 0.99 else f"{v:.3f}")
    return t if re.fullmatch(r"-?\d+", t) else _fmt_metric(v)


def _package(exp: Experiments, res: sandbox.SandboxResult, label: str, kind: str) -> None:
    """Executed results -> FACTS (one line per number, so writers can only quote what ran), tables and figures."""
    exp.facts.append(f"- {label}.")
    exp.facts += [f"- {k.replace('_', ' ')} = {_fmt_metric(v)}" for k, v in list(res.metrics.items())[:30]]
    parts = []
    for t in res.tables[:3]:
        head = [h.replace("|", "/") for h in t["header"]]
        is_p = [bool(re.search(r"(^|\W)p(-?val(ue)?)?($|\W)", h, re.I)) for h in head]
        rows = [[_cell(c, is_p[j] if j < len(is_p) else False).replace("|", "/") for j, c in enumerate(r[:len(head)])] for r in t["rows"]]
        parts.append(f"Table: {t['title']} ({kind}, executed in sandbox)\n| " + " | ".join(head) + " |\n|" + "---|" * len(head) + "\n"
                     + "\n".join("| " + " | ".join(r) + " |" for r in rows))
        exp.facts.append(f"- Table “{t['title']}” ({' | '.join(head)}): " + " ; ".join(", ".join(r) for r in rows[:12]))
    for k, (name, cap, png) in enumerate(res.figures[:3]):
        exp.figures[f"exp_sim{k}"] = (png, f"{cap} ({kind} executed by the pipeline)")
    exp.markdown = (exp.markdown + "\n\n" + "\n\n".join(parts)).strip()


async def run_design_for_paper(topic: str, question: str, hypotheses: list[str], design: str, evidence: str, say,
                               prefer: list[str] | None = None) -> Experiments:
    """Empirical study without data: a Monte Carlo design analysis of the planned analysis. Never raises."""
    exp = Experiments()
    await say("experimenter", "run", "Simulating the planned analysis: power, false-positive rate, bias and CI coverage…", 0.33)
    try:
        res, code, log = await design_study(topic, question, hypotheses, design, evidence, prefer, say)
    except Exception as e:  # noqa: BLE001 - experiments are optional; never break paper generation
        res, code, log = None, "", [f"{type(e).__name__}: {e}"[:200]]
    exp.report["design_log"] = log[-6:]
    if res:
        exp.report["design_study"] = True
        exp.code = code
        _package(exp, res, "Simulation-based design analysis (Monte Carlo replications of the planned analysis on data generated "
                 "from the study design; assumed inputs reported as 'assumed ...'; script executed in an isolated sandbox)",
                 "design simulation")
    else:
        exp.report["simulation_skipped"] = (log[-1] if log else "")[:200]
    await say("experimenter", "done", f"{len(exp.facts)} simulated results · {len(exp.figures)} figures" if exp.facts
              else "The design simulation could not run", 0.35)
    return exp


async def run_for_paper(topic: str, method: str, summary: str, say, design: str = "", prefer: list[str] | None = None) -> Experiments:
    """Plan, run and package pilot experiments. Never raises; returns an empty result if nothing could run."""
    try:
        plan = await llm.complete_json(
            "You design small, honest pilot experiments for a research paper using ONLY the options offered.",
            f"Topic: {topic}\nProposed method: {method}\nSummary: {summary}\n\n"
            f"Datasets: {DATASET_INFO}\nModels: {MODEL_NAMES}\n"
            "First judge relevance: is the paper's own task classification on data like one of these datasets? Then choose the public dataset most related to the topic (use a synthetic one if none fits), 3-5 contrasting models that "
            "make sense as baselines, one model whose key hyperparameter to sweep, whether a label-noise robustness study is "
            "relevant, a one-sentence rationale, and a title + 2-sentence description for ONE toy simulation of the proposed "
            "mechanism on synthetic data (what it compares and which metric).", _Plan, effort="low", tier="fast")
    except llm.LLMError:
        return Experiments()
    if plan.relevance == "direct":
        await say("experimenter", "run", f"Running pilot benchmark on {plan.dataset.replace('_', ' ')} ({len(plan.models)} models × 15 folds)…", 0.31)
        try:
            exp = await asyncio.to_thread(_run_vetted, plan, time.time() + 150)
        except Exception as e:   # noqa: BLE001 - experiments are optional; never break paper generation
            exp = Experiments(report={"error": f"{type(e).__name__}: {e}"[:200]})
    else:
        # A generic classification benchmark unrelated to the topic weakens the paper (every reviewer flags it), so skip it.
        exp = Experiments(report={"benchmark_skipped": f"no benchmark dataset matches the topic ({plan.relevance} relevance)"})
    if design:
        await say("experimenter", "run", "Running a controlled simulation study: method vs baselines, 10 seeds, ablation, stress sweep…", 0.33)
        res, code, log = await study(topic, method, summary, design, prefer, say)
        err = log[-1] if log else ""
        exp.report["study_log"] = log[-6:]
        if res:
            exp.report["study"] = True
            exp.code = code
    else:
        res, err = None, ""
    if not res:
        await say("experimenter", "run", "Writing and running a sandboxed toy simulation of the proposed mechanism…", 0.33)
        res, err = await _custom(topic, method, summary, plan)
    if res:
        label = ("Controlled simulation study (seeded synthetic data, proposed method vs baselines over 10 seeds, ablation and stress "
                 "sweep; script executed in an isolated sandbox)" if exp.report.get("study") else
                 f"Toy simulation (model-written script executed in an isolated sandbox): {plan.custom_title or 'mechanism simulation'}")
        _package(exp, res, label, "simulation study" if exp.report.get("study") else "toy simulation")
        exp.report["simulation"] = {"title": plan.custom_title, "metrics": len(res.metrics), "figures": len(res.figures)}
    else:
        exp.report["simulation_skipped"] = err[:200]
    n = len(exp.figures)
    await say("experimenter", "done", f"{len(exp.facts)} measured results · {n} result figures" if exp.facts else "No experiments could run", 0.35)
    return exp


def section(exp: Experiments, fig_block) -> str:
    """The results section for the executed simulation (or the pilot runs), assembled in code from measured results."""
    if not exp.facts:
        return ""
    figs = "\n\n".join(fig_block(k) for k in ("exp_sim0", "exp_sim1", "exp_bar", "exp_cm", "exp_sweep", "exp_noise") if k in exp.figures)
    if exp.report.get("design_study"):
        return ("# Simulation-Based Design Analysis\n\nBefore any data are collected, the planned analysis was evaluated by Monte Carlo "
                "simulation: datasets were generated from a model of the proposed design, with effect sizes and variances taken "
                "from the cited evidence where available, and the planned model was fitted to each one. This quantifies the "
                "statistical power, false-positive rate, bias and confidence-interval coverage the study can expect. Every number "
                "below was computed by the executed simulation script; the assumed inputs are listed with the results.\n\n"
                "## Results of the design simulation\n\n" + "\n".join(exp.facts) + "\n\n" + exp.markdown + "\n\n" + figs + "\n")
    if exp.report.get("study"):
        return ("# Simulation Study\n\nWe evaluate the proposed method in a controlled simulation that follows the formal setting "
                "and its assumptions: synthetic data are generated with known ground truth, the method is compared with baselines "
                "from the literature over ten random seeds, one key component is ablated, and a stress parameter is swept into the "
                "predicted failure regime. Differences are paired over seeds and reported with 95% confidence intervals. Every "
                "number in this section was computed by the executed simulation script.\n\n## Results\n\n"
                + "\n".join(exp.facts) + "\n\n" + exp.markdown + "\n\n" + figs + "\n")
    what = ("a toy simulation of the proposed mechanism on synthetic data" if "benchmark_skipped" in exp.report else
            "a small battery of pilot experiments on public benchmark data and a toy simulation of the proposed mechanism")
    return ("# Pilot Experiments\n\nTo ground the discussion in measured evidence, the pipeline executed " + what + ". These runs "
            "characterise the problem setting and the baselines; they are not a full-scale evaluation of the proposed method. "
            "All numbers in this section were computed by the executed code.\n\n"
            "## Measured results\n\n" + "\n".join(exp.facts) + "\n\n" + exp.markdown + "\n\n" + figs + "\n")
