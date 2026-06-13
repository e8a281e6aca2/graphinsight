#!/usr/bin/env python3
"""Smoke check for unified backend mode against running services."""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

from runtime_env import resolve_base_url


def _request(url: str, *, headers: dict[str, str] | None = None) -> tuple[int, dict | str]:
    req = urllib.request.Request(url, headers=headers or {}, method="GET")
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
    go_base_url = resolve_base_url("GO_BASE_URL", resolve_base_url("ADMIN_BASE_URL", "http://127.0.0.1:8081"))

    for path in (
        "/api/docqa/health?probe_llm=false",
        "/api/documents",
        "/api/nl2cypher/status",
        "/api/graph/build",
        "/api/graph/schema",
        "/api/node/unified-smoke",
    ):
        status, body = _request(f"{python_base_url}{path}")
        _assert(status == 404, f"expected 404 for removed public Python route, got path={path}, status={status}, body={body}")

    status, body = _request(f"{python_base_url}/api/media/nonexistent.png")
    _assert(status == 404, f"expected Python static media route to be unmounted in unified mode, got status={status}, body={body}")

    for path, payload in (
        ("/api/query", {"cypher": "RETURN 1", "parameters": {}}),
        ("/api/expand", {"nodeId": "unified-smoke", "direction": "out", "relationshipTypes": [], "limit": 1}),
    ):
        req = urllib.request.Request(
            f"{python_base_url}{path}",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                post_body = json.loads(resp.read().decode("utf-8", errors="replace"))
                post_status = resp.status
        except urllib.error.HTTPError as exc:
            post_status = exc.code
            post_body = json.loads(exc.read().decode("utf-8", errors="replace"))
        _assert(post_status == 404, f"expected 404 for removed public Python route, got path={path}, status={post_status}, body={post_body}")

    for admin_auth_path in (
        "/api/v1/admin/auth/me",
        "/api/v1/admin/auth/profile",
    ):
        status, body = _request(f"{python_base_url}{admin_auth_path}")
        _assert(
            status == 404,
            f"expected 404 for disabled public Python admin route, got path={admin_auth_path}, status={status}, body={body}",
        )

    for retired_internal_path in (
        "/api/internal/documents",
        "/api/internal/documents/deleted",
        "/api/internal/documents/upload",
        "/api/internal/graph/build",
        "/api/internal/nl2cypher/examples",
        "/api/internal/nl2cypher/status",
    ):
        status, body = _request(f"{python_base_url}{retired_internal_path}")
        _assert(
            status == 404,
            f"expected retired internal route to stay unmounted: path={retired_internal_path} status={status} body={body}",
        )

    status, body = _request(f"{python_base_url}/api/internal/docqa/health?probe_llm=false")
    _assert(status == 403, f"expected 403 for internal route without Go header, got status={status}, body={body}")

    status, body = _request(
        f"{python_base_url}/api/internal/docqa/health?probe_llm=false",
        headers={"X-Go-Orchestrator": "graphinsight-go"},
    )
    _assert(status == 400, f"expected 400 for internal route without trace header, got status={status}, body={body}")

    status, body = _request(
        f"{python_base_url}/api/internal/docqa/health?probe_llm=false",
        headers={"X-Go-Proxy": "graphinsight-go", "X-Trace-Id": "proxy-only-smoke"},
    )
    _assert(status == 403, f"expected 403 for proxy-only business capability access, got status={status}, body={body}")

    wake_req = urllib.request.Request(f"{python_base_url}/api/internal/jobs/wake", method="POST")
    try:
        with urllib.request.urlopen(wake_req, timeout=15) as resp:
            wake_body = json.loads(resp.read().decode("utf-8", errors="replace"))
            wake_status = resp.status
    except urllib.error.HTTPError as exc:
        wake_status = exc.code
        wake_body = json.loads(exc.read().decode("utf-8", errors="replace"))
    _assert(wake_status == 403, f"expected wake route forbid status=403, got status={wake_status}, body={wake_body}")
    _assert(wake_body.get("code") == 403, f"expected wake route forbid envelope without Go proxy header, got body={wake_body}")

    wake_req = urllib.request.Request(
        f"{python_base_url}/api/internal/jobs/wake",
        headers={"X-Go-Proxy": "graphinsight-go"},
        method="POST",
    )
    with urllib.request.urlopen(wake_req, timeout=15) as resp:
        wake_body = json.loads(resp.read().decode("utf-8", errors="replace"))
        _assert(resp.status == 200, f"expected wake route accepted status=200, got status={resp.status}, body={wake_body}")
        _assert(wake_body.get("code") == 200, f"expected wake route success envelope with Go proxy header, got body={wake_body}")

    status, body = _request(
        f"{python_base_url}/api/v1/admin/jobs/internal/wake",
        headers={"X-Go-Proxy": "graphinsight-go"},
    )
    _assert(status == 404, f"expected legacy admin wake path to be unmounted, got status={status}, body={body}")

    status, body = _request(f"{python_base_url}/api/v1/admin/auth/authorize?permission=user:manage")
    _assert(status == 404, f"expected Python authorize compat route to stay removed, got status={status}, body={body}")

    status, body = _request(
        f"{python_base_url}/api/v1/admin/auth/authorize?permission=user:manage",
        headers={"X-Go-Authz": "graphinsight-go"},
    )
    _assert(status == 404, f"expected removed Python authorize compat route to stay absent even with Go authz header, got status={status}, body={body}")

    status, body = _request(
        f"{python_base_url}/api/internal/docqa/health?probe_llm=false",
        headers={"X-Go-Orchestrator": "graphinsight-go", "X-Trace-Id": "smoke-unified-mode"},
    )
    _assert(status == 200, f"expected 200 for internal route with Go header, got status={status}, body={body}")
    _assert(isinstance(body, dict), f"expected dict body, got {type(body)}")
    _assert(body.get("trace_id") == "smoke-unified-mode", f"unexpected trace_id body={body}")

    status, body = _request(f"{go_base_url}/health")
    _assert(status == 200, f"expected 200 for Go health route, got status={status}, body={body}")
    _assert(isinstance(body, dict), f"expected dict Go health body, got {type(body)}")
    data = body.get("data")
    _assert(isinstance(data, dict), f"expected Go health data object, got {data}")
    authz = data.get("authz")
    _assert(isinstance(authz, dict), f"expected Go authz health object, got {authz}")
    _assert(authz.get("mode") == "go_db", f"expected unified mode authz=go_db, got authz={authz}")
    _assert(authz.get("permission_check_via_upstream") is False, f"expected no upstream Python authz in unified mode, got authz={authz}")
    neo4j = data.get("neo4j")
    _assert(isinstance(neo4j, dict), f"expected Go neo4j health object, got {neo4j}")
    _assert(neo4j.get("config_source") != "admin_config", f"expected no Python admin config source in unified mode, got neo4j={neo4j}")

    print("UNIFIED_BACKEND_MODE_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
