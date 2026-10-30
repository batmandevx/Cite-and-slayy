"""Workspace storage, paper export (LaTeX / Word, IEEE / Springer) and the tortured-phrase game."""
import io

from fastapi.testclient import TestClient

from backend.app import export
from backend.app.main import app
from backend.citeguard.phrases import load_phrases

client = TestClient(app)


def test_workspace_roundtrip_and_validation():
    items = [{"id": "a", "text": "Run 3 seeds", "done": False}]
    assert client.put("/api/workspace/todos", json={"items": items}).status_code == 200
    assert client.get("/api/workspace/todos").json()["items"] == items
    assert client.get("/api/workspace/secrets").status_code == 404


def test_latex_export_uses_venue_class_and_keeps_structure():
    md = export.PAPER_TEMPLATE
    ieee = export.to_latex(md, "T", "ieee", "A", "U")
    springer = export.to_latex(md, "T", "springer", "A", "U")
    assert "IEEEtran" in ieee and "llncs" in springer
    for tex in (ieee, springer):
        assert "\\begin{equation" in tex and "\\begin{tabular" in tex and "\\end{document}" in tex


def test_docx_export_is_a_word_file():
    r = client.post("/api/export/docx", json={"title": "T", "markdown": "# H\n\n| a | b |\n|---|---|\n| 1 | 2 |\n", "template": "ieee"})
    assert r.status_code == 200 and r.content[:2] == b"PK"
    from docx import Document
    doc = Document(io.BytesIO(r.content))
    assert len(doc.tables) == 1


def test_tortured_game_answers_come_from_curated_list():
    pairs = {(p.tortured, p.expected) for p in load_phrases()}
    qs = client.get("/api/games/tortured?n=5").json()
    assert len(qs) == 5
    for q in qs:
        assert (q["tortured"], q["answer"]) in pairs
        assert q["answer"] in q["choices"] and len(set(q["choices"])) == 4 and q["source"].startswith("http")
