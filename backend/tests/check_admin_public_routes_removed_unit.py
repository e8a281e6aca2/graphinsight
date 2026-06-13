#!/usr/bin/env python3
"""Verify Python admin public compatibility routes stay removed even if legacy env toggles are set."""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1]


def _assert(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def _inspect_routes() -> set[str]:
    env = os.environ.copy()
    env["PUBLIC_ADMIN_ROUTES_ENABLED"] = "true"
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
    return {line.strip() for line in result.stdout.splitlines() if line.strip().startswith("/")}


def main() -> int:
    paths = _inspect_routes()

    for removed_path in (
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
        _assert(removed_path not in paths, f"expected removed Python admin public route to stay absent: {removed_path}")

    _assert("/api/internal/jobs/wake" in paths, "expected internal jobs wake route to remain mounted")
    _assert("/api/v1/admin/auth/authorize" not in paths, "expected authorize compat route to stay unmounted in go_db mode")
    print("ADMIN_PUBLIC_ROUTES_REMOVED_UNIT_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
