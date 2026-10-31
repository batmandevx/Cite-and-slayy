"""Cite and Slayy API. Run: uv run uvicorn backend.app.main:app --reload --port 8000"""
from __future__ import annotations

import base64
import re
import uuid
from typing import Literal

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, RedirectResponse, StreamingResponse

from pydantic import BaseModel

from backend.agent import aurora
from fastapi.responses import Response

from backend.accounts import auth, billing
from backend.accounts.plans import PLANS as PLANS_, plan_of, public_pack, public_plans
from backend.app import dashboard, demo_papers, export as exporter, library, pipeline, reports
from backend.paper_studio import kit as kit_mod
from backend.paper_studio import studio
from backend.app.jobs import jobs
from backend.autoclaw_bridge import runner as claw
from backend.cache.store import get_store
from backend.citeguard.audit import run_audit
from backend.citeguard.phrases import load_phrases
from backend.common.config import ROOT, get_settings
from backend.common.schemas import (
    AuditReport, AuditRequest, AutoClawRequest, AutoClawRun, DocumentInfo, GapRadarRequest, GapRadarResult,
    Job, JobRef, JuryRequest, PageText, QuestionsResult, Verdict,
)
from backend.documents import service as docs
from backend.gap_radar import pipeline as gap
from backend.gap_radar import questions as gapq
from backend.jury.verdict import RULES, run_jury
from backend.llm import client as llm

app = FastAPI(title="Cite and Slayy", version="0.1.0")
from backend.autoclaw_bridge.llm_bridge import router as _claw_llm_router  # noqa: E402
app.include_router(_claw_llm_router)


@app.on_event("startup")
async def _seed_founders() -> None:
    if get_settings().auth_required:
        auth.ensure_founders()
    if get_settings().claw_url:
        claw.resume_live_runs()        # live AutoResearchClaw runs survive backend restarts and deploys
app.add_middleware(CORSMiddleware, allow_origins=get_settings().cors_origins.split(","),
                   allow_methods=["*"], allow_headers=["*"], allow_credentials=True)

# Endpoints anyone may call without signing in (landing page, sign-in itself, payment-provider webhooks, demo showcase PDFs).
PUBLIC = ("/api/health", "/api/stats", "/api/auth/", "/api/billing/plans", "/api/billing/webhook", "/api/demo-papers")


@app.middleware("http")
async def require_login(request: Request, call_next):
    path = request.url.path
    if get_settings().auth_required and path.startswith("/api/") and not path.startswith(PUBLIC) and request.method != "OPTIONS":
        user = auth.current_user(request)
        if not user:
            return JSONResponse({"detail": "Please sign in"}, status_code=401)
        aurora_ctx_user.set(user)
    return await call_next(request)


from backend.agent.tools import CURRENT_USER as aurora_ctx_user  # noqa: E402  (tools scope their lookups to this user)


def me(request: Request) -> dict:
    user = auth.require_user(request)
    llm.set_meter(user["uid"] if get_settings().auth_required else None)   # charge AI spend to this user
    aurora_ctx_user.set(user)
    return user


# ---------- auth ----------

@app.get("/api/auth/config")
async def auth_config():
    s = get_settings()
    return {"auth_required": s.auth_required, "google_client_id": s.google_client_id, "password_login": True,
            "email_login": auth.email_login_enabled(), "payments": billing.enabled()}


class GoogleLogin(BaseModel):
    credential: str


@app.post("/api/auth/google")
async def auth_google(body: GoogleLogin):
    info = await auth.verify_google(body.credential)
    user = auth.upsert_user(info["email"], info.get("name"), info.get("picture"), provider="google")
    resp = JSONResponse({"ok": True, "uid": user["uid"]})
    auth.set_session(resp, user["uid"])
    return resp


class EmailLogin(BaseModel):
    email: str


@app.post("/api/auth/email/start")
async def auth_email_start(body: EmailLogin):
    if not auth.email_login_enabled():
        raise HTTPException(400, "Email sign-in is not available")
    link = auth.start_magic_link(body.email)
    s = get_settings()
    if s.smtp_host and s.mail_from:
        import asyncio as _asyncio
        try:
            await _asyncio.to_thread(auth.send_magic_link, body.email.strip().lower(), link)
        except Exception as e:  # SMTP failures shouldn't leak server details
            raise HTTPException(502, "Couldn't send the email. Try Google sign-in or again later.") from e
        return {"sent": True}
    return {"sent": False, "dev_link": link}   # only when DEV_SHOW_MAGIC_LINK=true


@app.get("/api/auth/email/verify")
async def auth_email_verify(token: str):
    email = auth.consume_magic_link(token)
    user = auth.upsert_user(email, provider="email")
    resp = RedirectResponse(f"{get_settings().public_url.rstrip('/')}/app", status_code=303)
    auth.set_session(resp, user["uid"])
    return resp


class RegisterRequest(BaseModel):
    email: str
    password: str
    name: str = ""


def _ip(request: Request) -> str:
    # Caddy appends the real client address last; earlier entries can be forged by the client.
    fwd = request.headers.get("x-forwarded-for", "")
    return (fwd.split(",")[-1].strip() or (request.client.host if request.client else "unknown"))[:64]


def _session_response(user: dict) -> JSONResponse:
    resp = JSONResponse({"ok": True, "uid": user["uid"], "name": user.get("name")})
    auth.set_session(resp, user["uid"])
    return resp


@app.post("/api/auth/register")
async def auth_register(body: RegisterRequest, request: Request):
    import asyncio as _asyncio
    user = await _asyncio.to_thread(auth.register, body.email, body.name, body.password, _ip(request))
    return _session_response(user)


class LoginRequest(BaseModel):
    email: str
    password: str


@app.post("/api/auth/login")
async def auth_login(body: LoginRequest, request: Request):
    import asyncio as _asyncio
    user = await _asyncio.to_thread(auth.login_password, body.email, body.password, _ip(request))
    return _session_response(user)


class PasswordChange(BaseModel):
    current: str = ""
    new: str


@app.post("/api/account/password")
async def account_password(body: PasswordChange, request: Request):
    import asyncio as _asyncio
    user = await _asyncio.to_thread(auth.change_password, me(request), body.current, body.new)
    return _session_response(user)     # this browser stays signed in; every other session is revoked


class ProfileUpdate(BaseModel):
    name: str


@app.post("/api/account/profile")
async def account_profile(body: ProfileUpdate, request: Request):
    user = me(request)
    name = " ".join(body.name.split())[:60]
    if len(name) < 2:
        raise HTTPException(400, "Enter your name (at least 2 characters).")
    if user.get("uid") != "local":
        user["name"] = name
        get_store().put("user", user["uid"], user)
    return {"ok": True, "name": name}


@app.post("/api/account/logout-all")
async def account_logout_all(request: Request):
    auth.revoke_sessions(me(request))
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(auth.COOKIE, path="/")
    return resp


