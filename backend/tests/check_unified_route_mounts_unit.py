#!/usr/bin/env python3
"""Verify unified mode unmounts Python public compatibility routes."""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1]


def _assert(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def _inspect_routes() -> list[str]:
    env = os.environ.copy()
    env["RBAC_AUTHZ_MODE"] = "go_db"
    script = (
        "import sys; "
        f"sys.path.insert(0, {str(BACKEND_ROOT)!r}); "
        "from main import app; "
        "paths = sorted({route.path for route in app.routes}); "
        "print('\\n'.join(paths))"
    )
    result = subprocess.run(
        [sys.executable, "-c", script],
        cwd=str(BACKEND_ROOT),
        env=env,
        capture_output=True,
        text=True,
        check=True,
    )
    return [line.strip() for line in result.stdout.splitlines() if line.strip().startswith("/")]


def main() -> int:
    paths = _inspect_routes()
    path_set = set(paths)

    for public_path in (
        "/api/query",
        "/api/expand",
        "/api/graph/schema",
        "/api/node/{node_id}",
        "/api/client-logs",
        "/api/docqa",
        "/api/docqa/deep-research",
        "/api/docqa/health",
        "/api/documents",
        "/api/documents/deleted",
        "/api/documents/upload",
        "/api/documents/{doc_id}",
        "/api/documents/{doc_id}/restore",
        "/api/graph/build",
        "/api/nl2cypher",
        "/api/nl2cypher/examples",
        "/api/nl2cypher/status",
        "/api/proxy-media",
        "/api/proxy-image",
        "/api/video-thumbnail",
        "/api/media",
        "/api/media/{path:path}",
        "/api/v1/admin/config",
        "/api/v1/admin/config/{category}",
        "/api/v1/admin/config/{category}/{key}",
        "/api/v1/admin/monitor/stats",
        "/api/v1/admin/monitor/health",
        "/api/v1/admin/monitor/performance",
        "/api/v1/admin/monitor/qa",
        "/api/v1/admin/logs",
        "/api/v1/admin/logs/{log_id}",
        "/api/v1/admin/profile",
        "/api/v1/admin/profile/password",
        "/api/v1/admin/qa-traces",
        "/api/v1/admin/qa-traces/{trace_id_or_pk}",
        "/api/v1/admin/rbac/roles",
        "/api/v1/admin/rbac/permissions",
        "/api/v1/admin/rbac/bindings",
        "/api/v1/admin/rbac/bindings/{binding_id}",
        "/api/v1/admin/users",
        "/api/v1/admin/users/{user_id}",
        "/api/v1/admin/users/export-csv",
        "/api/v1/admin/auth/login",
        "/api/v1/admin/auth/logout",
        "/api/v1/admin/auth/me",
        "/api/v1/admin/auth/profile",
        "/api/v1/admin/auth/register",
        "/api/v1/admin/auth/change-password",
        "/api/v1/admin/jobs",
        "/api/v1/admin/jobs/build-graph",
        "/api/v1/admin/jobs/clear-kb",
        "/api/v1/admin/jobs/reindex",
        "/api/v1/admin/jobs/{job_id}",
        "/api/v1/admin/jobs/{job_id}/logs",
        "/api/v1/admin/jobs/{job_id}:retry",
        "/api/v1/admin/jobs/{job_id}:cancel",
    ):
        _assert(public_path not in path_set, f"expected removed public route to stay absent: {public_path}")

    for mounted_path in (
        "/api/internal/docqa",
        "/api/internal/docqa/deep-research",
        "/api/internal/docqa/health",
        "/api/internal/jobs/wake",
        "/api/internal/nl2cypher",
    ):
        _assert(mounted_path in path_set, f"expected internal/compat route to remain mounted: {mounted_path}")

    _assert(
        "/api/v1/admin/auth/authorize" not in path_set,
        "expected Python authorize compat route to stay removed",
    )
    _assert(
        "/api/v1/admin/jobs/internal/wake" not in path_set,
        "expected legacy admin wake compat route to stay unmounted",
    )

    print("UNIFIED_ROUTE_MOUNTS_UNIT_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
