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