@app.post("/api/auth/logout")
async def auth_logout():
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(auth.COOKIE, path="/")
    return resp


@app.get("/api/auth/me")
async def auth_me(request: Request):
    user = auth.current_user(request)
    if not user:
        raise HTTPException(401, "Please sign in")
    owner = auth.is_owner(user)
    paid = auth.is_paid(user)
    plan = plan_of(user)
    return {
        "uid": user["uid"],
        "email": user["email"],
        "name": user.get("name"),
        "picture": user.get("picture"),
        "plan": "max" if owner else next((k for k, v in PLANS_.items() if v is plan), "free"),
        "plan_name": ("Founder · Unlimited" if user.get("founder") else "Dev Owner · Unlimited") if owner else plan["name"],
        "tier": ("founder" if user.get("founder") or owner else "max" if plan is PLANS_["max"] else "pro" if plan is PLANS_["pro"]
                 else "pack" if auth.bonus(user) else "free"),
        "is_owner": owner,
        "is_paid": paid,
        "limits": plan["limits"],
        "usage": auth.usage(user),
        "renews_at": user.get("renews_at") or user.get("plan_expires"),
        "cancel_at_period_end": user.get("cancel_at_period_end", False),
        "engine": "Azora Pro engine" if (owner or plan["engine"] == "premium") else "Azora standard engine",
        "ai_budget_used": 0.0 if owner else min(
            1.0,
            auth.ai_spend_inr(user) / max(1, plan["ai_budget_inr"] + (auth.bonus(user).get("ai_budget_inr", 0) if auth.bonus(user) else 0)),
        ),
        "pack": ({"credits": auth.bonus(user)["credits"], "expires": auth.bonus(user)["expires"]} if auth.bonus(user) else None),
    }


class OwnerUnlockRequest(BaseModel):
    key: str


@app.post("/api/auth/owner-unlock")
async def auth_owner_unlock(body: OwnerUnlockRequest, request: Request):
    import time as _time
    user = me(request)
    rl_key = f"owner-unlock:{user['uid']}"
    tries = [t for t in (get_store().get("rate", rl_key) or {}).get("ts", []) if t > _time.time() - 900]
    if len(tries) >= 5:
        raise HTTPException(429, "Too many attempts. Try again in 15 minutes.")
    get_store().put("rate", rl_key, {"ts": tries + [_time.time()]})
    if not auth.unlock_owner(user, body.key):
        raise HTTPException(403, "Invalid Dev Owner access key")
    return {"ok": True, "is_owner": True, "plan": "max", "plan_name": "Dev Owner · Unlimited"}


# ---------- billing ----------

@app.get("/api/billing/plans")
async def billing_plans():
    return {
        "plans": public_plans(),
        "pack": public_pack(),
        "payments": billing.enabled(),
        "upi_id": "8374579275@superyes",
        "currency": "INR",
    }


class UpiClaimRequest(BaseModel):
    item: str
    utr: str
    email: str = ""


@app.post("/api/billing/upi-claim")
async def billing_upi_claim(body: UpiClaimRequest, request: Request):
    import uuid as _uuid
    from backend.accounts.plans import PAPER_PACK, PLANS
    from backend.cache.store import now as store_now
    item = body.item.strip().lower()
    if item not in ("pro", "max", "pack"):
        raise HTTPException(400, "Unknown plan or pack")
    utr = "".join(ch for ch in body.utr if ch.isdigit())
    if len(utr) != 12:
        raise HTTPException(400, "Enter the 12-digit UPI transaction ID (UTR / UPI Ref No.) shown in your payment app")
    info = PAPER_PACK if item == "pack" else PLANS[item]
    user = me(request)                       # a claim must belong to a signed-in account so it can be activated
    store = get_store()
    if store.get("upi_utr", utr.upper()):
        raise HTTPException(409, "This UTR has already been submitted. If that wasn't you, contact support.")
    import time as _time
    rl_key = f"upi-claim:{user['uid']}"
    recent = [t for t in (store.get("rate", rl_key) or {}).get("ts", []) if t > _time.time() - 86400]
    if len(recent) >= 5:
        raise HTTPException(429, "Too many payment claims today. Contact support if you need help.")
    store.put("rate", rl_key, {"ts": recent + [_time.time()]})
    email = (body.email.strip()[:160] or user.get("email") or "").strip()
    cid = _uuid.uuid4().hex[:10]
    rec = {
        "claim_id": cid,
        "item": item,
        "item_name": info["name"],
        "amount_inr": info["price_inr"],
        "upi_id": "8374579275@superyes",
        "utr": utr,
        "email": email,
        "uid": (user or {}).get("uid"),
        "status": "pending_verification",
        "created_at": store_now().isoformat(),
    }
    store.put("upi_claim", cid, rec)
    store.put("upi_utr", utr.upper(), {"claim_id": cid})
    return {"ok": True, **rec}


# ---------- owner: review UPI payment claims ----------

def _owner(request: Request) -> dict:
    user = me(request)
    if not auth.is_owner(user):
        raise HTTPException(403, "Owner only")
    return user


@app.get("/api/admin/upi-claims")
async def admin_upi_claims(request: Request, status: str = "pending_verification"):
    _owner(request)
    rows = get_store().list("upi_claim", 500)
    return [r for r in rows if status == "all" or r.get("status") == status]


class ClaimDecision(BaseModel):
    note: str = ""


@app.post("/api/admin/upi-claims/{cid}/{decision}")
async def admin_upi_decide(cid: str, decision: str, body: ClaimDecision, request: Request):
    from datetime import timedelta
    from backend.cache.store import now as store_now
    boss = _owner(request)
    if decision not in ("approve", "reject"):
        raise HTTPException(400, "decision must be approve or reject")
    store = get_store()
    rec = store.get("upi_claim", cid)
    if not rec:
        raise HTTPException(404, "claim not found")
    if rec.get("status") != "pending_verification":
        raise HTTPException(409, f"claim already {rec.get('status')}")
    user = auth.get_user(rec["uid"]) if rec.get("uid") else None
    if decision == "approve":
        if not user:
            raise HTTPException(400, "claim has no account attached; ask the customer to sign in and resubmit")
        if rec["item"] == "pack":
            auth.grant_pack(user, f"upi-{cid}")
        else:
            base = store_now()
            try:   # extend from the current expiry if they renew early on the same plan
                from datetime import datetime
                cur = datetime.fromisoformat(user["plan_expires"]) if user.get("plan_expires") and user.get("plan") == rec["item"] else None
                if cur and cur > base:
                    base = cur
            except ValueError:
                pass
            user.update(plan=rec["item"], plan_expires=(base + timedelta(days=30)).isoformat(), plan_source="upi")
            store.put("user", user["uid"], user)
    rec.update(status="approved" if decision == "approve" else "rejected", decided_at=store_now().isoformat(), note=body.note[:300],
               decided_by=boss.get("email"))
    store.put("upi_claim", cid, rec)
    return rec


