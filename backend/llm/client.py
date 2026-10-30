"""Provider-agnostic LLM wrapper.

LLM_PROVIDER selects auto | anthropic | openai | gemini | bedrock | ollama | none;
LLM_FALLBACK (comma-separated) lists providers to try, in order, if the primary fails.
`auto` uses a running local Ollama model first (no API cost), else the first cloud provider with a key.
When nothing is available, `available()` is False and callers report "not assessed" rather than guess.

Only two entry points:
    await complete(system, prompt)                 -> str
    await complete_json(system, prompt, Model)     -> validated Pydantic instance
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import re
import time
from contextvars import ContextVar
from typing import Any, Literal, TypeVar

import httpx

from pydantic import BaseModel, ValidationError

from backend.common.config import get_settings

T = TypeVar("T", bound=BaseModel)
Effort = Literal["low", "medium", "high"]
Tier = Literal["main", "fast"]


class LLMError(Exception):
    pass


_ollama_cache: tuple[float, str | None] = (0.0, None)

# Paid plans run papers and reviews on the premium engine. Set per request; asyncio tasks inherit it.
_premium: ContextVar[bool] = ContextVar("premium_engine", default=False)


def set_premium(on: bool) -> None:
    _premium.set(on)


# Cost metering: the user whose monthly AI budget this call is charged to (None = not metered).
_meter: ContextVar[str | None] = ContextVar("meter_uid", default=None)
_last_usage: ContextVar[tuple[int, int] | None] = ContextVar("last_usage", default=None)

# USD per 1M tokens (input, output). Claude: Anthropic list prices. Others: conservative placeholders; set the real
# Bedrock/Gemini rates with PRICE_OVERRIDES='{"moonshotai.kimi-k2.5": [in, out]}' after checking the pricing pages.
PRICES = {"claude-opus-5-5": (4.0, 20.0), "claude-sonnet-5-5": (2.0, 10.0), "claude-haiku-5-5": (0.10, 0.50)}
DEFAULT_PRICE = (1.0, 4.0)


def set_meter(uid: str | None) -> None:
    _meter.set(uid)


def _price(model: str) -> tuple[float, float]:
    over = get_settings().price_overrides or {}
    if model in over:
        return tuple(over[model])  # type: ignore[return-value]
    return PRICES.get(model.removeprefix("anthropic."), DEFAULT_PRICE if model else (0.0, 0.0))


def _note_usage(i: int, o: int) -> None:
    _last_usage.set((int(i), int(o)))


def _charge(provider: str, model: str, system: str, prompt: str, text: str) -> None:
    uid = _meter.get()
    used = _last_usage.get()
    _last_usage.set(None)
    if not uid or provider == "ollama":
        return
    i, o = used if used else ((len(system) + len(prompt)) // 4, len(text) // 4)   # estimate when the API gave no usage
    pin, pout = _price(model)
    usd = i / 1e6 * pin + o / 1e6 * pout
    from backend.cache.store import get_store
    from datetime import datetime, timezone
    key = f"{uid}:cost:{datetime.now(timezone.utc):%Y-%m}"
    store = get_store()
    rec = store.get("usage", key) or {"usd": 0.0, "in": 0, "out": 0, "calls": 0}
    store.put("usage", key, {"usd": rec["usd"] + usd, "in": rec["in"] + i, "out": rec["out"] + o, "calls": rec["calls"] + 1})


def premium_available() -> bool:
    return bool(get_settings().anthropic_api_key)


def _ollama_model() -> str | None:
    """Model to use on the local Ollama server (None if Ollama isn't reachable). Cached for 30 s."""
    global _ollama_cache
    if time.monotonic() - _ollama_cache[0] < 30:
        return _ollama_cache[1]
    s = get_settings()
    model = None
    try:
        tags = httpx.get(f"{s.ollama_url}/api/tags", timeout=1.0).json().get("models", [])
        names = [m["name"] for m in tags if "embed" not in m["name"]]
        if s.ollama_model:
            model = s.ollama_model if any(n.split(":")[0] == s.ollama_model.split(":")[0] for n in names) else None
        elif names:
            # Prefer text/instruct models over vision ones (better at long JSON-structured reviews).
            names.sort(key=lambda n: any(t in n.lower() for t in ("vl", "vision", "llava")))
            model = names[0]
    except (httpx.HTTPError, ValueError):
        model = None
    _ollama_cache = (time.monotonic(), model)
    return model


def _usable(provider: str) -> tuple[str, str] | None:
    """(provider, model) if that provider is configured / reachable, else None."""
    s = get_settings()
    keys = {"anthropic": s.anthropic_api_key, "openai": s.openai_api_key, "gemini": s.gemini_api_key}
    if provider in keys:
        return (provider, s.default_model_for(provider)) if keys[provider] else None
    if provider == "bedrock":
        return ("bedrock", s.default_model_for("bedrock")) if s.bedrock_region else None
    if provider == "ollama":
        m = _ollama_model()
        return ("ollama", m) if m else None
    return None


def chain(tier: Tier = "main") -> list[tuple[str, str]]:
    """Primary provider followed by usable fallbacks (LLM_FALLBACK, comma-separated), without duplicates.
    tier="fast" swaps in each provider's cheaper model (e.g. Claude Haiku) for high-volume, simple tasks."""
    s = get_settings()
    primary = resolve()
    out = [primary] if primary[0] != "none" else []
    for p in [x.strip() for x in (s.llm_fallback or "").split(",") if x.strip()]:
        u = _usable(p)
        if u and all(u[0] != q for q, _ in out):
            out.append(u)
    if tier == "fast":
        out = [(p, m if p == "ollama" else s.fast_model_for(p)) for p, m in out]
    if _premium.get() and s.anthropic_api_key:
        prem = ("anthropic", s.premium_model if tier == "main" else s.premium_model_fast)
        out = [prem] + [x for x in out if x != prem]   # standard engine stays as the fallback
    return out


def resolve() -> tuple[str, str]:
    """(provider, model) actually in use; provider 'none' if nothing is usable."""
    s = get_settings()
    keys = {"anthropic": s.anthropic_api_key, "openai": s.openai_api_key, "gemini": s.gemini_api_key}
    if s.llm_provider in (*keys, "bedrock", "ollama"):
        return _usable(s.llm_provider) or ("none", "")
    if s.llm_provider == "auto":
        # Local first: free and private. Cloud keys are only a fallback when Ollama isn't running.
        m = _ollama_model()
        if m:
            return "ollama", m
        for p, k in keys.items():
            if k:
                return p, s.default_model_for(p)
    return "none", ""


def available() -> bool:
    return bool(chain())


def is_local() -> bool:
    return resolve()[0] == "ollama"


def context_chars() -> int:
    """How much paper text one request may carry. Small local models get a condensed text."""
    return 28_000 if is_local() else 150_000


def describe() -> dict[str, Any]:
    provider, model = resolve()
    fallbacks = [f"{p}:{m}" for p, m in chain()[1:]]
    if provider == "none" and chain():   # primary unusable, a fallback will answer
        provider, model = chain()[0]
    fast = chain("fast")
    return {"provider": provider, "model": model, "available": bool(chain()), "local": provider == "ollama",
            "configured": get_settings().llm_provider, "fallbacks": fallbacks,
            "fast_model": fast[0][1] if fast else ""}


_VENDOR = re.compile(r"(?i)\b(?:bedrock|moonshotai\.[\w.:-]+|kimi[\w.:-]*|gemini[\w.:-]*|anthropic[\w.:-]*|claude[\w.:-]*|"
                     r"ollama|qwen[\w.:-]*|openai|gpt-[\w.-]+|glm[\w.-]*|deepseek[\w.-]*|amazon|aws|boto\w*|botocore)\b")


def scrub(text: str) -> str:
    """Remove vendor / model names from text that may reach users (errors, notes)."""
    return _VENDOR.sub("AI service", text)


def public_describe() -> dict[str, Any]:
    """What API clients see: whether AI is up, never which vendor or model powers it (that stays server-side)."""
    d = describe()
    return {"provider": "azora" if d["available"] else "none", "model": "Azora engine", "available": d["available"],
            "local": d["local"], "fallbacks": [], "fast_model": ""}


# ---------- JSON schema helpers ----------

_KEEP = {"type", "properties", "required", "items", "enum", "description", "anyOf", "$defs", "$ref", "title", "const"}


def strict_schema(model: type[BaseModel]) -> dict:
    """Pydantic schema -> strict JSON schema accepted by structured-output APIs.
    Range constraints are dropped here and re-enforced by Pydantic validation afterwards."""
    def walk(node: Any) -> Any:
        if isinstance(node, dict):
            out = {}
            for k, v in node.items():
                if k not in _KEEP:
                    continue
                if k in ("properties", "$defs"):   # keys here are names, not schema keywords
                    out[k] = {name: walk(sub) for name, sub in v.items()}
                else:
                    out[k] = walk(v)
            if out.get("type") == "object" or "properties" in out:
                out["additionalProperties"] = False
                out["required"] = list(out.get("properties", {}).keys())
            return out
        if isinstance(node, list):
            return [walk(x) for x in node]
        return node
    return walk(model.model_json_schema())


def _extract_json(text: str) -> Any:
    text = text.strip()
    m = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if m:
        text = m.group(1)
    start = min([i for i in (text.find("{"), text.find("[")) if i >= 0], default=-1)
    if start > 0:
        text = text[start:]
    return json.loads(text)


# ---------- providers ----------

async def _anthropic(system: str, prompt: str, schema: dict | None, effort: Effort, max_tokens: int, model: str) -> str:
    import anthropic

    s = get_settings()
    client = anthropic.AsyncAnthropic(api_key=s.anthropic_api_key)
    output_config: dict[str, Any] = {"effort": effort}
    if schema:
        output_config["format"] = {"type": "json_schema", "schema": schema}
    try:
        resp = await client.beta.messages.create(
            model=model,
            max_tokens=max(max_tokens, 16000),   # thinking is always on and counts toward max_tokens
            system=system,
            messages=[{"role": "user", "content": prompt}],
            output_config=output_config,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
    except anthropic.RateLimitError as e:
        raise LLMError(f"anthropic rate limited: {e}") from e
    except anthropic.APIStatusError as e:
        raise LLMError(f"anthropic HTTP {e.status_code}: {e.message}") from e
    except anthropic.APIConnectionError as e:
        raise LLMError(f"anthropic connection error: {e}") from e
    if getattr(resp, "usage", None):
        _note_usage(resp.usage.input_tokens or 0, resp.usage.output_tokens or 0)
    if resp.stop_reason == "refusal":
        raise LLMError("model declined the request")
    if resp.stop_reason == "max_tokens":
        raise LLMError("response truncated at max_tokens")
    return "".join(b.text for b in resp.content if getattr(b, "type", None) == "text")


async def _openai(system: str, prompt: str, schema: dict | None, effort: Effort, max_tokens: int, model: str) -> str:
    from openai import AsyncOpenAI, OpenAIError

    s = get_settings()
    client = AsyncOpenAI(api_key=s.openai_api_key)
    kwargs: dict[str, Any] = {}
    if schema:
        kwargs["response_format"] = {"type": "json_object"}
        system += "\nRespond with a single JSON object matching this schema:\n" + json.dumps(schema)
    try:
        resp = await client.chat.completions.create(
            model=model,
            messages=[{"role": "system", "content": system}, {"role": "user", "content": prompt}],
            **kwargs,
        )
    except OpenAIError as e:
        raise LLMError(f"openai error: {e}") from e
    return resp.choices[0].message.content or ""


async def _gemini(system: str, prompt: str, schema: dict | None, effort: Effort, max_tokens: int, model: str) -> str:
    from google import genai
    from google.genai import types

    s = get_settings()
    client = genai.Client(api_key=s.gemini_api_key)
    if schema:
        system += "\nRespond with a single JSON object matching this schema:\n" + json.dumps(schema)
    try:
        resp = await client.aio.models.generate_content(
            model=model, contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=system,
                response_mime_type="application/json" if schema else "text/plain",
            ),
        )
    except Exception as e:  # google-genai raises several unrelated error types
        raise LLMError(f"gemini error: {e}") from e
    return resp.text or ""


_runtime_clients: dict[str, Any] = {}


def _bedrock_runtime(region: str | None):
    """One reused client per region with explicit timeouts: boto3's defaults (60 s read timeout + silent retries)
    turned one stalled 11-second call into a 15-minute wait during testing."""
    import boto3
    from botocore.config import Config

    key = region or ""
    if key not in _runtime_clients:
        _runtime_clients[key] = boto3.client(
            "bedrock-runtime", region_name=region,
            config=Config(connect_timeout=10, read_timeout=180, retries={"max_attempts": 2, "mode": "standard"},
                          max_pool_connections=16))
    return _runtime_clients[key]


def _converse_sync(system: str, prompt: str, schema: dict | None, max_tokens: int, model: str) -> tuple[str, tuple[int, int] | None]:
    """Any non-Claude Bedrock model (Kimi, GLM, DeepSeek, Qwen, ...) via the Converse API."""
    import botocore.exceptions

    if schema:
        system += ("\nRespond with a single JSON object (no code fences, no prose) matching this JSON schema:\n"
                   + json.dumps(schema))
    client = _bedrock_runtime(get_settings().bedrock_region)
    try:
        r = client.converse(
            modelId=model,
            system=[{"text": system}],
            messages=[{"role": "user", "content": [{"text": prompt}]}],
            inferenceConfig={"maxTokens": min(max_tokens, 8192)},   # no temperature: some models (Kimi K3) reject it
        )
    except botocore.exceptions.ClientError as e:
        err = e.response.get("Error", {})
        raise LLMError(f"bedrock {err.get('Code')}: {err.get('Message', '')[:200]}") from e
    except botocore.exceptions.BotoCoreError as e:
        raise LLMError(f"bedrock client error: {e}") from e
    u = r.get("usage") or {}
    usage = (u.get("inputTokens", 0), u.get("outputTokens", 0)) if u else None
    stop = r.get("stopReason")
    if stop == "max_tokens":
        raise LLMError("response truncated at max_tokens")
    if stop in ("content_filtered", "guardrail_intervened"):
        raise LLMError(f"model declined the request ({stop})")
    return "".join(c.get("text", "") for c in r["output"]["message"]["content"]), usage   # skips reasoning blocks


async def _bedrock(system: str, prompt: str, schema: dict | None, effort: Effort, max_tokens: int, model: str) -> str:
    """Amazon Bedrock. Claude models (`anthropic.*`) use the Messages API on bedrock-mantle; every other model
    (Kimi, GLM, DeepSeek, Qwen, ...) uses the Converse API. Credentials come from the standard AWS chain - on EC2
    that is the instance role, so no keys live on the server. Errors raise LLMError so LLM_FALLBACK can take over."""
    if not model.startswith("anthropic."):
        text, usage = await asyncio.to_thread(_converse_sync, system, prompt, schema, max_tokens, model)
        if usage:
            _note_usage(*usage)
        return text
    import anthropic
    from anthropic import AsyncAnthropicBedrockMantle

    client = AsyncAnthropicBedrockMantle(aws_region=get_settings().bedrock_region)
    output_config: dict[str, Any] = {"effort": effort}
    if schema:
        output_config["format"] = {"type": "json_schema", "schema": schema}
    try:
        resp = await client.messages.create(
            model=model,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": prompt}],
            output_config=output_config,
        )
    except anthropic.RateLimitError as e:
        raise LLMError(f"bedrock rate limited: {e}") from e
    except anthropic.APIStatusError as e:
        raise LLMError(f"bedrock HTTP {e.status_code}: {e.message}") from e
    except anthropic.APIConnectionError as e:
        raise LLMError(f"bedrock connection error: {e}") from e
    except anthropic.AnthropicError as e:   # e.g. no AWS credentials found
        raise LLMError(f"bedrock client error: {e}") from e
    if resp.stop_reason == "refusal":
        raise LLMError("model declined the request")
    if resp.stop_reason == "max_tokens":
        raise LLMError("response truncated at max_tokens")
    return "".join(b.text for b in resp.content if getattr(b, "type", None) == "text")


_ollama_lock: asyncio.Semaphore | None = None
_ollama_lock_loop: asyncio.AbstractEventLoop | None = None


async def _ollama(system: str, prompt: str, schema: dict | None, effort: Effort, max_tokens: int, model: str) -> str:
    """Local model via Ollama's /api/chat. One request at a time (it shares the machine's GPU/CPU)."""
    global _ollama_lock, _ollama_lock_loop
    loop = asyncio.get_running_loop()
    if _ollama_lock is None or _ollama_lock_loop is not loop:
        _ollama_lock, _ollama_lock_loop = asyncio.Semaphore(1), loop
    s = get_settings()
    body: dict[str, Any] = {
        "model": model, "stream": False,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}],
        "options": {"temperature": 0, "num_ctx": 16384, "num_predict": min(max_tokens, 4096)},
    }
    if schema:
        body["format"] = schema
    # Reasoning models (Qwen 3.x etc.) would otherwise spend minutes "thinking" before each JSON answer.
    body["think"] = False
    async with _ollama_lock:
        try:
            async with httpx.AsyncClient(timeout=600) as client:
                r = await client.post(f"{s.ollama_url}/api/chat", json=body)
                if r.status_code == 400 and "think" in r.text.lower():   # model without a thinking switch
                    body.pop("think")
                    r = await client.post(f"{s.ollama_url}/api/chat", json=body)
        except httpx.HTTPError as e:
            raise LLMError(f"ollama connection error: {type(e).__name__}") from e
    if r.status_code != 200:
        raise LLMError(f"ollama HTTP {r.status_code}: {r.text[:200]}")
    return (r.json().get("message") or {}).get("content", "")


