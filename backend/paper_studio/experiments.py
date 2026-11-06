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
        fig, ax = plt.subplots(figsize=(6.4, 3.4))
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
        fig, ax = plt.subplots(figsize=(6.0, 3.2))
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


CODE_RULES = """Write ONE self-contained Python experiment script.
Allowed imports only: numpy, scipy, sklearn, pandas, matplotlib.pyplot, math, statistics, random, itertools, functools, collections.
No file, network or OS access. No open(), eval, exec, getattr, dunder attributes, np.save/np.load, read_csv, fetch_* or savefig.
Use a fixed random seed. Must finish in under 40 seconds on one CPU core (keep loops and data small: <= 5,000 samples).
Report results ONLY through these provided functions (do not import them):
  report(name: str, value: float)                      -> a scalar metric
  report_table(title: str, header: list, rows: list)   -> a small results table (<= 12 rows)
  save_figure(name: str, caption: str)                 -> saves the current matplotlib figure (max 2 figures)
Build a small toy simulation that illustrates the proposed mechanism against a simple baseline on synthetic data, and
report 3-8 metrics, one table and 1-2 clearly labelled figures (axis labels, legend, title). Return only the code."""


STUDY_RULES = """Write ONE self-contained Python script for a CONTROLLED SIMULATION STUDY of the proposed method.
Allowed imports only: numpy, scipy, sklearn, pandas, matplotlib.pyplot, math, statistics, random, itertools, functools, collections.
No file, network or OS access. No open(), eval, exec, getattr, dunder attributes, np.save/np.load, read_csv, fetch_* or savefig.
Must finish in under 45 seconds on one CPU core (synthetic data <= 3,000 samples per run; vectorise with numpy).
Report results ONLY through: report(name, value), report_table(title, header, rows) (<= 12 rows), save_figure(name, caption) (max 2).
The study MUST:
1. Generate synthetic data from a generator that matches the formal setting and assumptions (state them in comments).
2. Implement a faithful, simplified version of the proposed method AND at least two baselines named after families in the
   cited literature (e.g. a standard method and a strong simple heuristic).
3. Run every method over 5 random seeds and report mean and standard deviation of 2-3 metrics that match the hypotheses.
4. Run one ablation: the proposed method with its key component removed.
5. Run one sweep of a stress parameter into the failure regime described below, for the proposed method and the best baseline.
6. Report a results table (method x metric, cells 'mean ± std'), a sweep figure with error bars, and scalar metrics for the
   headline comparisons (e.g. 'proposed_minus_best_baseline_<metric>'). Use paired differences over the same seeds.
Report honestly whatever the numbers are, including when the proposed method does not win. Return only the code."""


async def study(topic: str, method: str, summary: str, design: str, prefer: list[str] | None = None) -> tuple[sandbox.SandboxResult | None, str]:
    """A seeded, multi-baseline simulation with an ablation and a failure-regime sweep. Up to three attempts."""
    prompt = (f"Topic: {topic}\nProposed method: {method}\nMethod summary: {summary}\nFORMAL DESIGN (assumptions, claim, failure "
              f"regime, contributions):\n{design}\n\n{STUDY_RULES}")
    err = ""
    for _ in range(3):
        try:
            code = (await llm.complete_json("You are a meticulous research engineer who writes correct, deterministic, vectorised simulation studies.",
                                            prompt + (f"\n\nThe previous attempt failed: {err}. Fix it and keep it fast." if err else ""),
                                            _Code, effort="medium", max_tokens=9000, prefer=prefer)).code
        except llm.LLMError as e:
            return None, f"model error: {e}"
        code = code.strip().removeprefix("```python").removeprefix("```").removesuffix("```").strip()
        try:
            res = await asyncio.to_thread(sandbox.run, code)
            if res.tables and len(res.metrics) >= 3:
                return res, ""
            err = "it must report a results table and at least 3 metrics"
        except sandbox.SandboxError as e:
            err = str(e)[:300]
    return None, err


