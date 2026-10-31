"""AutoResearchClaw worker: runs inside its own container, away from the app's data and secrets.

HTTP API (stdlib only; every request needs `Authorization: Bearer $CLAW_TOKEN`):
  POST /runs                {"topic", "llm_key", "llm_base_url"}  -> {"id"}
  GET  /runs/<id>           -> {"status", "log", "returncode", "pdf", "error"}
  GET  /runs/<id>/pdf       -> the largest PDF the run produced
  POST /runs/<id>/cancel

The container holds no app secrets. Its only paid resource is the per-run LLM key, which the backend issues with a
budget, and its network is blocked from the cloud metadata endpoint by the host firewall.
"""
from __future__ import annotations

import hmac
import json
import os
import re
import signal
import subprocess
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

TOKEN = os.environ.get("CLAW_TOKEN", "")
WORK = Path(os.environ.get("CLAW_WORK", "/work"))
MAX_RUNTIME = int(os.environ.get("CLAW_MAX_RUNTIME", str(3 * 3600)))
MAX_RETRIES = 2
# Failures in these stages usually mean the generated experiment code was broken: regenerate it.
EXPERIMENT_STAGES = {"CODE_GENERATION", "RESOURCE_PLANNING", "EXPERIMENT_RUN", "ITERATIVE_REFINE"}
FAILED_RE = re.compile(r"Stage \d{2}/23 ([A-Z_]+) — FAILED")
RUNS: dict[str, dict] = {}
LOCK = threading.Lock()

CONFIG = """project:
  name: "cite-and-slayy"
  mode: "full-auto"
research:
  topic: {topic}
  domains: ["machine-learning"]
  quality_threshold: 4.0
runtime:
  timezone: "UTC"
  max_parallel_tasks: 2
  approval_timeout_hours: 1
  retry_limit: 2
notifications:
  channel: "console"
  target: ""
knowledge_base:
  backend: "markdown"
  root: "kb"
llm:
  provider: "openai-compatible"
  base_url: {base_url}
  wire_api: "chat_completions"
  api_key_env: "RC_LLM_KEY"
  api_key: ""
  primary_model: "azora-pro"
  fallback_models: []
literature_search:
  sources: ["openalex", "semantic_scholar", "arxiv"]
  max_results_per_query: 30
  inter_query_delay_sec: 1.5
  openalex_email: {email}
security:
  hitl_required_stages: []
  allow_publish_without_approval: true
  redact_sensitive_logs: true
experiment:
  mode: "sandbox"
  time_budget_sec: 420
  max_iterations: 6
  metric_key: "primary_metric"
  metric_direction: "maximize"
  sandbox:
    python_path: "/usr/local/bin/python3"
    gpu_required: false
    max_memory_mb: 3072
  opencode:
    enabled: false
"""


def _q(s: str) -> str:
    return json.dumps(str(s))   # a JSON string is a valid YAML scalar


def _start(topic: str, llm_key: str, base_url: str) -> str:
    rid = uuid.uuid4().hex[:12]
    d = WORK / rid
    d.mkdir(parents=True)
    (d / "config.yaml").write_text(CONFIG.format(topic=_q(topic), base_url=_q(base_url),
                                                 email=_q(os.environ.get("CONTACT_EMAIL", "slayyhacks@gmail.com"))))
    env = {"PATH": os.environ.get("CLAW_PATH", "/usr/local/bin:/usr/bin:/bin"), "HOME": str(d), "RC_LLM_KEY": llm_key, "MPLBACKEND": "Agg",
           "PYTHONUNBUFFERED": "1", "OPENBLAS_NUM_THREADS": "2", "OMP_NUM_THREADS": "2"}
    for k in ("OPENALEX_API_KEY", "S2_API_KEY"):
        if os.environ.get(k):
            env[k] = os.environ[k]
    with LOCK:
        RUNS[rid] = {"proc": None, "dir": d, "started": time.time(), "error": "", "topic": topic, "env": env, "retries": 0}
    _launch(rid)
    threading.Thread(target=_watch, args=(rid,), daemon=True, name=f"watch-{rid}").start()
    return rid


def _launch(rid: str, from_stage: str | None = None) -> None:
    r = RUNS[rid]
    d = r["dir"]
    cmd = ["researchclaw", "run", "--topic", r["topic"], "--config", str(d / "config.yaml"), "--output", str(d / "out"), "--auto-approve"]
    if from_stage:
        cmd += ["--from-stage", from_stage, "--skip-preflight"]
    log = open(d / "run.log", "a")
    if from_stage:
        log.write(f"\n[worker] Retry {r['retries']}/{MAX_RETRIES}: restarting from {from_stage}\n")
        log.flush()
    r["proc"] = subprocess.Popen(cmd, cwd=d, env=r["env"], stdout=log, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                                 start_new_session=True)