class SubscribeRequest(BaseModel):
    plan: str


@app.post("/api/billing/subscribe")
async def billing_subscribe(body: SubscribeRequest, request: Request):
    return await billing.subscribe(me(request), body.plan)


class VerifyRequest(BaseModel):
    razorpay_payment_id: str
    razorpay_subscription_id: str
    razorpay_signature: str


@app.post("/api/billing/verify")
async def billing_verify(body: VerifyRequest, request: Request):
    await billing.verify_checkout(me(request), body.razorpay_payment_id, body.razorpay_subscription_id, body.razorpay_signature)
    return {"ok": True}


@app.post("/api/billing/pack")
async def billing_pack(request: Request):
    return await billing.buy_pack(me(request))


class OrderVerify(BaseModel):
    razorpay_payment_id: str
    razorpay_order_id: str
    razorpay_signature: str


@app.post("/api/billing/pack/verify")
async def billing_pack_verify(body: OrderVerify, request: Request):
    await billing.verify_order(me(request), body.razorpay_order_id, body.razorpay_payment_id, body.razorpay_signature)
    return {"ok": True}


@app.post("/api/billing/cancel")
async def billing_cancel(request: Request):
    await billing.cancel(me(request))
    return {"ok": True}


@app.post("/api/billing/webhook")
async def billing_webhook(request: Request):
    billing.handle_webhook(await request.body(), request.headers.get("X-Razorpay-Signature"), request.headers.get("X-Razorpay-Event-Id"))
    return {"ok": True}


def _get(kind: str, id: str, model):
    d = get_store().get(kind, id)
    if not d:
        raise HTTPException(404, f"{kind} {id} not found")
    return model.model_validate(d)


@app.get("/api/health")
async def health():
    s = get_settings()
    return {"ok": True, "llm": llm.public_describe(), "demo_mode": s.demo_mode,
            "drafting_live": claw.live_available(),
            "s2_key": bool(s.s2_api_key), "contact_email": bool(s.contact_email),
            "tortured_phrases": len(load_phrases()), "verdict_rules": RULES}


@app.get("/api/stats")
async def stats():
    """Real totals from this instance's stored results (shown in the hero counters)."""
    store = get_store()
    gap_runs, seen_queries = [], set()
    for r in store.list("gap_run", 500):  # newest first: count each field once (its latest scan)
        q = r["query"].strip().lower()
        if q not in seen_queries:
            seen_queries.add(q)
            gap_runs.append(r)
    audits = store.list("audit", 1000)
    latest_by_doc: dict[str, dict] = {}
    for a in audits:  # newest first: keep the latest audit per document
        latest_by_doc.setdefault(a["document_id"], a)
    latest = list(latest_by_doc.values())
    return {
        "gap_scans": len(gap_runs),
        "papers_mapped": sum(r["n_papers"] for r in gap_runs),
        "papers_audited": len(latest),
        "references_checked": sum(a["summary"].get("references", 0) for a in latest),
        "retractions_caught": sum(a["summary"].get("retracted_cited", 0) + a["summary"].get("self_retracted", 0) for a in latest),
        "verdicts": len(store.list("verdict", 1000)),
    }


# ---------- jobs ----------

def _job_access(job_id: str, request: Request) -> None:
    if job_id not in jobs.jobs:
        raise HTTPException(404, "job not found")
    owner = jobs.owners.get(job_id)
    if get_settings().auth_required and owner and owner != me(request)["uid"]:
        raise HTTPException(404, "job not found")


@app.get("/api/jobs/{job_id}", response_model=Job)
async def job(job_id: str, request: Request):
    _job_access(job_id, request)
    return jobs.jobs[job_id]


@app.get("/api/jobs/{job_id}/events")
async def job_events(job_id: str, request: Request):
    _job_access(job_id, request)
    return StreamingResponse(jobs.stream(job_id), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ---------- documents ----------

@app.post("/api/documents", response_model=DocumentInfo)
async def upload(request: Request, file: UploadFile = File(...)):
    user = me(request)                                   # who is uploading, before reading anything
    auth._limit(f"upload:{user['uid']}", 60, 86400)
    data = await file.read(40 * 1024 * 1024 + 1)         # never buffer more than the cap
    if len(data) > 40 * 1024 * 1024:
        raise HTTPException(413, "File larger than 40 MB")
    try:
        info = docs.save_bytes(file.filename or "upload.pdf", data)
        auth.own("document", info.document_id, user)
        return info
    except docs.DocumentError as e:
        raise HTTPException(400, str(e))


@app.get("/api/demo-papers")
async def get_demo_papers():
    """Public metadata for the 20-page showcase research papers."""
    return demo_papers.list_public()


@app.get("/api/demo-papers/{slug}/pdf")
async def get_demo_paper_pdf(slug: str, download: bool = False):
    found = demo_papers.pdf_path(slug)
    if not found:
        raise HTTPException(404, "Demo paper not found")
    item, path = found
    disp = "attachment" if download else "inline"
    return FileResponse(
        path,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'{disp}; filename="{item["filename"]}"',
            "Cache-Control": "public, max-age=86400",
        },
    )


@app.post("/api/demo-papers/{slug}/import", response_model=DocumentInfo)
async def import_demo_paper(slug: str):
    import asyncio as _asyncio
    info = await _asyncio.to_thread(demo_papers.register_one, slug)
    if not info:
        raise HTTPException(404, "Demo paper not found")
    return info


@app.get("/api/documents/samples", response_model=list[DocumentInfo])
async def samples():
    """Register and list the bundled demo & showcase documents."""
    import asyncio as _asyncio

    def _load() -> list[DocumentInfo]:
        out = list(demo_papers.register_all())
        for p in sorted((ROOT / "demo" / "sample_pdfs").glob("*")) + [ROOT / "demo/autoclaw_run/deliverables/paper.pdf"]:
            if p.suffix.lower() in docs.ALLOWED and p.exists():
                out.append(docs.save_path(p, p.name if p.name != "paper.pdf" else "GARD_autoresearchclaw_showcase.pdf"))
        return out

    return await _asyncio.to_thread(_load)


@app.get("/api/documents/{document_id}", response_model=DocumentInfo)
async def document(document_id: str, request: Request):
    auth.check_access("document", document_id, me(request))
    try:
        return docs.info(document_id)
    except docs.DocumentError as e:
        raise HTTPException(404, str(e))


@app.get("/api/documents/{document_id}/text", response_model=list[PageText])
async def document_text(document_id: str, request: Request):
    auth.check_access("document", document_id, me(request))
    try:
        parsed = docs.get_parsed(document_id)
    except docs.DocumentError as e:
        raise HTTPException(404, str(e))
    return [PageText(page=i, text=t) for i, t in enumerate(parsed.pages)]