_PROVIDERS = {"anthropic": _anthropic, "openai": _openai, "gemini": _gemini, "ollama": _ollama, "bedrock": _bedrock}


def _cache_key(system: str, prompt: str, schema: dict | None, provider: str = "", model: str = "") -> str:
    return hashlib.sha256(json.dumps([provider, model, system, prompt, schema], sort_keys=True).encode()).hexdigest()


async def _call(system: str, prompt: str, schema: dict | None, effort: Effort, max_tokens: int, use_cache: bool,
                tier: Tier = "main") -> str:
    """Try the primary provider, then each fallback in LLM_FALLBACK. Responses are cached per (provider, model, prompt):
    identical requests return the stored real output, which makes re-runs reproducible and instant (e.g. a live demo)."""
    from backend.cache.store import get_store

    store = get_store()
    errors: list[str] = []
    for provider, model in chain(tier):
        key = _cache_key(system, prompt, schema, provider, model)
        if use_cache and (hit := store.get("llm_cache", key)):
            return hit["text"]
        try:
            text = await _PROVIDERS[provider](system, prompt, schema, effort, max_tokens, model)
        except LLMError as e:
            errors.append(f"{provider}: {e}")
            continue
        store.put("llm_cache", key, {"text": text, "provider": provider, "model": model})
        _charge(provider, model, system, prompt, text)
        return text
    raise LLMError("; ".join(errors) or "no LLM available")


async def complete(system: str, prompt: str, *, effort: Effort = "medium", max_tokens: int = 16000,
                   tier: Tier = "main") -> str:
    if not available():
        raise LLMError("no LLM available (set an API key or run Ollama locally)")
    return await _call(system, prompt, None, effort, max_tokens, use_cache=True, tier=tier)


async def complete_json(system: str, prompt: str, model: type[T], *, effort: Effort = "medium",
                        max_tokens: int = 16000, tier: Tier = "main") -> T:
    if not available():
        raise LLMError("no LLM available (set an API key or run Ollama locally)")
    schema = strict_schema(model)
    last: Exception | None = None
    for attempt in range(2):  # one retry on invalid output (the retry bypasses the cache)
        text = await _call(system, prompt, schema, effort, max_tokens, use_cache=attempt == 0, tier=tier)
        try:
            return model.model_validate(_extract_json(text))
        except (ValueError, ValidationError) as e:
            last = e
    raise LLMError(f"invalid structured output: {last}")
