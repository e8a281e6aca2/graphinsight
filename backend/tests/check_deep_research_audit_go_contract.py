#!/usr/bin/env python3
"""Verify deep research POST writes Go-side admin audit logs."""

from __future__ import annotations

import argparse
import json
import os
import urllib.error
import urllib.parse
import urllib.request
import uuid


def _request(
    method: str,
    url: str,
    *,
    token: str,
    payload: dict | None = None,
    trace_id: str | None = None,
) -> tuple[int, dict | str, dict[str, str]]:
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if trace_id:
        headers["X-Trace-Id"] = trace_id
    data = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, method=method, headers=headers, data=data)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            try:
                body: dict | str = json.loads(raw)
            except Exception:
                body = raw
            return resp.status, body, {k.lower(): v for k, v in resp.headers.items()}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            body = json.loads(raw)
        except Exception:
            body = raw
        return exc.code, body, {k.lower(): v for k, v in exc.headers.items()}


def _assert(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> int:
    parser = argparse.ArgumentParser(description="Check deep research Go audit contract")
    parser.add_argument("--base-url", default=os.getenv("ADMIN_BASE_URL", "http://127.0.0.1:8081"))
    parser.add_argument("--admin-token", default=os.getenv("ADMIN_TOKEN", ""))
    args = parser.parse_args()

    token = args.admin_token.strip()
    _assert(bool(token), "ADMIN_TOKEN is required for deep research audit contract check")
    base_url = args.base_url.rstrip("/")
    trace_id = f"deep-research-audit-{uuid.uuid4().hex}"

    status, body, _ = _request(
        "POST",
        f"{base_url}/api/docqa/deep-research",
        token=token,
        trace_id=trace_id,
        payload={"question": "   "},
    )
    _assert(status == 400, f"expected 400 for blank question, got status={status} body={body}")

    query = urllib.parse.urlencode({"trace_id": trace_id, "page": 1, "page_size": 10})
    status, body, _ = _request("GET", f"{base_url}/api/v1/admin/logs?{query}", token=token)
    _assert(status == 200, f"expected 200 when querying admin logs, got status={status} body={body}")
    _assert(isinstance(body, dict), f"expected dict logs body, got {type(body)}")
    data = body.get("data")
    _assert(isinstance(data, dict), f"expected logs data object, got body={body}")
    items = data.get("items")
    _assert(isinstance(items, list) and items, f"expected at least one audit log item, got body={body}")

    found = None
    for item in items:
        if not isinstance(item, dict):
            continue
        if item.get("action") == "docqa_deep_research" and item.get("trace_id") == trace_id:
            found = item
            break
    _assert(found is not None, f"expected docqa_deep_research audit log for trace_id={trace_id}, got items={items}")
    _assert(found.get("status") == "failed", f"expected failed audit status, got item={found}")
    _assert(found.get("resource") == "ai_query", f"expected resource=ai_query, got item={found}")

    print("DEEP_RESEARCH_AUDIT_GO_CONTRACT_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
