"""Pilot experiments: the vetted battery produces real measured results, and the sandbox refuses escapes."""
import time

import pytest

from backend.paper_studio import sandbox
from backend.paper_studio.experiments import _Plan, _run_vetted, section


def test_vetted_battery_reports_measured_results():
    plan = _Plan(dataset="iris", models=["logistic_regression", "knn"], sweep_model="knn", noise_study=True, rationale="r")
    e = _run_vetted(plan, time.time() + 120)
    assert any("Logistic regression: accuracy" in f for f in e.facts)
    assert {"exp_bar", "exp_cm", "exp_sweep", "exp_noise"} <= set(e.figures)
    assert all(png[:8] == b"\x89PNG\r\n\x1a\n" for png, _ in e.figures.values())
    md = section(e, lambda k: f"[[{k}]]")
    assert md.startswith("# Pilot Experiments") and "not a full-scale evaluation" in md and "Table: Pilot benchmark results" in md


def test_sandbox_runs_good_code():
    r = sandbox.run("import numpy as np\nreport('mean', np.mean([1, 2, 3]))\nreport_table('t', ['a'], [[1]])")
    assert r.metrics == {"mean": 2.0} and r.tables[0]["rows"] == [["1"]]


@pytest.mark.parametrize("code", [
    "x = open('/etc/passwd').read()",
    "import os\nos.system('id')",
    "import subprocess",
    "import socket",
    "x = ().__class__.__bases__",
    "import numpy as np\nnp.load('/etc/passwd')",
    "import numpy as np\nf = getattr(np, 'load')",
    "x = '{0.__class__}'.format(1)",
    "import pandas as pd\npd.read_csv('/etc/passwd')",
    "from sklearn.datasets import fetch_openml",
    "from scipy.io import loadmat\nloadmat('/etc/hosts')",          # passes the static check, stopped at runtime
    "while True:\n    pass",                                          # CPU limit
])
def test_sandbox_blocks_escapes(code):
    with pytest.raises(sandbox.SandboxError):
        sandbox.run(code)


def test_autofix_repairs_common_slips_so_runs_are_not_wasted():
    from backend.paper_studio import sandbox
    code = ("```python\nimport warnings\nimport matplotlib.pyplot as plt\nwarnings.filterwarnings('ignore')\n"
            "def main():\n    fig, ax = plt.subplots(); ax.plot([1, 2]); fig.savefig('x.png', dpi=(300)); save_figure('a', 'cap')\n"
            "    plt.show()\n    report('m', 1.0)\nif __name__ == '__main__':\n    main()\n```")
    fixed = sandbox.autofix(code)
    sandbox.validate(fixed)                                   # no savefig, fences or guard left to reject
    res = sandbox.run(fixed)
    assert res.metrics == {"m": 1.0} and len(res.figures) == 1


def test_study_checks_catch_reused_outputs_and_missing_statistics():
    from backend.paper_studio import experiments, sandbox
    dup = sandbox.SandboxResult(metrics={"a": 1, "b": 2, "c": 3}, tables=[{"title": "Main", "header": ["M", "MSE"], "rows": [
        ["Ours", "23.7 ± 5.4"], ["GCN", "22.1 ± 5.0"], ["Persistence", "23.7 ± 5.4"], ["Ablation", "25.0 ± 5.1"]]}])
    assert "identical" in experiments.study_checks(dup)
    no_ci = sandbox.SandboxResult(metrics={"a": 1, "b": 2, "c": 3}, tables=[{"title": "Main", "header": ["M", "MSE"], "rows": [
        ["Ours", "1"], ["GCN", "2"], ["Mean", "3"], ["Ablation", "4"]]}])
    assert "CI" in experiments.study_checks(no_ci)
    ok = sandbox.SandboxResult(metrics={"diff_mse_vs_gcn_mean": -1, "diff_mse_vs_gcn_ci_low": -2, "diff_mse_vs_gcn_ci_high": 0,
                                        "diff_mse_vs_gcn_p": 0.03}, tables=no_ci.tables)
    assert experiments.study_checks(ok) == ""


def test_result_cells_are_formatted_for_print():
    from backend.paper_studio.experiments import _cell
    assert _cell("28.38 +/- 2.05", False) == "28.38 ± 2.05" and _cell("12.45821", False) == "12.46"
    assert _cell("0.000000", True) == "< 0.001" and _cell("1.0", True) == "> 0.99" and _cell("0.0412", True) == "0.041"


def test_placeholder_results_tables_are_dropped():
    from backend.paper_studio.studio import repair_fences
    md = "Text.\n\nTable: Planned comparison\n| Method | MAE | RMSE |\n|---|---|---|\n| Ours | to be measured | TBD |\n| Base | — | to be measured |\n\nMore."
    out = repair_fences(md)
    assert "to be measured" not in out and "Planned comparison" not in out and "More." in out
