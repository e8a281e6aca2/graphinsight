#!/usr/bin/env python3
"""Unit-style checks for internal DocQA routes."""
from __future__ import annotations

import sys
from pathlib import Path

from fastapi.testclient import TestClient


BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

from main import app  # noqa: E402


def _assert(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> int:
    client = TestClient(app)

    denied = client.get("/api/internal/docqa/health?probe_llm=false")
    _assert(denied.status_code == 403, f"expected 403 without Go orchestrator header, got {denied.status_code}")

    missing_trace = client.get(
        "/api/internal/docqa/health?probe_llm=false",
        headers={"X-Go-Orchestrator": "graphinsight-go"},
    )
    _assert(missing_trace.status_code == 400, f"expected 400 without trace header, got {missing_trace.status_code}")

    proxy_only = client.get(
        "/api/internal/docqa/health?probe_llm=false",
        headers={"X-Go-Proxy": "graphinsight-go", "X-Trace-Id": "trace-proxy-only"},
    )
    _assert(proxy_only.status_code == 403, f"expected 403 for proxy-only access, got {proxy_only.status_code}")

    allowed = client.get(
        "/api/internal/docqa/health?probe_llm=false",
        headers={"X-Go-Orchestrator": "graphinsight-go", "X-Trace-Id": "trace-internal-docqa"},
    )
    _assert(allowed.status_code == 200, f"expected 200 with Go orchestrator header, got {allowed.status_code}")
    body = allowed.json()
    _assert(isinstance(body, dict), f"expected dict body, got {type(body)}")
    _assert(body.get("trace_id") == "trace-internal-docqa", f"expected forwarded trace_id, got {body.get('trace_id')}")
    data = body.get("data") or {}
    _assert(isinstance(data, dict), f"expected dict data, got {type(data)}")
    _assert("status" in data, f"expected status in data, got {data}")
    print("DOCQA_INTERNAL_ROUTE_UNIT_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