async def _custom(topic: str, method: str, summary: str, plan: _Plan) -> tuple[sandbox.SandboxResult | None, str]:
    prompt = (f"Topic: {topic}\nProposed method: {method}\nMethod summary: {summary}\n"
              f"Simulation to build: {plan.custom_title or 'toy simulation of the core mechanism'} — {plan.custom_description}\n\n{CODE_RULES}")
    err = ""
    for attempt in range(2):
        try:
            code = (await llm.complete_json("You are a careful research engineer who writes small, correct, deterministic simulations.",
                                            prompt + (f"\n\nThe previous attempt failed: {err}. Fix it." if err else ""),
                                            _Code, effort="medium", max_tokens=6000)).code
        except llm.LLMError as e:
            return None, f"model error: {e}"
        code = code.strip().removeprefix("```python").removeprefix("```").removesuffix("```").strip()
        try:
            res = await asyncio.to_thread(sandbox.run, code)
            if res.metrics or res.tables:
                return res, ""
            err = "it reported no metrics"
        except sandbox.SandboxError as e:
            err = str(e)[:300]
    return None, err


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
        await say("experimenter", "run", "Running a controlled simulation study: method vs baselines, 5 seeds, ablation, stress sweep…", 0.33)
        res, err = await study(topic, method, summary, design, prefer)
        if res:
            exp.report["study"] = True
    else:
        res, err = None, ""
    if not res:
        await say("experimenter", "run", "Writing and running a sandboxed toy simulation of the proposed mechanism…", 0.33)
        res, err = await _custom(topic, method, summary, plan)
    if res:
        label = ("Controlled simulation study (seeded synthetic data, proposed method vs baselines, ablation and stress sweep; script executed in an isolated sandbox)"
                 if exp.report.get("study") else f"Toy simulation (model-written script executed in an isolated sandbox): {plan.custom_title or 'mechanism simulation'}")
        exp.facts.append(f"- {label}. "
                         + "; ".join(f"{k} = {v:.4g}" for k, v in list(res.metrics.items())[:8]) + ".")
        parts = []
        for t in res.tables[:2]:
            head = [h.replace("|", "/") for h in t["header"]]
            parts.append(f"Table: {t['title']} ({'simulation study' if exp.report.get('study') else 'toy simulation'}, executed in sandbox)\n| " + " | ".join(head) + " |\n|" + "---|" * len(head) + "\n"
                         + "\n".join("| " + " | ".join(c.replace("|", "/") for c in r[:len(head)]) + " |" for r in t["rows"]))
        for k, (name, cap, png) in enumerate(res.figures[:2]):
            exp.figures[f"exp_sim{k}"] = (png, f"{cap} ({'simulation study' if exp.report.get('study') else 'toy simulation'} executed by the pipeline)")
        exp.markdown = (exp.markdown + "\n\n" + "\n\n".join(parts)).strip()
        exp.report["simulation"] = {"title": plan.custom_title, "metrics": len(res.metrics), "figures": len(res.figures)}
    else:
        exp.report["simulation_skipped"] = err[:200]
    n = len(exp.figures)
    await say("experimenter", "done", f"{len(exp.facts)} measured results · {n} result figures" if exp.facts else "No experiments could run", 0.35)
    return exp


def section(exp: Experiments, fig_block) -> str:
    """The 'Pilot Experiments' section, assembled in code from the measured results."""
    if not exp.facts:
        return ""
    figs = "\n\n".join(fig_block(k) for k in ("exp_bar", "exp_cm", "exp_sweep", "exp_noise", "exp_sim0", "exp_sim1") if k in exp.figures)
    sim = ("a controlled simulation study (the proposed method against baselines over five seeds, with an ablation and a "
           "stress sweep into the predicted failure regime)" if exp.report.get("study") else "a toy simulation of the proposed mechanism")
    what = (f"{sim} on synthetic data" if "benchmark_skipped" in exp.report else
            f"a small battery of pilot experiments on public benchmark data and {sim}")
    return ("# Pilot Experiments\n\nTo ground the discussion in measured evidence, the pipeline executed " + what + ". These runs are illustrative: they "
            "characterise the problem setting and the baselines, and they are not a full-scale evaluation of the proposed method, "
            "which remains specified in the protocol below. All numbers in this section were computed by the executed code.\n\n"
            "## Measured results\n\n" + "\n".join(exp.facts) + "\n\n" + exp.markdown + "\n\n" + figs + "\n")