@app.get("/api/documents/{document_id}/file")
async def document_file(document_id: str, request: Request):
    auth.check_access("document", document_id, me(request))
    try:
        p = docs.path_for(document_id)
    except docs.DocumentError as e:
        raise HTTPException(404, str(e))
    return FileResponse(p, media_type="application/pdf" if p.suffix == ".pdf" else "text/plain")


# ---------- gap radar ----------

@app.post("/api/gap-radar/runs", response_model=JobRef)
async def gap_run(req: GapRadarRequest, request: Request):
    user = me(request)
    auth.require_paid(user, "scans")
    auth.consume(user, "scans")
    return JobRef(job_id=jobs.submit("gap_radar", lambda ctx: gap.run(req, ctx), owner=user["uid"],
                                     on_error=lambda: auth.refund(user, "scans")).job_id)


@app.get("/api/gap-radar/runs", response_model=list[GapRadarResult])
async def gap_runs(request: Request):
    return [GapRadarResult.model_validate(d) for d in auth.visible("gap_run", get_store().list("gap_run", 200), "run_id", me(request))[:20]]


@app.get("/api/gap-radar/runs/{run_id}", response_model=GapRadarResult)
async def gap_result(run_id: str, request: Request):
    auth.check_access("gap_run", run_id, me(request))
    return _get("gap_run", run_id, GapRadarResult)


@app.post("/api/gap-radar/runs/{run_id}/clusters/{cluster_id}/questions", response_model=QuestionsResult)
async def gap_questions(run_id: str, cluster_id: int, request: Request):
    auth.require_paid(me(request), "ideas")
    auth.check_access("gap_run", run_id, me(request))
    auth.consume(me(request), "assists_day")
    try:
        return await gapq.generate(run_id, cluster_id)
    except gapq.QuestionError as e:
        raise HTTPException(400, str(e))
    except llm.LLMError as e:
        raise HTTPException(502, f"LLM error: {e}")


# ---------- autoclaw ----------

@app.post("/api/autoclaw/runs", response_model=JobRef)
async def autoclaw_run(req: AutoClawRequest, request: Request):
    user = me(request)
    live = req.demo is False or (req.demo is None and not get_settings().demo_mode)
    if live and not auth.is_owner(user):
        raise HTTPException(403, "Live AutoResearchClaw runs are limited to founders. Use Paper Studio to write a paper.")
    auth.require_paid(user, "drafts")
    auth.consume(user, "drafts")
    return JobRef(job_id=jobs.submit("autoclaw", lambda ctx: claw.run(req, ctx, user["uid"]), owner=user["uid"],
                                     on_error=lambda: auth.refund(user, "drafts")).job_id)


@app.get("/api/autoclaw/runs/{run_id}", response_model=AutoClawRun)
async def autoclaw_result(run_id: str, request: Request):
    auth.check_access("autoclaw_run", run_id, me(request))
    return _get("autoclaw_run", run_id, AutoClawRun)


@app.get("/api/autoclaw/latest", response_model=AutoClawRun | None)
async def autoclaw_latest(request: Request):
    runs = auth.visible("autoclaw_run", get_store().list("autoclaw_run", 200), "run_id", me(request))
    live = next((r for r in runs if not r.get("demo") and r.get("status") == "running"), None)   # a run in progress wins
    return AutoClawRun.model_validate(live or runs[0]) if runs else None


# ---------- citeguard ----------

@app.post("/api/citeguard/audits", response_model=JobRef)
async def audit(req: AuditRequest, request: Request):
    user = me(request)
    auth.check_access("document", req.document_id, user)
    try:
        docs.info(req.document_id)
    except docs.DocumentError as e:
        raise HTTPException(404, str(e))
    auth.require_paid(user, "audits")
    auth.consume(user, "audits")
    return JobRef(job_id=jobs.submit("citeguard", lambda ctx: run_audit(req, ctx), owner=user["uid"],
                                     on_error=lambda: auth.refund(user, "audits")).job_id)


@app.get("/api/citeguard/audits/{audit_id}", response_model=AuditReport)
async def audit_result(audit_id: str, request: Request):
    auth.check_access("audit", audit_id, me(request))
    return _get("audit", audit_id, AuditReport)


def _doc_or_none(document_id: str) -> DocumentInfo | None:
    try:
        return docs.info(document_id)
    except docs.DocumentError:
        return None


def _md(text: str, name: str) -> PlainTextResponse:
    return PlainTextResponse(text, media_type="text/markdown; charset=utf-8",
                             headers={"Content-Disposition": f'attachment; filename="{name}"'})


@app.post("/api/citeguard/audits/{audit_id}/fix")
async def audit_fix(audit_id: str, request: Request):
    """Originality fixer: rewrite possible-overlap paragraphs in original words with a citation to the source."""
    from backend.citeguard import fixer
    user = me(request)
    auth.check_access("audit", audit_id, user)
    rep = get_store().get("audit", audit_id)
    if not rep:
        raise HTTPException(404, "audit not found")
    if not rep.get("overlaps") and not rep.get("phrases"):
        return {"paragraphs": [], "phrases": [], "note": "Nothing to fix: no overlap hotspots or tortured phrases were found."}
    auth.require_paid(user, "fixes")
    auth.consume(user, "fixes")
    try:
        return await fixer.fix(rep)
    except llm.LLMError as e:
        auth.refund(user, "fixes")
        raise HTTPException(502, llm.scrub(f"AI error: {e}"))


@app.get("/api/citeguard/audits/{audit_id}/report.md")
async def audit_report_md(audit_id: str, request: Request):
    auth.check_access("audit", audit_id, me(request))
    r = _get("audit", audit_id, AuditReport)
    return _md(reports.audit_markdown(r, _doc_or_none(r.document_id)), f"citeguard-{audit_id}.md")


# ---------- jury ----------

@app.post("/api/jury/reviews", response_model=JobRef)
async def jury(req: JuryRequest, request: Request):
    user = me(request)
    auth.check_access("document", req.document_id, user)
    try:
        docs.info(req.document_id)
    except docs.DocumentError as e:
        raise HTTPException(404, str(e))
    auth.require_paid(user, "reviews")
    auth.consume(user, "reviews")
    llm.set_premium(auth.is_premium(user))   # inherited by the job's task
    return JobRef(job_id=jobs.submit("jury", lambda ctx: run_jury(req, ctx), owner=user["uid"],
                                     on_error=lambda: auth.refund(user, "reviews")).job_id)


@app.get("/api/jury/reviews/{review_id}", response_model=Verdict)
async def jury_result(review_id: str, request: Request):
    auth.check_access("verdict", review_id, me(request))
    return _get("verdict", review_id, Verdict)


@app.get("/api/jury/reviews/{review_id}/report.md")
async def verdict_report_md(review_id: str, request: Request):
    auth.check_access("verdict", review_id, me(request))
    v = _get("verdict", review_id, Verdict)
    return _md(reports.verdict_markdown(v, _doc_or_none(v.document_id)), f"verdict-{review_id}.md")


