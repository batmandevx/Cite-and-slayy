"""The paid tool itself: an AI agent sends references, the mandate decides, the wallet pays, CiteGuard answers."""
from __future__ import annotations

import uuid

from fastapi import HTTPException

from backend.agentpay import wallet as W
from backend.agentpay.mandate import decide
from backend.cache.store import get_store, now
from backend.citeguard.resolver import resolve_all
from backend.common.config import get_settings
from backend.documents.parser import RefEntry, parse_entry

# Statuses that are real answers. could_not_verify means a source was down: the agent gets that ref free.
BILLABLE = {"verified", "metadata_mismatch", "not_found"}


def price_cents(n_refs: int) -> int:
    return round(n_refs * get_settings().agent_price_per_ref_usd * 100)


def _app_url(path: str) -> str:
    return get_settings().public_url.rstrip("/") + path


def _request_matches(req: dict | None, uid: str, agent: str, refs: list[str]) -> bool:
    return bool(req and req["uid"] == uid and req["agent"] == agent and req["refs"] == refs)


async def verify(key: str | None, refs: list[str], request_id: str | None = None, check_retraction: bool = True) -> dict:
    refs = [r.strip()[:2000] for r in refs if r and r.strip()]
    if not refs:
        raise HTTPException(400, "Send at least one reference string")
    h, krec = W.key_record(key)
    uid, agent = krec["uid"], krec["name"]      # identity comes from the key, never from the request body
    store = get_store()
    cost = price_cents(len(refs))

    async with W.lock(uid):
        w = W.get_wallet(uid)
        m = W.mandate_of(w)
        req = store.get("agent_request", request_id) if request_id else None
        approved = _request_matches(req, uid, agent, refs) and req["status"] == "approved"
        verdict, reason = decide(m, agent=agent, n_refs=len(refs), cost_cents=cost, month_spent_cents=W.month_spent(w),
                                 approved=approved)
        if verdict == "deny":
            W.ledger_add(uid, "blocked", 0, w["balance_cents"], reason, agent=agent, refs=len(refs), cost_cents=cost)
            raise HTTPException(403, {"status": "denied", "reason": reason, "mandate": m.summary})
        if verdict == "approve":
            if not (req and _request_matches(req, uid, agent, refs) and req["status"] == "pending"):
                req = {"id": uuid.uuid4().hex[:12], "uid": uid, "agent": agent, "refs": refs, "cost_cents": cost,
                       "reason": reason, "status": "pending", "created_at": now().isoformat()}
                store.put("agent_request", req["id"], req)
                store.set_owner("agent_request", req["id"], uid)
                W.ledger_add(uid, "approval_requested", 0, w["balance_cents"], reason, agent=agent, refs=len(refs),
                             cost_cents=cost, request_id=req["id"])
            raise HTTPException(402, {"status": "needs_approval", "reason": reason, "request_id": req["id"],
                                      "approve_url": _app_url("/app?tab=agentpay"),
                                      "next": "Ask your owner to approve, then call again with the same references and request_id."})
        if w["balance_cents"] < cost and not await W.try_auto_reload(w, cost):
            W.ledger_add(uid, "insufficient_funds", 0, w["balance_cents"], f"Needed ${cost / 100:.2f}", agent=agent,
                         refs=len(refs), cost_cents=cost)
            raise HTTPException(402, {"status": "insufficient_funds", "balance_usd": w["balance_cents"] / 100,
                                      "cost_usd": cost / 100, "topup_url": _app_url("/app?tab=agentpay"),
                                      "next": "Ask your owner to top up the wallet with PayPal."})
        # Debit first (the hold), so two parallel calls can never spend the same cents.
        w["balance_cents"] -= cost
        w.setdefault("spent", {})[W.month()] = W.month_spent(w) + cost
        W.save_wallet(w)
        charge = W.ledger_add(uid, "charge", -cost, w["balance_cents"], f"CiteGuard check of {len(refs)} reference(s)",
                              agent=agent, refs=len(refs), cost_cents=cost)
        if req and approved:
            store.put("agent_request", req["id"], {**req, "status": "used", "used_at": now().isoformat()})
    W.touch_key(h, krec)

    entries = [RefEntry(index=i + 1, label=f"[{i + 1}]", number=i + 1, parsed=parse_entry(r)) for i, r in enumerate(refs)]
    try:
        checks = await resolve_all(entries, check_retraction=check_retraction)
    except Exception:  # noqa: BLE001 - never keep money for work that didn't happen
        async with W.lock(uid):
            w = W.get_wallet(uid)
            w["balance_cents"] += cost
            w["spent"][W.month()] = max(0, W.month_spent(w) - cost)
            W.save_wallet(w)
            W.ledger_add(uid, "credit", cost, w["balance_cents"], "Check failed on our side: full refund to wallet",
                         agent=agent, charge_id=charge["id"])
        raise HTTPException(503, "CiteGuard could not reach the scholarly databases. You were not charged.")

    results, unsettled = [], 0
    for (rc, _paper) in checks:
        billable = rc.status in BILLABLE
        unsettled += 0 if billable else 1
        results.append({
            "index": rc.ref_index, "reference": rc.parsed.raw, "status": rc.status, "retraction": rc.retraction,
            "matched": rc.matched.model_dump(include={"title", "doi", "year", "url"}) if rc.matched else None,
            "mismatches": [d.model_dump() for d in rc.mismatches],
            "charged": billable,
        })
    refund = price_cents(unsettled) if unsettled else 0
    async with W.lock(uid):
        w = W.get_wallet(uid)
        if refund:
            w["balance_cents"] += refund
            w["spent"][W.month()] = max(0, W.month_spent(w) - refund)
            W.save_wallet(w)
            W.ledger_add(uid, "credit", refund, w["balance_cents"],
                         f"{unsettled} reference(s) couldn't be settled (source down): refunded", agent=agent,
                         charge_id=charge["id"])
        balance = w["balance_cents"]

    counts: dict[str, int] = {}
    for r in results:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    flagged = sum(1 for r in results if r["status"] in ("not_found", "metadata_mismatch") or r["retraction"] in ("retracted", "expression_of_concern"))
    return {"status": "ok", "agent": agent, "charged_usd": (cost - refund) / 100, "refunded_usd": refund / 100,
            "balance_usd": balance / 100, "summary": counts, "flagged": flagged, "results": results}


def decide_request(uid: str, request_id: str, approve: bool) -> dict:
    store = get_store()
    req = store.get("agent_request", request_id)
    if not req or req["uid"] != uid:
        raise HTTPException(404, "Request not found")
    if req["status"] != "pending":
        raise HTTPException(409, f"Request already {req['status']}")
    req.update(status="approved" if approve else "rejected", decided_at=now().isoformat())
    store.put("agent_request", request_id, req)
    w = W.get_wallet(uid)
    W.ledger_add(uid, "approved" if approve else "rejected", 0, w["balance_cents"],
                 f"Owner {'approved' if approve else 'rejected'} {req['agent']}'s ${req['cost_cents'] / 100:.2f} request",
                 agent=req["agent"], request_id=request_id)
    return req


def pending_requests(uid: str) -> list[dict]:
    store = get_store()
    reqs = [r for i in store.owned_ids("agent_request", uid) if (r := store.get("agent_request", i)) and r["status"] == "pending"]
    return sorted(({**r, "refs": len(r["refs"]), "preview": r["refs"][:3]} for r in reqs), key=lambda r: r["created_at"], reverse=True)
