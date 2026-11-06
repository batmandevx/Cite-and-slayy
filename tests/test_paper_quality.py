"""Paper-quality pipeline pieces: paper types, citation handling, claim checks, literature selection, user data, plan API."""
import asyncio

import numpy as np
import pytest
from fastapi.testclient import TestClient

from backend.common.config import get_settings
from backend.common.schemas import Paper
from backend.paper_studio import literature, paper_types, quality, review, studio, userdata


def test_every_paper_type_has_a_coherent_plan():
    for key, plan in paper_types.PLANS.items():
        keys = [s.key for s in plan.sections]
        assert len(keys) == len(set(keys)), key
        assert plan.analysis_key in keys and plan.refs_table_key in keys, key
        assert any("[[FIG:trend]]" in s.task for s in plan.sections), key
        assert min(s.stage for s in plan.sections) == 1, key
        assert plan.sections[0].key == "intro" and plan.sections[0].stage == max(s.stage for s in plan.sections), key
    emp = paper_types.EMPIRICAL
    assert "results" not in [s.key for s in emp.active(False)] and "results" in [s.key for s in emp.active(True)]
    assert [k for k, *_ in studio.SECTIONS] == [s.key for s in paper_types.METHOD.active(False)]


def test_math_intervals_never_become_citations():
    md = "We bound $\\lambda \\in [0, 1]$ and $$x \\in [0,1]$$ and p lies in [0, 1], as shown in [3] and [2, 5]; bad [44]."
    fixed, removed = studio._fix_citations(md, 10)
    assert "$\\lambda \\in [0, 1]$" in fixed and "$$x \\in [0,1]$$" in fixed and "in [0, 1]," in fixed
    assert removed == 1 and "[44]" not in fixed
    renum, order = studio._renumber(fixed)
    assert order == [3, 2, 5] and "[0, 1]" in renum and "as shown in [1] and [2, 3]" in renum


def test_cited_sentences_and_repetition():
    md = ("# Introduction\n\nGraph models capture road topology [1]. Prior work combines recurrence and convolution [2, 3]. "
          "This sentence has no citation.\n\n$$a \\in [0, 1]$$\n\n# Related Work\n\nGraph models capture road topology very well in practice [1].\n\n"
          "# References\n\n1. A [9].\n")
    sents = quality.cited_sentences(md)
    assert [(h, n) for h, _, n in sents] == [("Introduction", [1]), ("Introduction", [2, 3]), ("Related Work", [1])]
    assert quality.repetition_rate(md) == 0.0
    dup = "# A\n\n" + "one two three four five six seven eight nine ten. " * 2 + "\n\n# B\n\none two three four five six seven eight nine ten.\n"
    assert quality.repetition_rate(dup) > 0.3


def test_check_all_claims_flags_unsupported_synthesis(monkeypatch):
    class J:
        def __init__(self, label):
            self.label, self.rationale = label, "r"

    async def fake_judge(items):
        return {i: J("unsupported" if "combined" in s else "supported") for i, s, *_ in items}
    monkeypatch.setattr(quality, "judge", fake_judge)
    md = "# Results\n\nThe effect is large in adolescents [1]. These findings combined prove causation [1, 2].\n"
    refs = [{"title": "A", "abstract": "abstract one"}, {"title": "B", "abstract": "abstract two"}]
    out = asyncio.run(quality.check_all_claims(md, refs))
    assert out["checked"] == 3 and out["supported"] == 1 and out["unsupported"] == 2
    assert out["synthesis_flags"] == ["These findings combined prove causation [1, 2]."]


def test_balanced_select_keeps_seminal_and_recent_and_seeds():
    pool = [Paper(id=f"W{i}", title=f"t{i}", year=2010 + i % 15, cited_by=(5000 if i == 39 else i), abstract="x" * 200) for i in range(40)]
    sims = np.linspace(1, 0, 40)               # W0 most relevant, W39 least (but most cited)
    seed = Paper(id="S1", title="seed", year=2020, abstract="y" * 200)
    picked = literature.balanced_select(pool, sims, 12, 2026, [seed], {"W30"})
    ids = [p.id for p in picked]
    assert ids[0] == "S1" and len(ids) == 12 and len(set(ids)) == 12
    assert "W39" in ids                          # seminal work kept despite low relevance rank
    assert sum(p.year >= 2023 for p in picked) >= 3


def test_cite_into_places_citation_before_full_stop():
    md = "Screens delay sleep onset. Other text."
    assert literature._cite_into(md, "Screens delay sleep onset.", 7) == "Screens delay sleep onset [7]. Other text."


def test_reviewer_issues_map_to_sections_by_quote():
    secs = [("Introduction", "# Introduction\nWe study traffic."), ("Proposed Method", "# Proposed Method\nThe update rule uses a decay of alpha.")]
    issues = [{"section": "Method", "quote": "the update rule uses a decay", "severity": "major"},
              {"section": "Intro", "quote": "not in the paper at all", "severity": "minor"}]
    by = review.issues_by_section(issues, secs)
    assert list(by) == ["Proposed Method", "Introduction"] or set(by) == {"Proposed Method", "Introduction"}
    assert by["Proposed Method"][0]["severity"] == "major"


