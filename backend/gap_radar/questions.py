"""Grounded research questions for a chosen cluster.

The LLM sees a numbered list of real papers (the cluster's 15 most central + 5 from each of the
2 nearest clusters) and must cite them by number. Any question citing a number that is not on
the list is dropped and counted in `dropped`.
"""
from __future__ import annotations

from pydantic import BaseModel

from backend.cache.store import get_store
from backend.common.schemas import GapRadarResult, Paper, QuestionsResult, ResearchQuestion
from backend.gap_radar.pipeline import ref_of
from backend.llm import client as llm


class _Q(BaseModel):
    question: str
    rationale: str
    evidence_ids: list[int]


class _Qs(BaseModel):
    questions: list[_Q]


SYSTEM = """You propose research questions that fill gaps in a literature cluster.
Ground every question in the numbered papers provided: cite 2-4 of them by number in evidence_ids.
Never mention a paper that is not in the list. Prefer questions a small team could investigate in a few months.
Each rationale must say what the cited papers have done and what they leave open."""


class QuestionError(Exception):
    pass


async def generate(run_id: str, cluster_id: int) -> QuestionsResult:
    store = get_store()
    run = store.get("gap_run", run_id)
    ctxd = store.get("gap_context", run_id)
    if not run or not ctxd:
        raise QuestionError("unknown run")
    result = GapRadarResult.model_validate(run)
    cluster = next((c for c in result.clusters if c.cluster_id == cluster_id), None)
    c = ctxd.get(str(cluster_id))
    if cluster is None or c is None:
        raise QuestionError("unknown cluster")
    if not llm.available():
        raise QuestionError("No LLM configured; research questions need an LLM (set LLM_PROVIDER and key).")

    pool: list[Paper] = [Paper.model_validate(p) for p in c["papers"]]
    for ps in c["neighbours"].values():
        pool += [Paper.model_validate(p) for p in ps]
    listing = "\n".join(f"[{i}] {p.title} ({p.year}). {(p.abstract or '')[:500]}" for i, p in enumerate(pool, 1))
    prompt = (f"Field: {result.query}\nTarget cluster: {cluster.label}. {cluster.description}\n"
              f"Status: {cluster.classification} ({'; '.join(cluster.reasons)})\n"
              f"Papers [1]-[{len(c['papers'])}] are in the target cluster; the rest are from neighbouring clusters.\n\n"
              f"{listing}\n\nPropose exactly 3 research questions.")
    out = await llm.complete_json(SYSTEM, prompt, _Qs, effort="medium")
    questions, dropped = [], 0
    for q in out.questions:
        ids = [i for i in q.evidence_ids]
        if not ids or any(i < 1 or i > len(pool) for i in ids):
            dropped += 1
            continue
        questions.append(ResearchQuestion(text=q.question.strip(), rationale=q.rationale.strip(),
                                          evidence=[ref_of(pool[i - 1]) for i in dict.fromkeys(ids)]))
    res = QuestionsResult(run_id=run_id, cluster_id=cluster_id, questions=questions[:3], dropped=dropped)
    store.put("gap_questions", f"{run_id}:{cluster_id}", res)
    return res