# ---------- dashboard ----------

@app.get("/api/dashboard")
async def dashboard_data(request: Request):
    return dashboard.build(me(request))


# ---------- workspace: notes, stickies, todos ----------

WORKSPACE_KINDS = {"pages", "stickies", "todos", "pins"}


# ---------- AI assist (notes, stickies, to-dos) ----------

ASSIST_PROMPTS = {
    "expand": "Turn this rough idea into a short, concrete plan: a one-line goal and 3-6 bullet steps. Markdown.",
    "summarize": "Summarise this in 2-4 crisp bullet points. Markdown.",
    "improve": "Rewrite this for clarity, flow and correct grammar, keeping the author's meaning, voice and length. Return only the text.",
    "continue": "Continue this text with one or two well-written paragraphs in the same style. Return only the new text.",
    "outline": "Produce a clear Markdown outline (## headings and bullets) for a document about this.",
    "explain": "Explain this simply, as if to a smart first-year student, in under 120 words.",
    "ideas": "Brainstorm 5 fresh, specific ideas building on this. Markdown bullets, one line each.",
}


class AssistRequest(BaseModel):
    action: str
    text: str
    context: str = ""


class _Subtasks(BaseModel):
    subtasks: list[str]


class _Plan(BaseModel):
    order: list[int]
    reason: str


@app.post("/api/assist")
async def assist(req: AssistRequest, request: Request):
    auth.require_paid(me(request), "ai_assist")
    auth.consume(me(request), "assists_day")
    if not llm.available():
        raise HTTPException(400, "AI is offline right now.")
    text = req.text.strip()[:6000]
    if not text:
        raise HTTPException(400, "Nothing to work with yet.")
    system = ("You are Azora AI, a helpful writing and productivity assistant inside Cite & Slayy. Be concise. "
              "Never invent citations, statistics or facts; if facts are needed, say what to look up.")
    try:
        if req.action == "breakdown":
            out = await llm.complete_json(system, f"Break this task into 3-6 small, concrete, doable subtasks (each under 12 words):\n{text}",
                                          _Subtasks, effort="low", tier="fast")
            return {"items": [x.strip() for x in out.subtasks if x.strip()][:6]}
        if req.action == "plan":
            out = await llm.complete_json(system, "Order these to-dos for today: urgent and high-impact first, quick wins early, "
                                          "related tasks together. Return the 0-based indices in the new order and a one-sentence reason.\n"
                                          + text, _Plan, effort="low", tier="fast")
            return {"order": out.order, "reason": out.reason}
        if req.action not in ASSIST_PROMPTS:
            raise HTTPException(400, "unknown action")
        out = await llm.complete(system, f"{ASSIST_PROMPTS[req.action]}\n\n{('Context: ' + req.context[:2000] + chr(10)) if req.context else ''}TEXT:\n{text}",
                                 effort="low", max_tokens=1500, tier="fast")
        return {"text": out.strip()}
    except llm.LLMError as e:
        raise HTTPException(502, llm.scrub(f"AI error: {e}"))


_NOTE_IMG = {"image/png", "image/jpeg", "image/webp", "image/gif"}


@app.post("/api/workspace/images")
async def workspace_image_upload(request: Request, file: UploadFile = File(...)):
    """Images inserted into a notes page; the page stores only the short URL."""
    user = me(request)
    if (file.content_type or "") not in _NOTE_IMG:
        raise HTTPException(400, "Images must be PNG, JPEG, WebP or GIF.")
    raw = await file.read(5 * 1024 * 1024 + 1)
    if len(raw) > 5 * 1024 * 1024:
        raise HTTPException(413, "Images must be under 5 MB.")
    auth._limit(f"noteimg:{user['uid']}", 120, 86400)
    iid = uuid.uuid4().hex[:16]
    get_store().put("note_img", iid, {"mime": file.content_type, "b64": base64.b64encode(raw).decode()})
    auth.own("note_img", iid, user)
    return {"url": f"/api/workspace/images/{iid}"}


@app.get("/api/workspace/images/{iid}")
async def workspace_image_get(iid: str, request: Request):
    auth.check_access("note_img", iid, me(request))
    obj = get_store().get("note_img", iid)
    if not obj:
        raise HTTPException(404, "not found")
    return Response(base64.b64decode(obj["b64"]), media_type=obj["mime"], headers={"cache-control": "private, max-age=86400"})


@app.get("/api/workspace/{kind}")
async def workspace_get(kind: str, request: Request):
    if kind not in WORKSPACE_KINDS:
        raise HTTPException(404, "unknown workspace kind")
    return (get_store().get("workspace", auth.workspace_key(kind, me(request))) or {"items": []})


@app.put("/api/workspace/{kind}")
async def workspace_put(kind: str, body: dict, request: Request):
    if kind not in WORKSPACE_KINDS:
        raise HTTPException(404, "unknown workspace kind")
    import json as _json
    if len(_json.dumps(body)) > 2_000_000:
        raise HTTPException(413, "workspace too large")
    get_store().put("workspace", auth.workspace_key(kind, me(request)), {"items": body.get("items", [])})
    return {"ok": True}


# ---------- export ----------

class ExportRequest(BaseModel):
    title: str = "Untitled"
    markdown: str
    template: str = "ieee"           # ieee | springer | plain
    author: str = "Author Name"
    affiliation: str = "Affiliation"
    diagrams: list[str | None] = []  # Mermaid diagrams rendered to PNG data URLs by the browser, in document order


_FIG_SRC = re.compile(r"/api/paper-studio/([0-9a-f]+)/fig/([a-z]+)\.png")
_NOTE_SRC = re.compile(r"/api/workspace/images/([0-9a-f]{16})")


def _assets(req: ExportRequest, user: dict) -> exporter.Assets:
    a = exporter.Assets()
    for m in _FIG_SRC.finditer(req.markdown):
        if get_settings().auth_required and get_store().owner_of("paper_studio", m.group(1)) not in (None, user["uid"]):
            continue
        png = studio.figure_png(m.group(1), m.group(2))
        if png:
            a.images[m.group(0)] = png
    for m in _NOTE_SRC.finditer(req.markdown):
        if get_settings().auth_required and get_store().owner_of("note_img", m.group(1)) not in (None, user["uid"]):
            continue
        obj = get_store().get("note_img", m.group(1))
        if obj and obj.get("mime") == "image/png":
            a.images[m.group(0)] = base64.b64decode(obj["b64"])
    for d in req.diagrams[:30]:
        png = None
        if d and d.startswith("data:image/png;base64,"):
            try:
                png = base64.b64decode(d.split(",", 1)[1], validate=True)
            except ValueError:
                png = None
        a.diagrams.append(png if png and len(png) < 8_000_000 else None)
    return a


