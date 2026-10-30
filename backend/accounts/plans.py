"""Plans and limits. Prices in INR, GST-inclusive. Count limits are per calendar month unless the key ends in _day.

Every plan also has a hard monthly AI budget (`ai_budget_inr`), charged from the real token usage of each model call
(backend/llm/client.py `_charge`). It caps what one subscriber can cost us, so margins hold even if a paper turns out
more expensive than estimated:

    plan  price  net after GST (18%) & gateway (~2.4%)  max AI spend  min contribution to AWS + profit
    Pro   6,999  ~5,766                                  900           ~4,866 (84%)
    Max  12,999  ~10,709                                 4,000         ~6,709 (63%)

Fixed AWS cost (one t3.large + disk + IP, roughly ₹7–8k/month; check the AWS bill) is covered by about 2 Pro subscribers.
"""
from __future__ import annotations

PLANS: dict[str, dict] = {
    "free": {
        "name": "Free", "price_inr": 0, "engine": "standard", "ai_budget_inr": 12,
        "limits": {"papers": 1, "revisions": 1, "kits": 0, "reviews": 0, "audits": 1, "fixes": 0, "scans": 1, "drafts": 0,
                   "chats_day": 10, "assists_day": 10},
        "perks": ["1 paper / month (standard engine)", "1 originality & citation report", "1 AI revision",
                  "Notes, library & arcade"],
    },
    "pro": {
        "name": "Pro", "price_inr": 6999, "engine": "premium", "ai_budget_inr": 900,
        "limits": {"papers": 4, "revisions": 10, "kits": 3, "reviews": 2, "audits": 8, "fixes": 3, "scans": 8, "drafts": 2,
                   "chats_day": 50, "assists_day": 100},
        "perks": ["4 papers / month on the Pro engine", "8 originality & citation reports", "3 originality fixes (rewrite + cite)",
                  "10 AI revisions · 3 submission kits", "2 reviewer verdicts · journal finder"],
    },
    "max": {
        "name": "Max", "price_inr": 12999, "engine": "premium", "ai_budget_inr": 4000,
        "limits": {"papers": 25, "revisions": 100, "kits": 40, "reviews": 15, "audits": 150, "fixes": 60, "scans": 80, "drafts": 25,
                   "chats_day": 300, "assists_day": 600},
        "perks": ["25 papers / month on the Pro engine, 30 references each", "150 originality & citation reports",
                  "60 originality fixes: rewrite flagged passages in your own words, with citations",
                  "100 AI revisions · 40 submission kits (cover letter, checklist)", "15 reviewer verdicts · journal & conference finder",
                  "Your own study papers as sources · priority generation"],
    },
}

# One-time "done-for-you" pack, on top of any plan. Net ~₹8,238 after GST and gateway; AI budget ₹2,500 -> ≥ ~₹5,700 left.
PAPER_PACK = {
    "id": "pack", "name": "Paper Pack", "price_inr": 9999, "days": 60,
    "grant": {"papers": 1, "revisions": 40, "reviews": 3, "audits": 10, "kits": 5, "fixes": 10},
    "ai_budget_inr": 2500,
    "perks": ["1 publish-ready paper on the Pro engine, 30 verified references", "40 revisions: just tell us what to change",
              "3 reviewer verdicts + 10 originality reports + 10 originality fixes", "Submission kit: cover letter, declarations, checklist", "Journal / conference shortlist for your paper",
              "IEEE, Springer, Word, LaTeX & PDF, figures and diagrams included", "Valid 60 days · one-time payment"],
}

FEATURE_LABEL = {
    "papers": "Paper Studio papers", "revisions": "AI revisions", "kits": "submission kits", "fixes": "originality fixes", "reviews": "reviewer verdicts", "audits": "originality & citation reports",
    "scans": "field scans", "drafts": "drafting runs", "chats_day": "Azora AI messages today", "assists_day": "AI assists today",
}
# Features that run the expensive models; blocked once the monthly AI budget is spent.
BUDGETED = {"papers", "revisions", "kits", "fixes", "reviews", "audits", "scans", "drafts", "chats_day"}


def plan_of(user: dict | None) -> dict:
    return PLANS.get((user or {}).get("plan") or "free", PLANS["free"])


def public_pack() -> dict:
    return {k: PAPER_PACK[k] for k in ("id", "name", "price_inr", "perks", "days")}


def public_plans() -> list[dict]:
    return [{"id": k, "name": v["name"], "price_inr": v["price_inr"], "perks": v["perks"], "limits": v["limits"],
             "engine": "Azora Pro engine" if v["engine"] == "premium" else "Azora standard engine"} for k, v in PLANS.items()]
