#!/usr/bin/env python3
"""Smoke check that Python no longer exposes public business/admin routes at runtime."""
from __future__ import annotations

import json
import urllib.error
import urllib.request

from runtime_env import resolve_base_url


def _request(url: str, *, method: str = "GET", body: dict | None = None) -> tuple[int, dict | str]:
    data = None
    headers: dict[str, str] = {}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            try:
                return resp.status, json.loads(raw)
            except Exception:
                return resp.status, raw
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            return exc.code, json.loads(raw)
        except Exception:
            return exc.code, raw


def _assert(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> int:
    python_base_url = resolve_base_url("PYTHON_BASE_URL", "http://127.0.0.1:8001")

    removed_get_paths = (
        "/api/docqa/health?probe_llm=false",
        "/api/documents",
        "/api/documents/deleted",
        "/api/nl2cypher/status",
        "/api/v1/admin/auth/me",
        "/api/v1/admin/auth/profile",
        "/api/v1/admin/jobs",
        "/api/media/nonexistent.png",
    )
    for path in removed_get_paths:
        status, body = _request(f"{python_base_url}{path}")
        _assert(status == 404, f"expected removed Python public route to return 404: path={path} status={status} body={body}")

    removed_write_paths = (
        ("/api/docqa", "POST", {"query": "ping"}),
        ("/api/nl2cypher", "POST", {"query": "MATCH (n) RETURN n LIMIT 1"}),
        ("/api/graph/build", "POST", {"rebuild": False}),
    )
    for path, method, body in removed_write_paths:
        status, response = _request(f"{python_base_url}{path}", method=method, body=body)
        _assert(
            status == 404,
            f"expected removed Python public route to return 404: path={path} method={method} status={status} body={response}",
        )

    status, body = _request(f"{python_base_url}/api/internal/docqa/health?probe_llm=false")
    _assert(status == 403, f"expected internal capability route to reject direct access: status={status} body={body}")

    print("PYTHON_PUBLIC_ROUTES_REMOVED_RUNTIME_SMOKE_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