@app.post("/api/export/latex")
async def export_latex(req: ExportRequest, request: Request):
    auth.require_paid(me(request), "exports")
    tpl = req.template if req.template in ("ieee", "springer", "plain") else "plain"
    tex = exporter.to_latex(req.markdown, req.title, tpl, req.author, req.affiliation)
    return Response(tex, media_type="application/x-tex",
                    headers={"Content-Disposition": f'attachment; filename="{_slug(req.title)}-{tpl}.tex"'})


@app.post("/api/export/docx")
async def export_docx(req: ExportRequest, request: Request):
    auth.require_paid(me(request), "exports")
    tpl = req.template if req.template in ("ieee", "springer", "plain") else "plain"
    data = exporter.to_docx(req.markdown, req.title, tpl, req.author, req.affiliation, _assets(req, me(request)))
    return Response(data, media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    headers={"Content-Disposition": f'attachment; filename="{_slug(req.title)}.docx"'})


@app.post("/api/export/latex-zip")
async def export_latex_zip(req: ExportRequest, request: Request):
    auth.require_paid(me(request), "exports")
    tpl = req.template if req.template in ("ieee", "springer", "plain") else "plain"
    data = exporter.latex_zip(req.markdown, req.title, tpl, req.author, req.affiliation, _assets(req, me(request)))
    return Response(data, media_type="application/zip",
                    headers={"Content-Disposition": f'attachment; filename="{_slug(req.title)}-{tpl}-latex.zip"'})


# ---------- presentation templates (CC BY 4.0 catalog by ppttemplate.ai) ----------

_PPT_TEMPLATES: list[dict] | None = None


@app.get("/api/deck-templates")
async def deck_templates(request: Request, category: str = "", q: str = "", limit: int = 48):
    me(request)
    global _PPT_TEMPLATES
    if _PPT_TEMPLATES is None:
        import json as _json
        from pathlib import Path as _P
        _PPT_TEMPLATES = _json.loads((_P(studio.__file__).parent / "ppt_templates.json").read_text())
    items = _PPT_TEMPLATES
    if category:
        items = [t for t in items if t["category"] == category]
    if q.strip():
        words = q.lower().split()
        items = [t for t in items if all(w in (t["title"] + " " + " ".join(t["tags"])).lower() for w in words)]
    cats: dict[str, str] = {}
    for t in _PPT_TEMPLATES:
        cats.setdefault(t["category"], t["category_name"])
    return {"items": items[: max(1, min(limit, 120))], "total": len(items), "categories": cats,
            "credit": "Templates by ppttemplate.ai (CC BY 4.0)", "license_url": "https://creativecommons.org/licenses/by/4.0/"}


@app.get("/api/deck-templates/{slug}/palette")
async def deck_template_palette(slug: str, request: Request):
    """Slide colours taken from a catalog design (its files are flat slide images, so colours are what transfers)."""
    from backend.paper_studio import palette as pal
    me(request)
    await deck_templates(request, limit=1)          # loads the catalog
    tpl = next((t for t in _PPT_TEMPLATES or [] if t["slug"] == slug), None)
    if not tpl:
        raise HTTPException(404, "template not found")
    cached = get_store().get("tpl_palette", slug)
    if cached:
        return cached
    try:
        out = await pal.palette_for(tpl)
    except Exception as e:  # network / image errors
        raise HTTPException(502, f"Couldn't read that design right now ({type(e).__name__}).")
    get_store().put("tpl_palette", slug, out)
    return out


# ---------- Paper Studio ----------

@app.post("/api/paper-studio", response_model=JobRef)
async def paper_studio_start(req: studio.StudioRequest, request: Request):
    user = me(request)
    if not req.topic.strip():
        raise HTTPException(400, "Give a topic")
    if not llm.available():
        raise HTTPException(400, "Paper Studio needs the AI service, which is not configured.")
    for d in req.seed_document_ids:
        auth.check_access("document", d, user)
    auth.consume(user, "papers")
    llm.set_premium(auth.is_premium(user))
    req.max_refs = 40 if user.get("plan") == "max" or user.get("_used_pack") or auth.is_owner(user) else 32
    return JobRef(job_id=jobs.submit("paper_studio", lambda ctx: studio.run(req, ctx), owner=user["uid"],
                                     on_error=lambda: auth.refund(user, "papers")).job_id)


@app.get("/api/paper-studio")
async def paper_studio_list(request: Request):
    mine = auth.visible("paper_studio", get_store().list("paper_studio", 300), "paper_id", me(request))
    return [{k: p.get(k) for k in ("paper_id", "title", "topic", "words", "created_at")} for p in mine[:30]]


@app.get("/api/paper-studio/{pid}")
async def paper_studio_get(pid: str, request: Request):
    user = me(request)
    auth.check_access("paper_studio", pid, user)
    p = get_store().get("paper_studio", pid)
    if not p:
        raise HTTPException(404, "paper not found")
    out = {k: v for k, v in p.items() if not k.startswith("_") and k != "versions"}
    out["markdown"] = studio.ensure_keywords(studio.repair_fences(out.get("markdown", "")), out.get("keywords") or [])
    if p.get("_facts") is not None:   # papers saved before the table guard existed get it on read
        allowed = studio._allowed_numbers(p.get("_facts", ""), *((r.get("abstract") or "") for r in p.get("_refs") or []))
        out["markdown"], _ = studio.strip_unmeasured_tables(out["markdown"], allowed)   # also fixes papers saved before the repair existed
    out["history"] = [{"at": v["at"], "instruction": v["instruction"]} for v in p.get("versions") or []]
    out["revisable"] = bool(p.get("_refs"))
    if not auth.is_paid(user):
        out.update(_preview_only(out["markdown"]), references=(out.get("references") or [])[:6], kit=None,
                   references_total=len(out.get("references") or []))
    return out


def _preview_only(md: str, share: float = 0.35) -> dict:
    """Free plan: the opening sections only (cut at a section boundary); the full paper unlocks with a paid plan."""
    parts = re.split(r"(?m)^(?=# )", md)
    keep, total = [], len(md)
    for part in parts:
        if keep and sum(map(len, keep)) + len(part) > total * share and len(keep) >= 2:
            break
        keep.append(part)
    shown = "".join(keep).rstrip()
    return {"markdown": shown, "locked": shown != md.rstrip(), "locked_sections": len(parts) - len(keep)}


class ReviseRequest(BaseModel):
    instruction: str


@app.post("/api/paper-studio/{pid}/revise", response_model=JobRef)
async def paper_studio_revise(pid: str, body: ReviseRequest, request: Request):
    user = me(request)
    auth.check_access("paper_studio", pid, user)
    if not body.instruction.strip():
        raise HTTPException(400, "Tell me what to change")
    auth.require_paid(user, "revisions")
    auth.consume(user, "revisions")
    llm.set_premium(auth.is_premium(user))
    return JobRef(job_id=jobs.submit("paper_revise", lambda ctx: studio.revise(pid, body.instruction.strip()[:2000], ctx),
                                     owner=user["uid"], on_error=lambda: auth.refund(user, "revisions")).job_id)


