"""Dashboard data: real activity and results from this instance's store (no synthetic numbers)."""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date, datetime, timedelta

from backend.cache.store import get_store
from backend.documents import service as docs


def _day(ts: str | None) -> str | None:
    try:
        return datetime.fromisoformat(str(ts).replace("Z", "+00:00")).astimezone().date().isoformat()
    except (TypeError, ValueError):
        return None


def _streaks(per_day: dict[str, Counter], today: date) -> tuple[int, int, dict | None]:
    active = sorted(d for d, c in per_day.items() if sum(c.values()) > 0)
    if not active:
        return 0, 0, None
    active_dates = [date.fromisoformat(d) for d in active]
    active_set = set(active_dates)

    # Current streak (active today or yesterday keeps streak alive)
    cur = 0
    cursor = today if today in active_set else (today - timedelta(days=1) if (today - timedelta(days=1)) in active_set else None)
    while cursor and cursor in active_set:
        cur += 1
        cursor -= timedelta(days=1)

    # Longest streak
    longest, run = 1, 1
    for prev, nxt in zip(active_dates, active_dates[1:]):
        if (nxt - prev).days == 1:
            run += 1
            longest = max(longest, run)
        else:
            run = 1

    best_d = max(active, key=lambda d: sum(per_day[d].values()))
    return cur, longest, {"date": best_d, "total": sum(per_day[best_d].values())}


