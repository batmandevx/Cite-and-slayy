"""Azora AI: an agentic research assistant.

Each user turn runs a plan → act → observe loop (up to MAX_STEPS tool calls). The model answers with a JSON
action through the provider-agnostic structured-output path, so the same agent works on Bedrock (Kimi / Claude),
Gemini or a local Ollama model. Every step (including reasoning thoughts and live tool telemetry) is streamed to
the UI as a job event.
"""
from __future__ import annotations

import json
import uuid
from typing import Any

from pydantic import BaseModel, field_validator

from backend.agent.tools import TOOLS, ToolError, describe
from backend.cache.store import get_store, now
from backend.llm import client as llm
from backend.sources.http import SourceError

MAX_STEPS = 6
HISTORY_TURNS = 10

SYSTEM = f"""You are Azora AI, the agentic research copilot inside Cite & Slayy — a decision layer that helps researchers
decide what to research (Gap Radar), whether to trust a paper (CiteGuard), and whether it is ready to submit (Reviewer Jury).
You are warm, sharp, scientific, and proactive: you don't just chat — you run real experiments, test hypotheses, verify citations,
and organize actionable artifacts in the user's workspace.

You act through 15 real tools backed by live scholarly APIs and the workspace database:
{describe()}

How to work:
- When brainstorming, comparing ideas, checking venues, or testing claims: proactively run experiments (`search_papers`, `trend_experiment`, `venue_fit_experiment`, `text_integrity_test`, `check_citation`, `check_retraction`, `test_claim`) so your advice is backed by real numbers and charts!
- When the user asks you to save an outline, experiment plan, brainstorm sticky cards, or action items (or says "save this", "make a plan", "add to my tasks/notes"), use `save_note`, `pin_stickies`, or `add_todos` so it actually lands in their workspace!
- Never fabricate papers, DOIs, citation counts, venues, or retraction statuses. If an API fails or returns nothing, report "could not verify" or empty results honestly.
- Chain tools cleanly when helpful (e.g. `search_papers` + `trend_experiment` + `save_note`; or `list_papers` → `audit_paper` → `review_paper`).
- Mention caveats when relevant (e.g. latest publication year is partial; short case-insensitive acronyms in `trend_experiment`).
- At most {MAX_STEPS} tool calls per turn.
- If asked what model, company or software powers you, say you are Azora AI, the research assistant built into Cite & Slayy,
  and that details of the underlying technology are not shared. Never name an AI vendor or model.
- For a full paper from a topic, point the user to Paper Studio (sidebar, Workspace).

Reply with ONE JSON object every time:
{{"thought": "1-sentence transparent reasoning step shown in the agent trace",
  "tool": "<tool name>" or "",
  "args_json": "<JSON object of arguments>" or "{{}}",
  "reply": "" while calling a tool; otherwise your complete Markdown answer to the user}}
When "tool" is empty, "reply" must be your complete answer. Use clear headings/bullets, bold key empirical findings, and suggest a concrete next experiment."""


class _Step(BaseModel):
    thought: str
    tool: str
    args_json: str
    reply: str

    @field_validator("args_json", mode="before")
    @classmethod
    def _args_as_text(cls, v):
        """Models sometimes send the arguments as an object instead of a JSON string; accept both."""
        if v is None:
            return "{}"
        return v if isinstance(v, str) else json.dumps(v)

    @field_validator("thought", "tool", "reply", mode="before")
    @classmethod
    def _none_to_empty(cls, v):
        return "" if v is None else v


def _history_text(messages: list[dict]) -> str:
    out = []
    for m in messages[-HISTORY_TURNS * 2:]:
        if m["role"] == "user":
            out.append(f"User: {m['content']}")
        else:
            tools = "; ".join(f"{t['name']} → {t.get('summary', '')}" for t in m.get("tools", []))
            out.append(f"Azora: {m['content']}" + (f"\n(tools used: {tools})" if tools else ""))
    return "\n\n".join(out)


def _clip(obj: Any, limit: int = 3500) -> str:
    s = json.dumps(obj, default=str)
    return s if len(s) <= limit else s[:limit] + "…(truncated)"