@app.post("/api/paper-studio/{pid}/kit")
async def paper_studio_kit(pid: str, body: kit_mod.KitRequest, request: Request):
    user = me(request)
    auth.check_access("paper_studio", pid, user)
    auth.require_paid(user, "kits")
    auth.consume(user, "kits")
    llm.set_premium(auth.is_premium(user))
    try:
        return await kit_mod.build(pid, body)
    except (ValueError, llm.LLMError) as e:
        auth.refund(user, "kits")
        raise HTTPException(502, llm.scrub(f"Couldn't build the kit: {e}"))


class DeckRequest(BaseModel):
    author: str = ""
    affiliation: str = ""


@app.post("/api/paper-studio/{pid}/deck")
async def paper_studio_deck(pid: str, body: DeckRequest, request: Request):
    """Slide content + real chart data for a presentation deck (the browser builds the .pptx)."""
    from backend.paper_studio import deck as deck_mod
    user = me(request)
    auth.check_access("paper_studio", pid, user)
    if not get_store().get("paper_studio", pid):
        raise HTTPException(404, "paper not found")
    auth.require_paid(user, "decks")
    auth.consume(user, "decks")
    llm.set_premium(auth.is_premium(user))
    try:
        return await deck_mod.build(pid, body.author, body.affiliation)
    except (ValueError, llm.LLMError) as e:
        auth.refund(user, "decks")
        raise HTTPException(502, llm.scrub(f"Couldn't prepare the presentation: {e}"))


@app.post("/api/paper-studio/{pid}/undo")
async def paper_studio_undo(pid: str, request: Request):
    auth.check_access("paper_studio", pid, me(request))
    p = get_store().get("paper_studio", pid)
    if not p or not p.get("versions"):
        raise HTTPException(400, "Nothing to undo")
    last = p["versions"].pop()
    p["markdown"] = last["markdown"]
    p["words"] = len(re.findall(r"\w+", p["markdown"]))
    get_store().put("paper_studio", pid, p)
    return {"ok": True}


class ReplaceMarkdownRequest(BaseModel):
    markdown: str
    preserve_references: bool = True


@app.post("/api/paper-studio/{pid}/replace-markdown")
async def paper_studio_replace_markdown(pid: str, body: ReplaceMarkdownRequest, request: Request):
    user = me(request)
    auth.require_paid(user, "humanize_fixes")
    auth.check_access("paper_studio", pid, user)
    p = get_store().get("paper_studio", pid)
    if not p:
        raise HTTPException(404, "paper not found")
    new_md = body.markdown.strip()
    if not new_md:
        raise HTTPException(400, "markdown cannot be empty")
    old_md = p.get("markdown") or ""
    if body.preserve_references and "# References" not in new_md and "# References" in old_md:
        refs_tail = old_md[old_md.index("# References"):]
        new_md = f"{new_md}\n\n{refs_tail}"
    p.setdefault("versions", []).append({"markdown": old_md, "note": "before AI & Plagiarism reduction"})
    p["versions"] = p["versions"][-15:]
    p["markdown"] = new_md
    p["words"] = len(re.findall(r"\w+", new_md))
    get_store().put("paper_studio", pid, p)
    return {"ok": True, "paper_id": pid, "words": p["words"]}


class VenueRequest(BaseModel):
    title: str
    abstract: str = ""
    kind: str = "any"         # any | journal | conference
    oa_only: bool = False


@app.post("/api/venues/find")
async def venues_find(body: VenueRequest, request: Request):
    from backend.app import venue_finder
    auth.require_paid(me(request), "venues")
    return await venue_finder.find(body.title.strip()[:400], body.abstract.strip()[:3000], body.kind, body.oa_only)


# ---------- Turnitin-style Originality (AI & Plagiarism) Report + Reducer (Paid Plans & Dev Owner Only) ----------

class OriginalityScanRequest(BaseModel):
    text: str = ""
    title: str = ""
    document_id: str | None = None
    paper_id: str | None = None
    exclude_references: bool = True
    exclude_quotes: bool = True


@app.post("/api/originality/scan")
async def originality_scan(body: OriginalityScanRequest, request: Request):
    from backend.citeguard import turnitin

    user = me(request)
    auth.require_paid(user, "integrity_scans")
    if body.document_id:
        auth.check_access("document", body.document_id, user)
    if body.paper_id:
        auth.check_access("paper_studio", body.paper_id, user)
    auth.consume(user, "integrity_scans")
    try:
        rep = await turnitin.scan(
            text=body.text[:180_000],
            title=body.title[:400],
            document_id=body.document_id,
            paper_id=body.paper_id,
            exclude_references=body.exclude_references,
            exclude_quotes=body.exclude_quotes,
        )
    except ValueError as e:
        auth.refund(user, "integrity_scans")
        raise HTTPException(400, str(e)) from e
    except KeyError as e:
        auth.refund(user, "integrity_scans")
        raise HTTPException(404, f"Document not found: {e}") from e
    auth.own("originality_scan", rep["scan_id"], user)
    return rep


class LineFixRequest(BaseModel):
    scan_id: str
    sentence_id: str
    action: Literal["rewrite", "quote"] = "rewrite"


@app.post("/api/originality/fix-line")
async def originality_fix_line(req: LineFixRequest, request: Request):
    """Fix one similarity-flagged line: original-wording rewrite with a citation, or quote and cite."""
    from backend.citeguard import turnitin
    user = me(request)
    auth.require_paid(user, "fixes")
    auth.check_access("originality_scan", req.scan_id, user)
    auth.consume(user, "fixes")
    try:
        return await turnitin.fix_line(req.scan_id, req.sentence_id, req.action)
    except ValueError as e:
        auth.refund(user, "fixes")
        raise HTTPException(400, str(e))
    except llm.LLMError as e:
        auth.refund(user, "fixes")
        raise HTTPException(502, llm.scrub(str(e))[:200])


@app.get("/api/originality/{scan_id}")
async def originality_get(scan_id: str, request: Request):
    user = me(request)
    auth.require_paid(user, "integrity_scans")
    auth.check_access("originality_scan", scan_id, user)
    rec = get_store().get("originality_scan", scan_id)
    if not rec:
        raise HTTPException(404, "scan not found")
    return {k: v for k, v in rec.items() if not k.startswith("_")}


class OriginalityReduceRequest(BaseModel):
    scan_id: str | None = None
    text: str = ""
    title: str = ""
    mode: Literal["both", "plagiarism", "ai"] = "both"


