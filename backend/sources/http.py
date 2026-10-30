"""The only place Cite and Slayy talks to external scholarly APIs.

- Per-source rate limiting (min interval between requests).
- Retries on 429 / 5xx / network errors with backoff.
- Successful responses (2xx, and 404 which is a definitive "no such record") are
  cached in SQLite with their fetch time. Anything else raises SourceError, which
  callers must surface as "could not verify" - never as a negative or positive result.
"""
from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from urllib.parse import urlencode

import httpx

from backend.cache.store import get_store
from backend.common.config import get_settings


class SourceError(Exception):
    def __init__(self, source: str, url: str, reason: str):
        super().__init__(f"{source}: {reason} ({url})")
        self.source, self.url, self.reason = source, url, reason


@dataclass
class Fetched:
    data: Any               # parsed JSON / text, or None for 404
    status: int
    url: str                # full request URL (for evidence)
    fetched_at: datetime
    from_cache: bool


_client: httpx.AsyncClient | None = None
_client_loop: asyncio.AbstractEventLoop | None = None


def _http() -> httpx.AsyncClient:
    """One shared client per event loop (scripts and tests may run several loops)."""
    global _client, _client_loop
    loop = asyncio.get_running_loop()
    if _client is None or _client_loop is not loop:
        _client_loop = loop
        s = get_settings()
        ua = "CiteAndSlayy/0.1 (hackathon research-integrity tool"
        ua += f"; mailto:{s.contact_email})" if s.contact_email else ")"
        _client = httpx.AsyncClient(timeout=s.http_timeout, follow_redirects=True,
                                    headers={"User-Agent": ua})
    return _client


class SourceClient:
    def __init__(self, source: str, min_interval: float, headers: dict | None = None,
                 default_params: dict | None = None, max_concurrency: int = 4):
        self.source = source
        self.min_interval = min_interval
        self.headers = headers or {}
        self.default_params = {k: v for k, v in (default_params or {}).items() if v}
        self.max_concurrency = max_concurrency
        self._loop: asyncio.AbstractEventLoop | None = None
        self._last = 0.0

    def _bind(self) -> None:
        loop = asyncio.get_running_loop()
        if self._loop is not loop:   # asyncio primitives belong to one loop
            self._loop = loop
            self._lock = asyncio.Lock()
            self._sem = asyncio.Semaphore(self.max_concurrency)

    async def _wait_turn(self) -> None:
        async with self._lock:
            delta = time.monotonic() - self._last
            if delta < self.min_interval:
                await asyncio.sleep(self.min_interval - delta)
            self._last = time.monotonic()

    async def get(self, url: str, params: dict | None = None, *, as_text: bool = False,
                  use_cache: bool = True) -> Fetched:
        self._bind()
        public_params = dict(params or {})
        full_params = {**self.default_params, **public_params}
        public_url = f"{url}?{urlencode(public_params)}" if public_params else url
        store = get_store()
        key = store.request_key("GET", url, public_params)
        if use_cache:
            hit = store.cache_get(key)
            if hit is None and full_params != public_params:
                hit = store.cache_get(store.request_key("GET", url, full_params))
            if hit is not None:
                body, ts = hit
                return Fetched(body["data"], body["status"], public_url, ts, True)

        last_err = "unknown error"
        for attempt in range(6):
            async with self._sem:
                await self._wait_turn()
                try:
                    r = await _http().get(url, params=full_params, headers=self.headers)
                except httpx.HTTPError as e:
                    last_err = f"network error: {type(e).__name__}"
                    await asyncio.sleep(1.5 * (attempt + 1))
                    continue
            if r.status_code == 404:
                ts = store.cache_put(key, self.source, public_url, 404, {"data": None, "status": 404})
                return Fetched(None, 404, public_url, ts, False)
            if r.status_code == 429 or r.status_code >= 500:
                last_err = f"HTTP {r.status_code}"
                retry_after = r.headers.get("retry-after")
                delay = float(retry_after) if retry_after and retry_after.isdigit() else 2.0 * (attempt + 1)
                await asyncio.sleep(min(delay * (1.5 ** attempt), 20))
                continue
            if r.status_code >= 400:
                raise SourceError(self.source, public_url, f"HTTP {r.status_code}")
            try:
                data = r.text if as_text else r.json()
            except ValueError:
                raise SourceError(self.source, public_url, "invalid JSON in response")
            ts = store.cache_put(key, self.source, public_url, r.status_code,
                                 {"data": data, "status": r.status_code})
            return Fetched(data, r.status_code, public_url, ts, False)
        raise SourceError(self.source, public_url, last_err)

    async def post_json(self, url: str, payload: Any, params: dict | None = None) -> Fetched:
        """POST (used for Semantic Scholar batch). Cached by payload too."""
        self._bind()
        public_params = dict(params or {})
        full_params = {**self.default_params, **public_params}
        store = get_store()
        key = store.request_key("POST", url, {"params": public_params, "payload": payload})
        hit = store.cache_get(key)
        if hit is None and full_params != public_params:
            hit = store.cache_get(store.request_key("POST", url, {"params": full_params, "payload": payload}))
        if hit is not None:
            body, ts = hit
            return Fetched(body["data"], body["status"], url, ts, True)
        last_err = "unknown error"
        for attempt in range(4):
            async with self._sem:
                await self._wait_turn()
                try:
                    r = await _http().post(url, params=full_params, json=payload, headers=self.headers)
                except httpx.HTTPError as e:
                    last_err = f"network error: {type(e).__name__}"
                    await asyncio.sleep(1.5 * (attempt + 1))
                    continue
            if r.status_code == 429 or r.status_code >= 500:
                last_err = f"HTTP {r.status_code}"
                await asyncio.sleep(2.0 * (attempt + 1))
                continue
            if r.status_code >= 400:
                raise SourceError(self.source, url, f"HTTP {r.status_code}")
            data = r.json()
            ts = store.cache_put(key, self.source, url, r.status_code, {"data": data, "status": r.status_code})
            return Fetched(data, r.status_code, url, ts, False)
        raise SourceError(self.source, url, last_err)