def _watch(rid: str) -> None:
    r = RUNS[rid]
    deadline = r["started"] + MAX_RUNTIME
    while True:
        try:
            r["proc"].wait(timeout=max(1, deadline - time.time()))
        except subprocess.TimeoutExpired:
            r["error"] = f"stopped after {MAX_RUNTIME // 3600} h"
            _kill(r["proc"])
            return
        if r["proc"].returncode == 0 or r.get("cancelled") or r["retries"] >= MAX_RETRIES:
            return
        failed = FAILED_RE.findall((r["dir"] / "run.log").read_text(errors="replace"))
        if not failed:
            return
        stage = "CODE_GENERATION" if failed[-1] in EXPERIMENT_STAGES else failed[-1]
        r["retries"] += 1
        _launch(rid, stage)


def _kill(proc) -> None:
    try:
        os.killpg(proc.pid, signal.SIGTERM)
        time.sleep(5)
        os.killpg(proc.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass


def _pdf(d: Path) -> Path | None:
    pdfs = [p for p in (d / "out").rglob("*.pdf")] if (d / "out").exists() else []
    pdfs += [p for p in d.rglob("deliverables/*.pdf")]
    pdfs = sorted(set(pdfs), key=lambda p: p.stat().st_size, reverse=True)
    return pdfs[0] if pdfs else None


def _status(rid: str) -> dict:
    r = RUNS[rid]
    rc = r["proc"].poll()
    if rc is not None and rc != 0 and r["retries"] < MAX_RETRIES and not r.get("cancelled") and threading.active_count() > 1 \
            and any(t.name == f"watch-{rid}" and t.is_alive() for t in threading.enumerate()):
        rc = None                                  # the watcher is about to retry; report "running"
    lines = (r["dir"] / "run.log").read_text(errors="replace").splitlines()[-80:]
    # never echo the run key back
    lines = [re.sub(r"rc-[A-Za-z0-9_\-]{20,}", "rc-***", ln) for ln in lines]
    status = "running" if rc is None else ("done" if rc == 0 and _pdf(r["dir"]) else "error")
    return {"status": status, "returncode": rc, "log": lines, "pdf": bool(_pdf(r["dir"])), "error": r["error"],
            "elapsed": int(time.time() - r["started"])}


class Handler(BaseHTTPRequestHandler):
    def _auth(self) -> bool:
        got = (self.headers.get("Authorization") or "").removeprefix("Bearer ").strip()
        if not TOKEN or not hmac.compare_digest(got, TOKEN):
            self._json(401, {"error": "unauthorized"})
            return False
        return True

    def _json(self, code: int, obj: dict) -> None:
        data = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *a):   # keep request logs out of stdout
        pass

    def do_GET(self):
        if not self._auth():
            return
        m = re.fullmatch(r"/runs/([0-9a-f]{12})(/pdf)?", self.path)
        if not m or m.group(1) not in RUNS:
            return self._json(404, {"error": "not found"})
        if m.group(2):
            p = _pdf(RUNS[m.group(1)]["dir"])
            if not p:
                return self._json(404, {"error": "no pdf yet"})
            data = p.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "application/pdf")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        self._json(200, _status(m.group(1)))

    def do_POST(self):
        if not self._auth():
            return
        n = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(min(n, 100_000)) or b"{}")
        if self.path == "/runs":
            topic = " ".join(str(body.get("topic", "")).split())[:300]
            key, base = str(body.get("llm_key", "")), str(body.get("llm_base_url", ""))
            if len(topic) < 4 or not key.startswith("rc-") or not base.startswith("http://backend:"):
                return self._json(400, {"error": "topic, llm_key and llm_base_url are required"})
            with LOCK:
                busy = sum(1 for r in RUNS.values() if r["proc"] is not None and r["proc"].poll() is None)
            if busy >= 1:
                return self._json(429, {"error": "a run is already in progress; try again when it finishes"})
            return self._json(200, {"id": _start(topic, key, base)})
        m = re.fullmatch(r"/runs/([0-9a-f]{12})/cancel", self.path)
        if m and m.group(1) in RUNS:
            RUNS[m.group(1)]["cancelled"] = True
            _kill(RUNS[m.group(1)]["proc"])
            return self._json(200, {"ok": True})
        self._json(404, {"error": "not found"})


if __name__ == "__main__":
    WORK.mkdir(parents=True, exist_ok=True)
    ThreadingHTTPServer(("0.0.0.0", 8100), Handler).serve_forever()