@app.post("/api/originality/reduce")
async def originality_reduce(body: OriginalityReduceRequest, request: Request):
    from backend.citeguard import turnitin

    user = me(request)
    auth.require_paid(user, "humanize_fixes")
    if body.scan_id:
        auth.check_access("originality_scan", body.scan_id, user)
    auth.consume(user, "humanize_fixes")
    llm.set_premium(auth.is_premium(user))
    llm.set_meter(None if auth.is_owner(user) else user["uid"])
    try:
        res = await turnitin.reduce(
            scan_id=body.scan_id,
            text=body.text[:180_000],
            title=body.title[:400],
            mode=body.mode,
        )
    except llm.LLMError as e:
        auth.refund(user, "humanize_fixes")
        raise HTTPException(503, str(e)) from e
    except ValueError as e:
        auth.refund(user, "humanize_fixes")
        raise HTTPException(400, str(e)) from e
    auth.own("originality_scan", res["after_scan_id"], user)
    return res


@app.get("/api/paper-studio/{pid}/fig/{name}.png")
async def paper_studio_fig(pid: str, name: str, request: Request):
    auth.check_access("paper_studio", pid, me(request))
    png = studio.figure_png(pid, name)
    if not png:
        raise HTTPException(404, "figure not found")
    return Response(png, media_type="image/png", headers={"Cache-Control": "private, max-age=86400"})


@app.get("/api/export/paper-template")
async def paper_template():
    return {"markdown": exporter.PAPER_TEMPLATE}


def _slug(s: str) -> str:
    import re as _re
    return _re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-")[:60] or "document"


# ---------- library ----------

@app.get("/api/library/trending")
async def library_trending(query: str = "", days: int = 365, page: int = 1):
    try:
        return await library.trending(query, days, page=min(page, 20))
    except Exception as e:  # upstream API hiccup: report, don't crash
        raise HTTPException(502, f"OpenAlex unavailable: {e}")


@app.get("/api/library/latest")
async def library_latest(query: str = "", page: int = 1):
    try:
        return await library.latest(query, page=min(page, 20))
    except Exception as e:
        raise HTTPException(502, f"arXiv unavailable: {e}")


@app.get("/api/library/books")
async def library_books(query: str = "", page: int = 1):
    try:
        return await library.books(query, page=min(page, 20))
    except Exception as e:
        raise HTTPException(502, f"Open Library unavailable: {e}")


class IdeasRequest(BaseModel):
    query: str


@app.post("/api/library/ideas")
async def library_ideas(req: IdeasRequest, request: Request):
    auth.require_paid(me(request), "ideas")
    auth.consume(me(request), "assists_day")
    if not llm.available():
        raise HTTPException(400, "Research ideas need an AI model (cloud key or local Ollama).")
    try:
        return await library.ideas(req.query)
    except llm.LLMError as e:
        raise HTTPException(502, f"AI error: {e}")


# ---------- games ----------

@app.get("/api/games/tortured")
async def game_tortured(n: int = 8):
    import random
    phrases = list(load_phrases())
    expected = sorted({p.expected for p in phrases})
    rnd = random.Random()
    rnd.shuffle(phrases)
    seen, qs = set(), []
    for p in phrases:
        if p.expected in seen:
            continue
        seen.add(p.expected)
        wrong = rnd.sample([e for e in expected if e != p.expected], 3)
        choices = wrong + [p.expected]
        rnd.shuffle(choices)
        qs.append({"tortured": p.tortured, "answer": p.expected, "choices": choices, "source": p.source_url})
        if len(qs) >= n:
            break
    return qs


# ---------- Azora AI agent ----------

class ChatRequest(BaseModel):
    message: str
    chat_id: str | None = None
    images: list[str] = []     # up to 3 data URLs (png / jpeg / webp / gif), each under 5 MB


def _decode_images(urls: list[str]) -> list[tuple[str, bytes]]:
    out = []
    for u in urls[:3]:
        m = re.match(r"^data:(image/(?:png|jpeg|jpg|webp|gif));base64,(.+)$", u or "", re.S)
        if not m:
            raise HTTPException(400, "Images must be PNG, JPEG, WebP or GIF.")
        try:
            raw = base64.b64decode(m.group(2), validate=True)
        except ValueError as e:
            raise HTTPException(400, "Couldn't read that image.") from e
        if len(raw) > 5 * 1024 * 1024:
            raise HTTPException(413, "Each image must be under 5 MB.")
        out.append((m.group(1).replace("jpg", "jpeg"), raw))
    return out


@app.post("/api/agent/chat")
async def agent_chat(req: ChatRequest, request: Request):
    import uuid
    user = me(request)
    if not req.message.strip() and not req.images:
        raise HTTPException(400, "empty message")
    if req.images:
        auth.require_paid(user, "vision")
    images = _decode_images(req.images)
    if req.chat_id:
        auth.check_access("agent_chat", req.chat_id, user)
    auth.consume(user, "chats_day")
    chat_id = req.chat_id or uuid.uuid4().hex[:12]
    auth.own("agent_chat", chat_id, user)
    aurora_ctx_user.set(user)
    msg = req.message.strip()[:4000] or "What can you tell me about this image?"
    job = jobs.submit("agent", lambda ctx: aurora.run_turn(chat_id, msg, ctx, images=images), owner=user["uid"])
    return {"job_id": job.job_id, "chat_id": chat_id}


@app.get("/api/agent/chats/{chat_id}")
async def agent_chat_get(chat_id: str, request: Request):
    auth.check_access("agent_chat", chat_id, me(request))
    c = get_store().get("agent_chat", chat_id)
    if not c:
        raise HTTPException(404, "chat not found")
    return c


@app.get("/api/agent/chats")
async def agent_chats(request: Request):
    return [{"chat_id": c["chat_id"], "title": c.get("title", "Chat"), "n": len(c.get("messages", []))}
            for c in auth.visible("agent_chat", get_store().list("agent_chat", 300), "chat_id", me(request))[:30]]


# ---------- one-click pipeline ----------

@app.post("/api/pipeline", response_model=JobRef)
async def run_pipeline(req: pipeline.PipelineRequest, request: Request):
    user = me(request)
    if req.document_id:
        auth.check_access("document", req.document_id, user)
        try:
            docs.info(req.document_id)
        except docs.DocumentError as e:
            raise HTTPException(404, str(e))
    auth.require_paid(user, "reviews")
    feats = (["drafts"] if not req.document_id else []) + ["audits", "reviews"]
    for i, f in enumerate(feats):
        try:
            auth.consume(user, f)
        except HTTPException:
            for g in feats[:i]:
                auth.refund(user, g)
            raise
    llm.set_premium(auth.is_premium(user))

    def _refund_all():
        for f in feats:
            auth.refund(user, f)
    return JobRef(job_id=jobs.submit("pipeline", lambda ctx: pipeline.run(req, ctx), owner=user["uid"], on_error=_refund_all).job_id)


@app.get("/api/pipeline/{pipeline_id}", response_model=pipeline.PipelineResult)
async def pipeline_result(pipeline_id: str, request: Request):
    auth.check_access("pipeline", pipeline_id, me(request))
    return _get("pipeline", pipeline_id, pipeline.PipelineResult)