def test_user_data_analysis_is_computed_not_generated():
    rng = np.random.default_rng(1)
    n = 80
    g = rng.choice(["a", "b"], n)
    x = rng.normal(0, 1, n)
    y = 2 * x + (g == "b") + rng.normal(0, 0.5, n)
    csv = "group,x,y\n" + "\n".join(f"{a},{b:.3f},{c:.3f}" for a, b, c in zip(g, x, y))
    t = userdata.parse_csv(csv.encode())
    assert t.n == n and t.kinds == {"group": "categorical", "x": "numeric", "y": "numeric"}
    A = userdata.Analysis
    res = userdata.run_analyses(t, userdata.AnalysisPlan(analyses=[
        A(kind="correlate", hypothesis="H1", outcome="y", predictors=["x"], rationale=""),
        A(kind="compare_groups", hypothesis="H2", outcome="y", predictors=["group"], rationale=""),
        A(kind="regress", hypothesis="H3", outcome="y", predictors=["missing_col"], rationale="")]))
    assert any("Pearson r" in f for f in res.facts) and any("Welch t" in f for f in res.facts)
    assert "Holm-adjusted" in res.facts[-1] and res.report["analyses"] == 2 and res.report["skipped"]
    with pytest.raises(userdata.DataError):
        userdata.parse_csv(b"a,b\n1,2\n")


@pytest.fixture
def client(monkeypatch):
    for k, v in {"AUTH_REQUIRED": "true", "DEV_SHOW_MAGIC_LINK": "true", "PUBLIC_URL": "http://testserver"}.items():
        monkeypatch.setenv(k, v)
    get_settings.cache_clear()
    from backend.app.main import app
    yield app
    get_settings.cache_clear()


def _login(app, email):
    c = TestClient(app)
    link = c.post("/api/auth/email/start", json={"email": email}).json()["dev_link"]
    c.get(link.replace("http://testserver", ""), follow_redirects=False)
    return c


def test_dataset_upload_and_plan_review_flow(client, monkeypatch):
    from backend.accounts import auth
    from backend.cache.store import get_store
    a, b = _login(client, "planner@example.com"), _login(client, "other@example.com")
    csv = "x,y\n" + "\n".join(f"{i},{2 * i + 1}" for i in range(10))
    r = a.post("/api/paper-studio/datasets", files={"file": ("d.csv", csv, "text/csv")})
    assert r.status_code == 200 and r.json()["rows"] == 10
    assert a.post("/api/paper-studio/datasets", files={"file": ("d.pdf", b"%PDF", "application/pdf")}).status_code == 400

    uid = a.get("/api/auth/me").json()["uid"]
    outline = {"title": "T", "research_question": "Q?", "contributions": ["c1"], "method_acronym": "", "method_name": "",
               "method_summary": "", "formal_assumptions": [], "formal_claim": "", "failure_boundary": "", "hypotheses": ["H1"],
               "themes": [], "thesis": "", "briefs": [{"key": "intro", "brief": "b", "refs": [1]}]}
    get_store().put("paper_plan", "pltest00001", {"plan_id": "pltest00001", "pid": "p1", "paper_type": "empirical",
                                                  "req": {"topic": "t"}, "outline": outline, "refs": [{"id": "W1", "title": "R", "year": 2020}],
                                                  "dossier": "d", "status": "planned"})
    get_store().set_owner("paper_plan", "pltest00001", uid)
    assert b.get("/api/paper-studio/plans/pltest00001").status_code == 404      # someone else's plan
    p = a.get("/api/paper-studio/plans/pltest00001").json()
    assert p["paper_type_label"] == "Empirical study" and p["sections"][0]["heading"] == "Introduction"

    async def fake_write(plan_id, edits, ctx):
        assert edits["title"] == "New title"
        return "p1"
    monkeypatch.setattr(studio, "write_from_plan", fake_write)
    assert a.post("/api/paper-studio/plans/pltest00001/write", json={"title": "New title"}).status_code == 200
    assert a.post("/api/paper-studio/plans/pltest00001/write", json={}).status_code == 409   # can't spend one credit twice
    assert auth.check_access  # imported for clarity


def test_sandbox_gives_code_its_dataset_and_nothing_else():
    from backend.paper_studio import sandbox
    csv = b"x,y\n" + b"\n".join(f"{i},{3 * i + 2}".encode() for i in range(40))
    res = sandbox.run("import numpy as np\ndf = load_data('d')\nprint(len(df))\nreport('slope', float(np.polyfit(df.x, df.y, 1)[0]))",
                      data={"d": csv})
    assert abs(res.metrics["slope"] - 3) < 1e-9 and res.stdout.strip() == "40"
    with pytest.raises(sandbox.SandboxError):
        sandbox.run("import pandas as pd\npd.read_csv('/etc/passwd')")
    with pytest.raises(sandbox.SandboxError):
        sandbox.run("df = load_data('../../etc/passwd')\nreport('n', len(df))", data={"d": csv})


def test_experiment_agent_fixes_errors_and_respects_the_critic(monkeypatch):
    from backend.paper_studio import experiment_agent as X
    from backend.paper_studio.datasets import Dataset
    csv = b"a,b\n" + b"\n".join(f"{i},{2 * i}".encode() for i in range(50))
    ds = Dataset(name="demo", csv=csv, rows=50, columns=["a", "b"], profile="a, b numeric", sources=[{"title": "Demo", "url": "u"}])
    calls = {"n": 0}
    broken = "df = load_data('demo')\nreport('x', undefined_name)"
    good = ("import numpy as np\ndf = load_data('demo')\nreport('corr_a_b', float(np.corrcoef(df.a, df.b)[0, 1]))\n"
            "report_table('Summary', ['n'], [[len(df)]])")

    async def fake(system, prompt, model, **kw):
        calls["n"] += 1
        if model is X._Code:
            return X._Code(code=good if "ERROR" in prompt else broken)
        return X._Critique(ok=True, problems=[], revised_code="")
    monkeypatch.setattr(X.llm, "complete_json", fake)
    out = asyncio.run(X.run(ds, "Is a related to b?"))
    assert any("corr a b = 1" in f for f in out.facts) and out.tables and out.report["critic_rounds"] == 1
    assert out.log[0].startswith("attempt 1:") and "ran" in out.log[1]
