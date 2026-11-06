"""Spending mandates: the owner writes the rules for their AI agent in plain English; an LLM compiles them into numbers
the server enforces on every call. The model never decides a payment: it only proposes limits, every limit is clamped
to hard ceilings, and `decide()` is plain arithmetic.
"""
from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, Field

from backend.common.config import get_settings
from backend.llm import client as llm


class Mandate(BaseModel):
    monthly_cap_usd: float = Field(description="Most the agent may spend in one calendar month, in USD")
    per_call_cap_usd: float = Field(description="Most one single tool call may cost, in USD")
    max_refs_per_call: int = Field(description="Most references the agent may check in one call")
    approval_over_usd: float = Field(description="Calls costing more than this need the owner's approval first; 0 = never ask")
    auto_topup: bool = Field(description="May the wallet reload itself from the owner's saved PayPal account")
    auto_topup_amount_usd: float = Field(description="How much each automatic reload adds, in USD")
    allowed_agents: list[str] = Field(description="Agent names allowed to spend; empty list = every agent key")
    summary: str = Field(description="One sentence restating the rules in plain English")


DEFAULT = Mandate(monthly_cap_usd=20, per_call_cap_usd=2, max_refs_per_call=50, approval_over_usd=1,
                  auto_topup=False, auto_topup_amount_usd=10, allowed_agents=[],
                  summary="Up to $20 a month, at most $2 per call, ask me before any call over $1.")

SYSTEM = """You turn a person's plain-English spending rules for their AI research agent into a JSON mandate.
The agent pays per reference it asks CiteGuard to verify. Only use numbers the person states or clearly implies;
for anything they don't mention use these defaults: monthly cap 20, per-call cap 2, max refs per call 50,
approval over 1, auto top-up false, top-up amount 10, allowed agents [] (all). Amounts are USD.
"Ask me / check with me before X" sets approval_over_usd = X. "Never ask" sets it to 0.
"Reload / top up automatically" sets auto_topup true. Agent names are only the names the person writes."""


def clamp(m: Mandate) -> Mandate:
    s = get_settings()
    monthly = max(0.0, min(m.monthly_cap_usd, s.agent_max_monthly_usd))
    per_call = max(0.0, min(m.per_call_cap_usd, monthly))
    return Mandate(monthly_cap_usd=round(monthly, 2), per_call_cap_usd=round(per_call, 2),
                   max_refs_per_call=max(1, min(int(m.max_refs_per_call), 200)),
                   approval_over_usd=round(max(0.0, min(m.approval_over_usd, per_call)), 2),
                   auto_topup=bool(m.auto_topup),
                   auto_topup_amount_usd=round(max(5.0, min(m.auto_topup_amount_usd, s.agent_max_topup_usd, monthly or 5.0)), 2),
                   allowed_agents=[a.strip()[:40] for a in m.allowed_agents if a.strip()][:10],
                   summary=m.summary.strip()[:300])


_MONEY = r"\$\s?(\d+(?:\.\d{1,2})?)"


def parse_rules(text: str) -> Mandate:
    """No-LLM fallback: picks out the common phrasings. Good enough offline; the LLM handles everything else."""
    t = text.lower()
    m = DEFAULT.model_copy()
    if x := re.search(_MONEY + r"[^.$]{0,25}(?:a|per|/|each)\s*month", t):
        m.monthly_cap_usd = float(x.group(1))
    if x := re.search(_MONEY + r"[^.$]{0,25}(?:per|a|each|/)\s*(?:call|request|check run)", t):
        m.per_call_cap_usd = float(x.group(1))
    if x := re.search(r"(?:ask|check with|approve|approval)[^.$]{0,30}(?:over|above|more than)\s*" + _MONEY, t):
        m.approval_over_usd = float(x.group(1))
    if re.search(r"never ask|don'?t ask|no approval", t):
        m.approval_over_usd = 0
    if x := re.search(r"(\d+)\s*(?:refs|references|citations)\s*(?:per|a|each)\s*call", t):
        m.max_refs_per_call = int(x.group(1))
    if re.search(r"(?:auto|automatically)[- ]?(?:top|reload|refill)", t) or "top up automatically" in t:
        m.auto_topup = True
        if x := re.search(r"(?:top[- ]?up|reload|refill)[^.$]{0,20}" + _MONEY, t):
            m.auto_topup_amount_usd = float(x.group(1))
    if x := re.search(r"only (?:my |the )?([\w\- ,]+?) agents?\b", t):
        m.allowed_agents = [a.strip() for a in re.split(r",|\band\b", x.group(1)) if a.strip()]
    m.summary = text.strip()[:300] or DEFAULT.summary
    return m


async def compile_rules(text: str) -> tuple[Mandate, str]:
    """(mandate, engine). Falls back to the regex parser when no model is reachable."""
    text = text.strip()[:2000]
    if not text:
        return clamp(DEFAULT), "default"
    if llm.available():
        try:
            m = await llm.complete_json(SYSTEM, f"Rules:\n{text}", Mandate, effort="low", max_tokens=800, tier="fast")
            return clamp(m), "ai"
        except llm.LLMError:
            pass
    return clamp(parse_rules(text)), "rules"


Verdict = Literal["allow", "approve", "deny"]


def decide(m: Mandate, *, agent: str, n_refs: int, cost_cents: int, month_spent_cents: int,
           approved: bool = False) -> tuple[Verdict, str]:
    """Pure policy check, run before any money moves. `approved` = the owner already said yes to this exact request."""
    if m.allowed_agents and agent.lower() not in {a.lower() for a in m.allowed_agents}:
        return "deny", f"Agent '{agent}' is not on this wallet's allowed list ({', '.join(m.allowed_agents)})."
    if n_refs > m.max_refs_per_call:
        return "deny", f"{n_refs} references in one call; the mandate allows {m.max_refs_per_call}."
    if cost_cents > round(m.per_call_cap_usd * 100):
        return "deny", f"This call costs ${cost_cents / 100:.2f}; the per-call cap is ${m.per_call_cap_usd:.2f}."
    if month_spent_cents + cost_cents > round(m.monthly_cap_usd * 100):
        left = max(0, round(m.monthly_cap_usd * 100) - month_spent_cents)
        return "deny", f"Monthly cap of ${m.monthly_cap_usd:.2f} reached (${left / 100:.2f} left this month)."
    if m.approval_over_usd and cost_cents > round(m.approval_over_usd * 100) and not approved:
        return "approve", f"${cost_cents / 100:.2f} is over your ${m.approval_over_usd:.2f} ask-me-first limit."
    return "allow", "Within the mandate."
