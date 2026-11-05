"""Research dossier: what the writers know before they write.

1. Roundtable (STORM-style): four experts with different perspectives, chosen for this topic, each interrogate the reference
   corpus with their own questions and write cited notes.
2. Conflicts (PaperQA2 / ContraCrow-style): one atomic claim is extracted per cited abstract, then claims in tension are
   grouped into explicit disagreements with possible explanations.
3. Synthesis: a 2,500-3,500 word dossier (field map, findings by theme, agreements, conflicts, definitions, gap, candidate
   contributions) that every writer receives instead of a three-sentence brief. Longer, grounded overviews were shown to
   cut hallucinations sharply in PaperWrite-Bench (2026).
"""
from __future__ import annotations

import asyncio

from pydantic import BaseModel, Field

from backend.common.schemas import Paper
from backend.llm import client as llm


class _Persona(BaseModel):
    role: str = Field(description="e.g. 'clinical sleep researcher', 'ML systems engineer', 'sceptical methodologist'")
    focus: str
    questions: list[str] = Field(description="3 sharp questions this expert would ask of the literature")


class _Personas(BaseModel):
    personas: list[_Persona]


class _Claim(BaseModel):
    n: int
    claim: str = Field(description="The paper's single most important finding or position, as one plain sentence")


class _Claims(BaseModel):
    claims: list[_Claim]


class _Side(BaseModel):
    position: str
    refs: list[int]


class _Conflict(BaseModel):
    topic: str
    side_a: _Side
    side_b: _Side
    explanations: str = Field(description="Plausible reasons the findings differ: populations, measures, designs, settings, time")


class _Conflicts(BaseModel):
    conflicts: list[_Conflict]


def listing(refs: list[Paper], chars: int = 1400) -> str:
    return "\n".join(f"[{i}] {p.title} ({p.year}, {p.venue or 'n/a'}; cited {p.cited_by or 0}x)\n    {(p.abstract or '')[:chars]}"
                     for i, p in enumerate(refs, 1))


async def roundtable(topic: str, angle: str, refs: list[Paper], facts: str, say) -> list[tuple[_Persona, str]]:
    try:
        ps = await llm.complete_json(
            "You assemble a panel of four experts to interrogate the literature on a research topic. Pick perspectives that "
            "will disagree productively: at least one domain specialist, one methods expert, one practitioner or end-user "
            "voice, and one sceptic.", f"Topic: {topic}\nAuthor's angle: {angle or '(none)'}", _Personas, effort="low", tier="fast")
    except llm.LLMError:
        return []
    corpus = listing(refs)

    async def interview(p: _Persona) -> tuple[_Persona, str] | None:
        await say("roundtable", "run", f"{p.role} is questioning the literature…")
        try:
            notes = await llm.complete(
                f"You are a {p.role}. {p.focus}. You read the abstracts below closely and answer your questions using only what "
                "they establish, citing [n] for every point. Say explicitly when the literature is thin, inconsistent or silent. "
                "Write compact notes (400-600 words), no preamble.",
                f"TOPIC: {topic}\n\nYOUR QUESTIONS:\n" + "\n".join(f"- {q}" for q in p.questions)
                + f"\n\nMEASURED FACTS:\n{facts}\n\nLITERATURE:\n{corpus}", effort="low", max_tokens=1800, tier="fast")
            return p, notes.strip()
        except llm.LLMError:
            return None
    out = await asyncio.gather(*(interview(p) for p in ps.personas[:4]))
    return [x for x in out if x]


async def conflicts(refs: list[Paper]) -> list[dict]:
    """Disagreements in the corpus, each with both sides' citations."""
    batches = [list(enumerate(refs, 1))[i:i + 12] for i in range(0, len(refs), 12)]

    async def extract(batch) -> list[_Claim]:
        try:
            out = await llm.complete_json(
                "Extract each paper's single most important finding or position from its abstract, as one plain, specific "
                "sentence (include direction of effect, population or setting when stated). Use the paper's number as n.",
                "\n".join(f"[{i}] {p.title}\n{(p.abstract or '')[:1200]}" for i, p in batch), _Claims, effort="low", tier="fast")
            ok = {i for i, _ in batch}
            return [c for c in out.claims if c.n in ok]
        except llm.LLMError:
            return []
    claims = [c for lst in await asyncio.gather(*(extract(b) for b in batches)) for c in lst]
    if len(claims) < 4:
        return []
    try:
        out = await llm.complete_json(
            "You find genuine disagreements in a body of research: findings that point in opposite directions, conflicting "
            "estimates, or incompatible positions on the same question. Do not invent tension between papers that simply study "
            "different things. Return 0-5 conflicts; zero is a fine answer.",
            "\n".join(f"[{c.n}] {c.claim}" for c in claims), _Conflicts, effort="medium", tier="fast")
    except llm.LLMError:
        return []
    n = len(refs)
    res = []
    for c in out.conflicts[:5]:
        a = [r for r in c.side_a.refs if 1 <= r <= n]
        b = [r for r in c.side_b.refs if 1 <= r <= n]
        if a and b and not set(a) & set(b):
            res.append({"topic": c.topic, "a": {"position": c.side_a.position, "refs": a},
                        "b": {"position": c.side_b.position, "refs": b}, "explanations": c.explanations})
    return res


def conflicts_text(cs: list[dict]) -> str:
    if not cs:
        return "(no clear conflicts found in the corpus)"
    return "\n".join(f"- {c['topic']}: {c['a']['position']} {c['a']['refs']} vs. {c['b']['position']} {c['b']['refs']}. "
                     f"Possible explanations: {c['explanations']}" for c in cs)


async def synthesize(topic: str, angle: str, paper_type: str, refs: list[Paper], facts: str, notes: list[tuple[_Persona, str]],
                     cs: list[dict]) -> str:
    panel = "\n\n".join(f"### Notes from a {p.role}\n{t}" for p, t in notes) or "(no expert notes)"
    return (await llm.complete(
        "You are the lead author preparing a research dossier that a team of writers will rely on. Ground every statement in "
        "the literature abstracts, the expert notes or the measured facts, and cite [n] for literature. Be specific: name "
        "mechanisms, populations, methods and directions of effect. Never invent numbers.",
        f"TOPIC: {topic}\nAUTHOR'S ANGLE: {angle or '(none)'}\nPAPER TYPE: {paper_type}\n\nMEASURED FACTS:\n{facts}\n\n"
        f"EXPERT ROUNDTABLE:\n{panel}\n\nCONFLICTS FOUND:\n{conflicts_text(cs)}\n\nLITERATURE:\n{listing(refs, 700)}\n\n"
        "Write the dossier in Markdown with these ## sections: Field map (the main lines of work and how they relate); Key "
        "findings by theme (3-5 themes, each with what is established and by whom); Where the evidence agrees; Where it "
        "disagrees (use the conflicts); Definitions and terminology (the terms writers must use consistently); What the "
        "measured facts show; The gap (the most defensible open problem, with why prior work leaves it open); Candidate "
        "contributions (3-5 that this paper could honestly make). 2,000-2,800 words.",
        effort="medium", max_tokens=7000)).strip()
