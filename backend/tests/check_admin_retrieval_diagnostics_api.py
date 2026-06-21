#!/usr/bin/env python3
"""Smoke check for the Go admin retrieval diagnostics endpoint."""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request


def _base_url() -> str:
    runtime_env = os.path.join(os.getcwd(), "logs", "dev", "runtime.env")
    if os.path.exists(runtime_env):
        with open(runtime_env, "r", encoding="utf-8") as file:
            for line in file:
                if line.startswith("ADMIN_BASE_URL="):
                    value = line.split("=", 1)[1].strip()
                    if value:
                        return value.rstrip("/")
    return os.environ.get("ADMIN_BASE_URL", "http://127.0.0.1:8081").rstrip("/")


def main() -> int:
    token = os.environ.get("ADMIN_TOKEN", "").strip()
    if not token:
        print("SKIP_ADMIN_RETRIEVAL_DIAGNOSTICS_API: ADMIN_TOKEN is required")
        return 0

    payload = {
        "question": os.environ.get("DIAG_QUESTION", "水稻病害怎么防治"),
        "top_k": 3,
        "modes": ["keyword", "vector", "hybrid", "graph_hybrid"],
    }
    request = urllib.request.Request(
        f"{_base_url()}/api/v1/admin/qa/retrieval-diagnostics",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            body = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise AssertionError(f"unexpected HTTP {exc.code}: {detail}") from exc

    if body.get("code") != 200:
        raise AssertionError(f"unexpected response code: {body}")
    data = body.get("data") or {}
    if not isinstance(data.get("runs"), dict) or not data.get("runs"):
        raise AssertionError(f"missing diagnostics runs: {body}")
    summary = data.get("summary") or {}
    if not isinstance(summary.get("modes"), dict):
        raise AssertionError(f"missing diagnostics summary: {body}")
    print("ADMIN_RETRIEVAL_DIAGNOSTICS_API_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