async def run_turn(chat_id: str, user_message: str, ctx, images: list[tuple[str, bytes]] | None = None) -> str:
    store = get_store()
    chat = store.get("agent_chat", chat_id) or {"chat_id": chat_id, "messages": [], "created_at": now().isoformat()}
    chat["messages"].append({"role": "user", "content": user_message, "images": len(images or []), "at": now().isoformat()})
    store.put("agent_chat", chat_id, chat)
    if images:
        await ctx.update("tool_start", json.dumps({"id": "vision", "name": "read_images", "args": {"images": len(images)}, "slow": False}), None)
        try:
            seen = await llm.describe_images(images, user_message)
            user_message = (f"{user_message}\n\n[The user attached {len(images)} image(s). A vision model read them as follows; "
                            f"treat this as the image content]\n{seen[:6000]}")
            await ctx.update("tool_done", json.dumps({"id": "vision", "name": "read_images", "status": "done",
                                                      "summary": f"Read {len(images)} image(s): {seen[:140]}…"}), None)
        except llm.LLMError as e:
            await ctx.update("tool_done", json.dumps({"id": "vision", "name": "read_images", "status": "error",
                                                      "summary": llm.scrub(str(e))[:160]}), None)
            user_message += "\n\n[The user attached image(s), but they could not be read. Say so and ask them to describe it.]"

    async def event(kind: str, **payload):
        await ctx.update(kind, json.dumps(payload, default=str), None)

    if not llm.available():
        reply = ("I need an AI model to think with, and none is available right now. Add an API key in `.env` or start a local "
                 "model with Ollama. Meanwhile, the Audit and Explore tabs still work without me.")
        chat["messages"].append({"role": "assistant", "content": reply, "tools": [], "thoughts": [], "at": now().isoformat()})
        store.put("agent_chat", chat_id, chat)
        return chat_id

    history = _history_text(chat["messages"][:-1])
    scratch: list[str] = []
    tool_log: list[dict] = []
    thoughts: list[str] = []
    reply = ""
    for step in range(MAX_STEPS + 1):
        await event("thinking", step=step + 1, max_steps=MAX_STEPS)
        prompt = (f"Conversation so far:\n{history or '(new conversation)'}\n\nUser: {user_message}\n\n"
                  + ("Tool results so far this turn:\n" + "\n".join(scratch) + "\n\n" if scratch else "")
                  + ("You have used all tool calls: give your final answer now." if step == MAX_STEPS else "Next action?"))
        try:
            act = await llm.complete_json(SYSTEM, prompt, _Step, effort="medium", tier="chat")   # Nova Pro: cheap and quick
        except llm.LLMError as e:
            reply = f"Sorry, my AI call failed ({llm.scrub(str(e))[:160]}). Please try again in a moment."
            break
        tool = act.tool.strip()
        if act.thought and act.thought.strip():
            th = act.thought.strip()
            thoughts.append(th)
            await event("agent_thought", step=step + 1, thought=th, next_tool=tool or None)
        if not tool or step == MAX_STEPS:
            reply = act.reply.strip() or "Done."
            break
        if tool not in TOOLS:
            scratch.append(f"- {tool}: ERROR unknown tool (choose from {', '.join(TOOLS)})")
            continue
        try:
            args = json.loads(act.args_json or "{}")
            if not isinstance(args, dict):
                raise ValueError("args must be an object")
        except ValueError as e:
            scratch.append(f"- {tool}: ERROR invalid args_json ({e})")
            continue
        call_id = uuid.uuid4().hex[:8]
        await event("tool_start", id=call_id, name=tool, args=args, slow=TOOLS[tool].slow, thought=act.thought.strip())

        async def progress(msg: str, _id=call_id):
            await event("tool_progress", id=_id, message=msg)

        entry = {"id": call_id, "name": tool, "args": args, "thought": act.thought.strip()}
        try:
            result = await TOOLS[tool].fn(**args, emit=progress)
            entry.update(status="done", summary=result.get("summary", ""), link=result.get("link"),
                         chart=result.get("chart"), papers=result.get("papers"))
            scratch.append(f"- {tool}({_clip(args, 300)}) → {_clip({'summary': result.get('summary'), 'data': result.get('data')})}")
        except (ToolError, SourceError, llm.LLMError, ValueError, TypeError, KeyError) as e:
            entry.update(status="error", summary=llm.scrub(str(e))[:200])
            scratch.append(f"- {tool}: ERROR {llm.scrub(str(e))}")
        tool_log.append(entry)
        await event("tool_done", **entry)

    chat["messages"].append({
        "role": "assistant",
        "content": reply,
        "tools": tool_log,
        "thoughts": thoughts,
        "at": now().isoformat(),
    })
    if not chat.get("title"):
        chat["title"] = user_message[:60]
    store.put("agent_chat", chat_id, chat)
    return chat_id