def build(user: dict | None = None) -> dict:
    from backend.accounts.auth import LOCAL_USER, visible, workspace_key
    user = user or LOCAL_USER
    store = get_store()
    gap_runs = visible("gap_run", store.list("gap_run", 2000), "run_id", user)
    audits = visible("audit", store.list("audit", 2000), "audit_id", user)
    verdicts = visible("verdict", store.list("verdict", 2000), "review_id", user)
    drafts = visible("autoclaw_run", store.list("autoclaw_run", 2000), "run_id", user)
    chats = visible("agent_chat", store.list("agent_chat", 2000), "chat_id", user)

    today = date.today()
    # activity per day, last 26 weeks
    since = today - timedelta(days=7 * 26)
    per_day: dict[str, Counter] = defaultdict(Counter)
    for kind, items in (("scan", gap_runs), ("audit", audits), ("verdict", verdicts), ("draft", drafts)):
        for it in items:
            d = _day(it.get("created_at"))
            if d and d >= since.isoformat():
                per_day[d][kind] += 1

    tool_counts: Counter[str] = Counter()
    for c in chats:
        for m in c.get("messages", []):
            d = _day(m.get("at"))
            if d and d >= since.isoformat() and m.get("role") == "user":
                per_day[d]["chat"] += 1
            if m.get("role") == "assistant":
                for t in m.get("tools", []):
                    if t.get("name"):
                        tool_counts[t["name"]] += 1

    activity = [{"date": d, "total": sum(c.values()), **c} for d, c in sorted(per_day.items())]
    cur_streak, longest_streak, best_day = _streaks(per_day, today)

    # 12-week velocity timeline (Monday-aligned buckets)
    monday = today - timedelta(days=today.weekday())
    weekly_velocity = []
    cum = 0
    for w in range(11, -1, -1):
        wk_start = monday - timedelta(weeks=w)
        wk_end = wk_start + timedelta(days=6)
        bucket: Counter[str] = Counter()
        for offset in range(7):
            iso = (wk_start + timedelta(days=offset)).isoformat()
            if iso in per_day:
                bucket.update(per_day[iso])
        tot = sum(bucket.values())
        cum += tot
        weekly_velocity.append({
            "week": wk_start.strftime("%b %d"),
            "end": wk_end.isoformat(),
            "scan": bucket.get("scan", 0),
            "draft": bucket.get("draft", 0),
            "audit": bucket.get("audit", 0),
            "verdict": bucket.get("verdict", 0),
            "chat": bucket.get("chat", 0),
            "total": tot,
            "cumulative": cum,
        })

    latest_audit: dict[str, dict] = {}
    for a in audits:  # newest first
        latest_audit.setdefault(a["document_id"], a)

    papers = []
    ref_status = Counter()
    term_pcts: dict[str, list[float]] = defaultdict(list)
    claim_labels: Counter[str] = Counter()
    total_phrases = 0
    total_overlaps = 0

    for doc_id, a in latest_audit.items():
        try:
            info = docs.info(doc_id)
            title = info.title or info.filename
        except docs.DocumentError:
            title = doc_id
        s = a["summary"]
        for k in ("verified", "metadata_mismatch", "not_found", "could_not_verify"):
            ref_status[k] += s.get(k, 0)
        for cl in a.get("claims", []):
            if cl.get("label"):
                claim_labels[cl["label"]] += 1
        total_phrases += len(a.get("phrases", []))
        total_overlaps += len(a.get("overlaps", []))
        for st in a.get("score_terms", []):
            mx = st.get("max") or 0
            val = st.get("value")
            if mx > 0 and isinstance(val, (int, float)):
                term_pcts[st["name"]].append(max(0.0, min(100.0, 100.0 * float(val) / float(mx))))
        if s.get("self_retracted"):
            term_pcts["Retraction safety"].append(0.0)
        else:
            term_pcts["Retraction safety"].append(max(0.0, 100.0 - 25.0 * float(s.get("retracted_cited", 0))))
        papers.append({
            "document_id": doc_id,
            "audit_id": a["audit_id"],
            "title": title,
            "score": a["score"],
            "references": s.get("references", 0),
            "verified": s.get("verified", 0),
            "not_found": s.get("not_found", 0),
            "retracted_cited": s.get("retracted_cited", 0),
            "self_retracted": bool(s.get("self_retracted")),
            "phrases": len(a.get("phrases", [])),
            "overlaps": len(a.get("overlaps", [])),
            "created_at": a["created_at"],
        })

    score_radar = [
        {"axis": label, "pct": round(sum(vals) / len(vals), 1)}
        for key, label in (
            ("References", "References"),
            ("Retraction safety", "Retraction safety"),
            ("Claim support", "Claim support"),
            ("Tortured phrases", "Clean prose"),
            ("Overlap", "Originality"),
        )
        for vals in [term_pcts.get(key, [])]
        if vals
    ]

    latest_verdict: dict[str, dict] = {}
    for v in verdicts:
        latest_verdict.setdefault(v["document_id"], v)
    decisions = Counter(v["decision"] for v in latest_verdict.values())

    persona_scores: dict[str, list[float]] = defaultdict(list)
    for v in latest_verdict.values():
        for pr in v.get("personas", []):
            if pr.get("score") is not None and not str(pr.get("persona", "")).startswith("Venue:"):
                persona_scores[pr["persona"]].append(float(pr["score"]))
    persona_radar = [
        {"persona": k, "avg": round(sum(vs) / len(vs), 2), "n": len(vs)}
        for k, vs in persona_scores.items()
    ]

    gap = None
    if gap_runs:
        r = gap_runs[0]
        gap = {"run_id": r["run_id"], "query": r["query"], "n_papers": r["n_papers"],
               "classes": Counter(c["classification"] for c in r["clusters"]),
               "clusters": [{"label": c["label"], "size": c["size"], "classification": c["classification"],
                             "growth": c["growth"], "cites_per_year": c.get("cites_per_year", 0)} for c in r["clusters"]]}

    feed = []
    for r in gap_runs[:8]:
        feed.append({"kind": "scan", "title": f"Gap Radar: “{r['query']}” · {r['n_papers']} papers", "at": r["created_at"], "ids": {"gap": r["run_id"]}})
    for p in papers:
        feed.append({"kind": "audit", "title": f"Audited “{p['title'][:70]}” · {p['score']:.0f}/100", "at": p["created_at"],
                     "ids": {"doc": p["document_id"], "audit": p["audit_id"]}})
    for v in list(latest_verdict.values())[:8]:
        feed.append({"kind": "verdict", "title": f"Verdict: {v['decision'].replace('_', ' ')}", "at": v["created_at"],
                     "ids": {"doc": v["document_id"], "audit": v.get("audit_id"), "review": v["review_id"]}})
    for d in drafts[:5]:
        feed.append({"kind": "draft", "title": f"Draft: {d['topic'][:70]}", "at": d["created_at"], "ids": {"doc": d.get("document_id")}})
    for c in chats[:6]:
        if c.get("messages"):
            feed.append({"kind": "chat", "title": f"Azora AI: “{c.get('title', 'Research session')[:64]}”",
                         "at": c["messages"][-1].get("at") or c.get("created_at", ""),
                         "ids": {"chat": c["chat_id"]}})
    feed.sort(key=lambda x: str(x["at"]), reverse=True)

    pages = (store.get("workspace", workspace_key("pages", user)) or {}).get("items", [])
    stickies = (store.get("workspace", workspace_key("stickies", user)) or {}).get("items", [])
    todos = (store.get("workspace", workspace_key("todos", user)) or {}).get("items", [])

    seen_q, mapped = set(), 0
    for r in gap_runs:
        if r["query"].lower() not in seen_q:
            seen_q.add(r["query"].lower())
            mapped += r["n_papers"]
    scores = [p["score"] for p in papers]
    return {
        "totals": {
            "papers_mapped": mapped, "scans": len(gap_runs), "drafts": len(drafts), "papers_audited": len(papers),
            "references_checked": sum(p["references"] for p in papers),
            "retractions_caught": sum(p["retracted_cited"] + int(p["self_retracted"]) for p in papers),
            "verdicts": len(latest_verdict), "avg_integrity": round(sum(scores) / len(scores), 1) if scores else None,
            "chats": len(chats),
            "phrases_caught": total_phrases,
            "overlaps_flagged": total_overlaps,
            "tool_runs": sum(tool_counts.values()),
        },
        "streaks": {
            "current": cur_streak,
            "longest": longest_streak,
            "active_days": sum(1 for c in per_day.values() if sum(c.values()) > 0),
            "best_day": best_day,
        },
        "activity": activity,
        "weekly_velocity": weekly_velocity,
        "ref_status": dict(ref_status),
        "claim_labels": dict(claim_labels),
        "score_radar": score_radar,
        "persona_radar": persona_radar,
        "decisions": dict(decisions),
        "papers": sorted(papers, key=lambda p: p["score"]),
        "gap": gap,
        "workspace": {
            "pages": len(pages),
            "stickies": len(stickies),
            "todos_total": len(todos),
            "todos_done": sum(1 for t in todos if t.get("done")),
            "tool_runs": sum(tool_counts.values()),
            "top_tools": [{"name": k, "count": n} for k, n in tool_counts.most_common(5)],
        },
        "feed": feed[:14],
    }
