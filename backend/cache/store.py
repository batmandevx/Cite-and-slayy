"""SQLite persistence.

Two tables:
- api_cache: raw bodies of *successful* external API responses, keyed by request hash.
  These are real responses with their fetch time; failures are never cached.
- objects: JSON documents for app state (gap radar runs, audits, verdicts, documents).
"""
from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.common.config import get_settings

_SCHEMA = """
CREATE TABLE IF NOT EXISTS api_cache (
  key TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  url TEXT NOT NULL,
  status INTEGER NOT NULL,
  body TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS owners (
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  uid TEXT NOT NULL,
  PRIMARY KEY (kind, id)
);
CREATE INDEX IF NOT EXISTS owners_uid ON owners (uid, kind);
CREATE TABLE IF NOT EXISTS objects (
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  body TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (kind, id)
);
"""


def now() -> datetime:
    return datetime.now(timezone.utc)


class Store:
    def __init__(self, path: Path):
        self.path = path
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(path, check_same_thread=False)
        self._conn.executescript(_SCHEMA)
        self._conn.commit()

    # ----- api cache -----
    @staticmethod
    def request_key(method: str, url: str, params: dict | None) -> str:
        canon = json.dumps({"m": method.upper(), "u": url, "p": params or {}}, sort_keys=True)
        return hashlib.sha256(canon.encode()).hexdigest()

    def cache_get(self, key: str) -> tuple[Any, datetime] | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT body, fetched_at FROM api_cache WHERE key=?", (key,)).fetchone()
        if not row:
            return None
        return json.loads(row[0]), datetime.fromisoformat(row[1])

    def cache_put(self, key: str, source: str, url: str, status: int, body: Any) -> datetime:
        ts = now()
        with self._lock:
            self._conn.execute(
                "INSERT OR REPLACE INTO api_cache VALUES (?,?,?,?,?,?)",
                (key, source, url, status, json.dumps(body), ts.isoformat()))
            self._conn.commit()
        return ts

    # ----- objects -----
    def put(self, kind: str, id: str, obj: Any) -> None:
        body = obj.model_dump_json() if hasattr(obj, "model_dump_json") else json.dumps(obj, default=str)
        with self._lock:
            self._conn.execute(
                "INSERT OR REPLACE INTO objects VALUES (?,?,?,?)",
                (kind, id, body, now().isoformat()))
            self._conn.commit()

    def get(self, kind: str, id: str) -> dict | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT body FROM objects WHERE kind=? AND id=?", (kind, id)).fetchone()
        return json.loads(row[0]) if row else None

    # ----- ownership (per-user data isolation) -----
    def set_owner(self, kind: str, id: str, uid: str) -> None:
        with self._lock:
            self._conn.execute("INSERT OR IGNORE INTO owners VALUES (?,?,?)", (kind, id, uid))
            self._conn.commit()

    def owner_of(self, kind: str, id: str) -> str | None:
        with self._lock:
            row = self._conn.execute("SELECT uid FROM owners WHERE kind=? AND id=?", (kind, id)).fetchone()
        return row[0] if row else None

    def owned_ids(self, kind: str, uid: str) -> set[str]:
        with self._lock:
            rows = self._conn.execute("SELECT id FROM owners WHERE kind=? AND uid=?", (kind, uid)).fetchall()
        return {r[0] for r in rows}

    def list(self, kind: str, limit: int = 50) -> list[dict]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT body FROM objects WHERE kind=? ORDER BY updated_at DESC LIMIT ?",
                (kind, limit)).fetchall()
        return [json.loads(r[0]) for r in rows]


_store: Store | None = None


def get_store() -> Store:
    global _store
    if _store is None:
        _store = Store(get_settings().data_dir / "slayy.sqlite3")
    return _store
