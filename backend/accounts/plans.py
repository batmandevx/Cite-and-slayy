"""Plans and limits. Prices in INR, GST-inclusive. Count limits are per calendar month unless the key ends in _day.

Every plan also has a hard monthly AI budget (`ai_budget_inr`), charged from the real token usage of each model call
(backend/llm/client.py `_charge`). It caps what one subscriber can cost us, so margins hold even if a paper turns out
more expensive than estimated:

    plan  price  net after GST (18%) & gateway (~2.4%)  max AI spend  min contribution to AWS + profit
    Pro   2,499  ~2,059                                  700           ~1,359 (66%)
    Max   5,999  ~4,942                                  1,800         ~3,142 (64%)

Fixed AWS cost (one t3.large + disk + IP, roughly ₹7–8k/month; check the AWS bill) is covered by about 6 Pro subscribers.
"""
from __future__ import annotations

PLANS: dict[str, dict] = {
    "free": {
        "name": "Free", "price_inr": 0, "engine": "standard", "ai_budget_inr": 15,
        "limits": {"papers": 1, "revisions": 2, "reviews": 1, "audits": 3, "scans": 3, "drafts": 1,
                   "chats_day": 15, "assists_day": 15},
        "perks": ["1 full paper / month", "2 AI revisions", "3 integrity audits", "Journal & conference finder",
                  "Notes, library & arcade"],
    },
    "pro": {
        "name": "Pro", "price_inr": 2499, "engine": "premium", "ai_budget_inr": 700,
        "limits": {"papers": 10, "revisions": 30, "reviews": 6, "audits": 40, "scans": 25, "drafts": 8,
                   "chats_day": 100, "assists_day": 200},
        "perks": ["10 full papers / month on the Pro engine", "30 AI revisions: just say what to change",
                  "Use your own study papers as sources", "6 reviewer verdicts, 40 integrity audits",
                  "Word, LaTeX (IEEE / Springer) & PDF export", "Journal & conference finder"],
    },
    "max": {
        "name": "Max", "price_inr": 5999, "engine": "premium", "ai_budget_inr": 1800,
        "limits": {"papers": 25, "revisions": 100, "reviews": 15, "audits": 150, "scans": 80, "drafts": 25,
                   "chats_day": 300, "assists_day": 600},
        "perks": ["25 full papers / month on the Pro engine", "Longer papers with 30 references", "100 AI revisions",
                  "15 reviewer verdicts, 150 audits", "Everything in Pro, priority generation"],
    },
}

# One-time "done-for-you" pack, on top of any plan. Net ~₹8,238 after GST and gateway; AI budget ₹2,500 -> ≥ ~₹5,700 left.
PAPER_PACK = {
    "id": "pack", "name": "Paper Pack", "price_inr": 9999, "days": 60,
    "grant": {"papers": 1, "revisions": 40, "reviews": 3, "audits": 10},
    "ai_budget_inr": 2500,
    "perks": ["1 publish-ready paper on the Pro engine, 30 verified references", "40 revisions: just tell us what to change",
              "3 reviewer verdicts + 10 integrity audits before you submit", "Journal / conference shortlist for your paper",
              "IEEE, Springer, Word, LaTeX & PDF, figures and diagrams included", "Valid 60 days · one-time payment"],
}

FEATURE_LABEL = {
    "papers": "Paper Studio papers", "revisions": "AI revisions", "reviews": "reviewer verdicts", "audits": "integrity audits",
    "scans": "field scans", "drafts": "drafting runs", "chats_day": "Azora AI messages today", "assists_day": "AI assists today",
}
# Features that run the expensive models; blocked once the monthly AI budget is spent.
BUDGETED = {"papers", "revisions", "reviews", "audits", "scans", "drafts", "chats_day"}


def plan_of(user: dict | None) -> dict:
    return PLANS.get((user or {}).get("plan") or "free", PLANS["free"])


def public_pack() -> dict:
    return {k: PAPER_PACK[k] for k in ("id", "name", "price_inr", "perks", "days")}


def public_plans() -> list[dict]:
    return [{"id": k, "name": v["name"], "price_inr": v["price_inr"], "perks": v["perks"], "limits": v["limits"],
             "engine": "Azora Pro engine" if v["engine"] == "premium" else "Azora standard engine"} for k, v in PLANS.items()]
