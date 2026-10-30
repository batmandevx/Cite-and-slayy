"""Cite and Slayy API. Run: uv run uvicorn backend.app.main:app --reload --port 8000"""
from __future__ import annotations

import base64
import re

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, RedirectResponse, StreamingResponse

from pydantic import BaseModel

from backend.agent import aurora
from fastapi.responses import Response

from backend.accounts import auth, billing
from backend.accounts.plans import plan_of, public_pack, public_plans
from backend.app import dashboard, export as exporter, library, pipeline, reports
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
app.add_middleware(CORSMiddleware, allow_origins=get_settings().cors_origins.split(","),
                   allow_methods=["*"], allow_headers=["*"], allow_credentials=True)

# Endpoints anyone may call without signing in (landing page, sign-in itself, payment-provider webhooks).
PUBLIC = ("/api/health", "/api/stats", "/api/auth/", "/api/billing/plans", "/api/billing/upi-claim", "/api/billing/webhook")


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
    return {"auth_required": s.auth_required, "google_client_id": s.google_client_id,
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
    plan = plan_of(user)
    return {"uid": user["uid"], "email": user["email"], "name": user.get("name"), "picture": user.get("picture"),
            "plan": user.get("plan", "free"), "plan_name": plan["name"], "limits": plan["limits"], "usage": auth.usage(user),
            "renews_at": user.get("renews_at"), "cancel_at_period_end": user.get("cancel_at_period_end", False),
            "engine": "Azora Pro engine" if plan["engine"] == "premium" else "Azora standard engine",
            "ai_budget_used": min(1.0, auth.ai_spend_inr(user) / max(1, plan["ai_budget_inr"] + (auth.bonus(user).get("ai_budget_inr", 0) if auth.bonus(user) else 0))),
            "pack": ({"credits": auth.bonus(user)["credits"], "expires": auth.bonus(user)["expires"]} if auth.bonus(user) else None)}


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
    utr = "".join(ch for ch in body.utr.strip() if ch.isalnum() or ch in ("-", "_"))
    if len(utr) < 6 or len(utr) > 40:
        raise HTTPException(400, "Enter a valid UPI UTR / reference number (6–40 characters)")
    info = PAPER_PACK if item == "pack" else PLANS[item]
    user = auth.current_user(request)
    email = (body.email.strip()[:160] or (user or {}).get("email") or "").strip()
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
    get_store().put("upi_claim", cid, rec)
    return {"ok": True, **rec}


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
    billing.verify_checkout(me(request), body.razorpay_payment_id, body.razorpay_subscription_id, body.razorpay_signature)
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
    billing.verify_order(me(request), body.razorpay_order_id, body.razorpay_payment_id, body.razorpay_signature)
    return {"ok": True}


@app.post("/api/billing/cancel")
async def billing_cancel(request: Request):
    await billing.cancel(me(request))
    return {"ok": True}


@app.post("/api/billing/webhook")
async def billing_webhook(request: Request):
    billing.handle_webhook(await request.body(), request.headers.get("X-Razorpay-Signature"))
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
    data = await file.read()
    if len(data) > 40 * 1024 * 1024:
        raise HTTPException(413, "File larger than 40 MB")
    try:
        info = docs.save_bytes(file.filename or "upload.pdf", data)
        auth.own("document", info.document_id, me(request))
        return info
    except docs.DocumentError as e:
        raise HTTPException(400, str(e))


@app.get("/api/documents/samples", response_model=list[DocumentInfo])
async def samples():
    """Register and list the bundled demo documents."""
    out = []
    for p in sorted((ROOT / "demo" / "sample_pdfs").glob("*")) + [ROOT / "demo/autoclaw_run/deliverables/paper.pdf"]:
        if p.suffix.lower() in docs.ALLOWED and p.exists():
            out.append(docs.save_path(p, p.name if p.name != "paper.pdf" else "GARD_autoresearchclaw_showcase.pdf"))
    return out


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
    auth.consume(user, "drafts")
    return JobRef(job_id=jobs.submit("autoclaw", lambda ctx: claw.run(req, ctx), owner=user["uid"],
                                     on_error=lambda: auth.refund(user, "drafts")).job_id)


@app.get("/api/autoclaw/runs/{run_id}", response_model=AutoClawRun)
async def autoclaw_result(run_id: str, request: Request):
    auth.check_access("autoclaw_run", run_id, me(request))
    return _get("autoclaw_run", run_id, AutoClawRun)


@app.get("/api/autoclaw/latest", response_model=AutoClawRun | None)
async def autoclaw_latest(request: Request):
    runs = auth.visible("autoclaw_run", get_store().list("autoclaw_run", 200), "run_id", me(request))
    return AutoClawRun.model_validate(runs[0]) if runs else None


# ---------- citeguard ----------

@app.post("/api/citeguard/audits", response_model=JobRef)
async def audit(req: AuditRequest, request: Request):
    user = me(request)
    auth.check_access("document", req.document_id, user)
    try:
        docs.info(req.document_id)
    except docs.DocumentError as e:
        raise HTTPException(404, str(e))
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


def _assets(req: ExportRequest, user: dict) -> exporter.Assets:
    a = exporter.Assets()
    for m in _FIG_SRC.finditer(req.markdown):
        if get_settings().auth_required and get_store().owner_of("paper_studio", m.group(1)) not in (None, user["uid"]):
            continue
        png = studio.figure_png(m.group(1), m.group(2))
        if png:
            a.images[m.group(0)] = png
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
async def export_latex(req: ExportRequest):
    tpl = req.template if req.template in ("ieee", "springer", "plain") else "plain"
    tex = exporter.to_latex(req.markdown, req.title, tpl, req.author, req.affiliation)
    return Response(tex, media_type="application/x-tex",
                    headers={"Content-Disposition": f'attachment; filename="{_slug(req.title)}-{tpl}.tex"'})


@app.post("/api/export/docx")
async def export_docx(req: ExportRequest, request: Request):
    tpl = req.template if req.template in ("ieee", "springer", "plain") else "plain"
    data = exporter.to_docx(req.markdown, req.title, tpl, req.author, req.affiliation, _assets(req, me(request)))
    return Response(data, media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    headers={"Content-Disposition": f'attachment; filename="{_slug(req.title)}.docx"'})


@app.post("/api/export/latex-zip")
async def export_latex_zip(req: ExportRequest, request: Request):
    tpl = req.template if req.template in ("ieee", "springer", "plain") else "plain"
    data = exporter.latex_zip(req.markdown, req.title, tpl, req.author, req.affiliation, _assets(req, me(request)))
    return Response(data, media_type="application/zip",
                    headers={"Content-Disposition": f'attachment; filename="{_slug(req.title)}-{tpl}-latex.zip"'})


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
    req.max_refs = 30 if user.get("plan") == "max" or user.get("_used_pack") else 20
    return JobRef(job_id=jobs.submit("paper_studio", lambda ctx: studio.run(req, ctx), owner=user["uid"],
                                     on_error=lambda: auth.refund(user, "papers")).job_id)


@app.get("/api/paper-studio")
async def paper_studio_list(request: Request):
    mine = auth.visible("paper_studio", get_store().list("paper_studio", 300), "paper_id", me(request))
    return [{k: p.get(k) for k in ("paper_id", "title", "topic", "words", "created_at")} for p in mine[:30]]


@app.get("/api/paper-studio/{pid}")
async def paper_studio_get(pid: str, request: Request):
    auth.check_access("paper_studio", pid, me(request))
    p = get_store().get("paper_studio", pid)
    if not p:
        raise HTTPException(404, "paper not found")
    out = {k: v for k, v in p.items() if not k.startswith("_") and k != "versions"}
    out["markdown"] = studio.ensure_keywords(studio.repair_fences(out.get("markdown", "")), out.get("keywords") or [])   # also fixes papers saved before the repair existed
    out["history"] = [{"at": v["at"], "instruction": v["instruction"]} for v in p.get("versions") or []]
    out["revisable"] = bool(p.get("_refs"))
    return out


class ReviseRequest(BaseModel):
    instruction: str


@app.post("/api/paper-studio/{pid}/revise", response_model=JobRef)
async def paper_studio_revise(pid: str, body: ReviseRequest, request: Request):
    user = me(request)
    auth.check_access("paper_studio", pid, user)
    if not body.instruction.strip():
        raise HTTPException(400, "Tell me what to change")
    auth.consume(user, "revisions")
    llm.set_premium(auth.is_premium(user))
    return JobRef(job_id=jobs.submit("paper_revise", lambda ctx: studio.revise(pid, body.instruction.strip()[:2000], ctx),
                                     owner=user["uid"], on_error=lambda: auth.refund(user, "revisions")).job_id)


@app.post("/api/paper-studio/{pid}/kit")
async def paper_studio_kit(pid: str, body: kit_mod.KitRequest, request: Request):
    user = me(request)
    auth.check_access("paper_studio", pid, user)
    auth.consume(user, "kits")
    llm.set_premium(auth.is_premium(user))
    try:
        return await kit_mod.build(pid, body)
    except (ValueError, llm.LLMError) as e:
        auth.refund(user, "kits")
        raise HTTPException(502, llm.scrub(f"Couldn't build the kit: {e}"))


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


class VenueRequest(BaseModel):
    title: str
    abstract: str = ""
    kind: str = "any"         # any | journal | conference
    oa_only: bool = False


@app.post("/api/venues/find")
async def venues_find(body: VenueRequest, request: Request):
    from backend.app import venue_finder
    auth.consume(me(request), "assists_day")
    return await venue_finder.find(body.title.strip()[:400], body.abstract.strip()[:3000], body.kind, body.oa_only)


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


@app.post("/api/agent/chat")
async def agent_chat(req: ChatRequest, request: Request):
    import uuid
    user = me(request)
    if not req.message.strip():
        raise HTTPException(400, "empty message")
    if req.chat_id:
        auth.check_access("agent_chat", req.chat_id, user)
    auth.consume(user, "chats_day")
    chat_id = req.chat_id or uuid.uuid4().hex[:12]
    auth.own("agent_chat", chat_id, user)
    aurora_ctx_user.set(user)
    job = jobs.submit("agent", lambda ctx: aurora.run_turn(chat_id, req.message.strip()[:4000], ctx), owner=user["uid"])
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
