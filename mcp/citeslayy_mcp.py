#!/usr/bin/env python3
"""Cite & Slayy CiteGuard as an MCP tool any AI agent can call, paid per reference from a PayPal-funded wallet.

Standard library only, so it runs anywhere Python 3.9+ does. Speaks MCP over stdio (JSON-RPC 2.0, one message per line).

    CITESLAYY_AGENT_KEY=csk_...  CITESLAYY_API_URL=https://citeslayy.com  python3 mcp/citeslayy_mcp.py

Claude Code:     claude mcp add citeguard -e CITESLAYY_AGENT_KEY=csk_... -- python3 /path/to/mcp/citeslayy_mcp.py
Claude Desktop:  see README "Agent Pay" for the JSON config block.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

API = os.environ.get("CITESLAYY_API_URL", "http://localhost:8000").rstrip("/")
KEY = os.environ.get("CITESLAYY_AGENT_KEY", "")
PROTOCOL = "2025-06-18"

TOOLS = [
    {"name": "verify_references",
     "description": ("Check that academic references really exist, match their metadata and are not retracted, using "
                     "Crossref, arXiv, Semantic Scholar and OpenAlex. Costs a few cents per reference, paid from the "
                     "owner's PayPal-funded wallet within the owner's spending rules. If the result says needs_approval, "
                     "tell the user and call again later with the same references and the request_id."),
     "inputSchema": {"type": "object", "required": ["references"], "properties": {
         "references": {"type": "array", "items": {"type": "string"}, "minItems": 1, "maxItems": 200,
                        "description": "Full reference strings, one per item (as they'd appear in a bibliography)"},
         "request_id": {"type": "string", "description": "From an earlier needs_approval answer, once the owner approved"}}}},
    {"name": "quote_verification",
     "description": "Price for checking N references, the wallet balance and the owner's spending rules. Free.",
     "inputSchema": {"type": "object", "required": ["n"], "properties": {"n": {"type": "integer", "minimum": 1}}}},
    {"name": "check_approval",
     "description": "Whether the owner has approved or rejected a pending spending request. Free.",
     "inputSchema": {"type": "object", "required": ["request_id"], "properties": {"request_id": {"type": "string"}}}},
]


def _http(method: str, path: str, body: dict | None = None) -> dict:
    req = urllib.request.Request(f"{API}{path}", method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            detail = json.loads(e.read()).get("detail")
        except ValueError:
            detail = str(e)
        return detail if isinstance(detail, dict) else {"status": "error", "http": e.code, "reason": detail}
    except urllib.error.URLError as e:
        return {"status": "error", "reason": f"Can't reach {API}: {e.reason}"}


def _render(out: dict) -> str:
    st = out.get("status")
    if st == "ok":
        lines = [f"Charged ${out['charged_usd']:.2f} (refunded ${out['refunded_usd']:.2f}); wallet now ${out['balance_usd']:.2f}.",
                 f"{out['flagged']} of {len(out['results'])} reference(s) need attention."]
        for r in out["results"]:
            flag = "OK " if r["status"] == "verified" and r["retraction"] not in ("retracted", "expression_of_concern") else "!! "
            m = r.get("matched") or {}
            extra = f" -> {m.get('title')} ({m.get('year')}) doi:{m.get('doi')}" if m else ""
            ret = f" [RETRACTION: {r['retraction']}]" if r["retraction"] in ("retracted", "expression_of_concern", "corrected") else ""
            lines.append(f"{flag}[{r['index']}] {r['status']}{ret}: {r['reference'][:140]}{extra}")
        return "\n".join(lines)
    return json.dumps(out, indent=2)


def call_tool(name: str, args: dict) -> tuple[str, bool]:
    if not KEY:
        return "CITESLAYY_AGENT_KEY is not set. Create a key in Cite & Slayy: /app?tab=agentpay", True
    if name == "verify_references":
        body = {"references": args.get("references") or [], "request_id": args.get("request_id")}
        out = _http("POST", "/api/agent/v1/verify", body)
    elif name == "quote_verification":
        out = _http("GET", f"/api/agent/v1/quote?n={int(args.get('n') or 1)}")
    elif name == "check_approval":
        out = _http("GET", f"/api/agent/v1/requests/{args.get('request_id', '')}")
    else:
        return f"Unknown tool {name}", True
    return _render(out), out.get("status") == "error"


def handle(msg: dict) -> dict | None:
    mid, method = msg.get("id"), msg.get("method")
    if mid is None:
        return None                                   # notifications (initialized, cancelled) need no answer
    if method == "initialize":
        result = {"protocolVersion": (msg.get("params") or {}).get("protocolVersion", PROTOCOL),
                  "capabilities": {"tools": {}}, "serverInfo": {"name": "citeslayy-citeguard", "version": "1.0.0"}}
    elif method == "tools/list":
        result = {"tools": TOOLS}
    elif method == "tools/call":
        p = msg.get("params") or {}
        text, is_err = call_tool(p.get("name", ""), p.get("arguments") or {})
        result = {"content": [{"type": "text", "text": text}], "isError": is_err}
    elif method == "ping":
        result = {}
    else:
        return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": f"Method not found: {method}"}}
    return {"jsonrpc": "2.0", "id": mid, "result": result}


def main() -> None:
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            reply = handle(json.loads(line))
        except Exception as e:  # noqa: BLE001
            reply = {"jsonrpc": "2.0", "id": None, "error": {"code": -32603, "message": str(e)}}
        if reply:
            sys.stdout.write(json.dumps(reply) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()
