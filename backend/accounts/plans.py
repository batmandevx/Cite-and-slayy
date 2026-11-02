"""Plans and limits. Prices in INR, GST-inclusive. Count limits are per calendar month unless the key ends in _day.

Every plan also has a hard monthly AI budget (`ai_budget_inr`), charged from the real token usage of each model call
(backend/llm/client.py `_charge`). It caps what one subscriber can cost us, so margins hold even if a paper turns out
more expensive than estimated:

    plan  price  net after GST (18%) & gateway (~2.4%)  max AI spend  min contribution to AWS + profit
    Pro   6,999  ~5,766                                  750           ~5,016 (87%)
    Max  12,999  ~10,709                                 4,000         ~6,709 (63%)

Fixed AWS cost (one t3.large + disk + IP, roughly ₹7–8k/month; check the AWS bill) is covered by about 2 Pro subscribers.
"""
from __future__ import annotations

PLANS: dict[str, dict] = {
    "free": {
        "name": "Free", "price_inr": 0, "engine": "standard", "ai_budget_inr": 12,
        "limits": {"papers": 1, "revisions": 0, "kits": 0, "decks": 0, "reviews": 0, "audits": 0, "fixes": 0,
                   "integrity_scans": 0, "humanize_fixes": 0, "scans": 0, "drafts": 0,
                   "chats_day": 3, "assists_day": 3},
        "perks": ["Preview 1 paper (opening sections, no downloads)", "3 Azora AI messages a day",
                  "Notes editor, library, research toolbox & 2 arcade games"],
    },
    "pro": {
        "name": "Pro", "price_inr": 6999, "engine": "premium", "ai_budget_inr": 750,
        "limits": {"papers": 3, "revisions": 8, "kits": 2, "decks": 3, "reviews": 2, "audits": 6, "fixes": 2,
                   "integrity_scans": 20, "humanize_fixes": 12, "scans": 6, "drafts": 1,
                   "chats_day": 40, "assists_day": 80},
        "perks": ["3 papers / month on the Azora Pro engine",
                  "20 Turnitin-style AI & Plagiarism line-highlighted reports",
                  "12 AI & Plagiarism Reducer / Humanizer rewrites + 2 audit fixes",
                  "8 AI revisions · 2 submission kits · 2 reviewer verdicts"],
    },
    "max": {
        "name": "Max", "price_inr": 12999, "engine": "premium", "ai_budget_inr": 4000,
        "limits": {"papers": 25, "revisions": 100, "kits": 40, "decks": 40, "reviews": 15, "audits": 150, "fixes": 60,
                   "integrity_scans": 250, "humanize_fixes": 150, "scans": 80, "drafts": 25,
                   "chats_day": 300, "assists_day": 600},
        "perks": ["25 monograph papers / month on the Pro engine, up to 34 references each",
                  "250 Turnitin-style AI & Plagiarism reports with highlighted source lines",
                  "150 AI & Plagiarism Reducer / Remover passes (before → after score proof)",
                  "100 AI revisions · 40 submission kits · 15 reviewer verdicts",
                  "Your own study papers as sources · priority generation"],
    },
}

# One-time "done-for-you" pack, on top of any plan. Net ~₹8,238 after GST and gateway; AI budget ₹2,500 -> ≥ ~₹5,700 left.
PAPER_PACK = {
    "id": "pack", "name": "Paper Pack", "price_inr": 9999, "days": 60,
    "grant": {"papers": 1, "revisions": 40, "reviews": 3, "audits": 10, "kits": 5, "decks": 3, "fixes": 10,
              "integrity_scans": 15, "humanize_fixes": 15},
    "ai_budget_inr": 2500,
    "perks": ["1 publish-ready monograph on the Pro engine, 34 verified references",
              "15 Turnitin-style AI & Plagiarism scans + 15 AI/Plag Reducer passes",
              "40 revisions: just tell us what to change",
              "3 reviewer verdicts + 10 CiteGuard audits + submission kit",
              "Journal / conference shortlist · LaTeX, Word & PDF · valid 60 days"],
}

FEATURE_LABEL = {
    "papers": "Paper Studio papers", "revisions": "AI revisions", "kits": "submission kits", "decks": "presentation decks",
    "fixes": "originality fixes", "integrity_scans": "AI & plagiarism similarity reports",
    "humanize_fixes": "AI & plagiarism reducer rewrites", "reviews": "reviewer verdicts",
    "audits": "CiteGuard citation audits", "scans": "field scans", "drafts": "drafting runs",
    "chats_day": "Azora AI messages today", "assists_day": "AI assists today",
    "exports": "Word, LaTeX & PDF downloads", "venues": "the journal & conference finder", "ideas": "AI research ideas", "ai_assist": "AI writing assist", "vision": "image understanding in Azora AI",
}
# Features that run the expensive models; blocked once the monthly AI budget is spent.
BUDGETED = {"papers", "revisions", "kits", "decks", "fixes", "integrity_scans", "humanize_fixes", "reviews", "audits", "scans", "drafts", "chats_day"}


def plan_of(user: dict | None) -> dict:
    """The user's active plan. A manually activated plan (UPI) lapses back to Free after its paid period."""
    u = user or {}
    exp = u.get("plan_expires")
    if exp and not u.get("is_owner"):
        from datetime import datetime, timezone
        try:
            if datetime.fromisoformat(exp) < datetime.now(timezone.utc):
                return PLANS["free"]
        except ValueError:
            pass
    return PLANS.get(u.get("plan") or "free", PLANS["free"])


def public_pack() -> dict:
    return {k: PAPER_PACK[k] for k in ("id", "name", "price_inr", "perks", "days")}


def public_plans() -> list[dict]:
    return [{"id": k, "name": v["name"], "price_inr": v["price_inr"], "perks": v["perks"], "limits": v["limits"],
             "engine": "Azora Pro engine" if v["engine"] == "premium" else "Azora standard engine"} for k, v in PLANS.items()]
