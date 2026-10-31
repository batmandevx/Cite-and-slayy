"""A private, OpenAI-compatible chat endpoint for AutoResearchClaw, backed by our own LLM router (Bedrock).

AutoResearchClaw only speaks the OpenAI chat-completions wire format. Rather than give it a cloud key, each live run gets
a one-time key that maps to the founder who started it and a rupee budget. Every call is metered against that founder
(the normal cost meter) and the run is cut off with HTTP 402 once its budget is spent.

The router is mounted under /internal, which Caddy never forwards (only /api/* reaches the backend from outside), so it
is reachable only from containers on the private Docker network.
"""
from __future__ import annotations

import logging
import secrets
import time
import uuid

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from backend.accounts import auth
from backend.cache.store import get_store
from backend.common.config import get_settings
from backend.llm import client as llm

logger = logging.getLogger("autoclaw_bridge")

router = APIRouter(prefix="/internal/llm/v1")
MODEL = "azora-pro"


def issue_key(uid: str, run_id: str, budget_inr: float) -> str:
    """One key per live run: who pays, and how much the run may spend."""
    key = "rc-" + secrets.token_urlsafe(32)
    user = auth.get_user(uid) or {"uid": uid}
    get_store().put("claw_key", key, {"key": key, "uid": uid, "run_id": run_id, "budget_inr": float(budget_inr),
                                      "start_spend": auth.ai_spend_inr(user), "calls": 0, "created": time.time()})
    return key


def revoke_key(key: str) -> None:
    rec = get_store().get("claw_key", key)
    if rec:
        get_store().put("claw_key", key, {**rec, "revoked": True})


def run_spend(key: str) -> float:
    rec = get_store().get("claw_key", key) or {}
    user = auth.get_user(rec.get("uid", "")) or {"uid": rec.get("uid", "")}
    return round(auth.ai_spend_inr(user) - rec.get("start_spend", 0.0), 2)


def _check(request: Request) -> tuple[str, dict]:
    if request.headers.get("x-forwarded-for") or request.headers.get("via"):
        raise HTTPException(404, "not found")          # came through the public proxy: this endpoint doesn't exist there
    key = (request.headers.get("authorization") or "").removeprefix("Bearer ").strip()
    rec = get_store().get("claw_key", key) if key.startswith("rc-") else None
    if not rec or rec.get("revoked") or time.time() - rec.get("created", 0) > 6 * 3600:
        raise HTTPException(401, "invalid or expired run key")
    run = get_store().get("autoclaw_run", rec.get("run_id", "")) or {}
    if run.get("status") in ("error", "done"):
        raise HTTPException(401, "this run has ended")      # stops orphaned runs from spending
    if run_spend(key) >= rec["budget_inr"]:
        raise HTTPException(402, f"run budget of ₹{rec['budget_inr']:.0f} reached")
    return key, rec


class _Msg(BaseModel):
    role: str
    content: str | list | None = None


class ChatRequest(BaseModel):
    model: str = MODEL
    messages: list[_Msg]
    max_tokens: int | None = None
    max_completion_tokens: int | None = None
    temperature: float | None = None
    stream: bool = False


def _text(content) -> str:
    if isinstance(content, list):
        return "\n".join(str(p.get("text", "")) for p in content if isinstance(p, dict))
    return content or ""


@router.get("/models")
async def models(request: Request):
    _check(request)
    return {"object": "list", "data": [{"id": MODEL, "object": "model", "owned_by": "cite-and-slayy"}]}


@router.post("/chat/completions")
async def chat(body: ChatRequest, request: Request):
    key, rec = _check(request)
    system = "\n\n".join(_text(m.content) for m in body.messages if m.role in ("system", "developer"))
    turns = [m for m in body.messages if m.role not in ("system", "developer")]
    prompt = "\n\n".join(f"{'User' if m.role == 'user' else 'Assistant'}: {_text(m.content)}" for m in turns)
    if len(turns) == 1 and turns[0].role == "user":
        prompt = _text(turns[0].content)
    max_tokens = min(16000, body.max_completion_tokens or body.max_tokens or 8000)
    llm.set_meter(rec["uid"] if get_settings().auth_required else None)
    llm.set_premium(True)
    try:
        text = await llm.complete(system or "You are a helpful research assistant.", prompt, effort="medium", max_tokens=max_tokens)
    except llm.LLMError as e:
        logger.error(f"[llm_bridge] /chat/completions complete failed: {e}")
        raise HTTPException(502, llm.scrub(str(e))[:300]) from e
    rec["calls"] = rec.get("calls", 0) + 1
    get_store().put("claw_key", key, rec)
    msg = {"role": "assistant", "content": text}
    usage = {"prompt_tokens": len(system + prompt) // 4, "completion_tokens": len(text) // 4,
             "total_tokens": (len(system + prompt) + len(text)) // 4}
    out = {"id": f"chatcmpl-{uuid.uuid4().hex[:24]}", "object": "chat.completion", "created": int(time.time()), "model": body.model,
           "choices": [{"index": 0, "message": msg, "finish_reason": "stop"}], "usage": usage}
    if body.stream:
        from fastapi.responses import StreamingResponse
        import json

        chunk = {"id": out["id"], "object": "chat.completion.chunk", "created": out["created"], "model": body.model,
                 "choices": [{"index": 0, "delta": msg, "finish_reason": "stop"}]}
        return StreamingResponse(iter([f"data: {json.dumps(chunk)}\n\n", "data: [DONE]\n\n"]), media_type="text/event-stream")
    return out
