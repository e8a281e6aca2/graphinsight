#!/usr/bin/env python3
"""Verify Python business public routes stay removed even if the legacy env toggle is set."""
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
    env["PUBLIC_BUSINESS_ROUTES_ENABLED"] = "true"
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
    ):
        _assert(removed_path not in paths, f"expected removed Python business public route to stay absent: {removed_path}")

    for mounted_path in (
        "/api/internal/docqa",
        "/api/internal/docqa/deep-research",
        "/api/internal/docqa/health",
        "/api/internal/nl2cypher",
    ):
        _assert(mounted_path in paths, f"expected internal business capability route to remain mounted: {mounted_path}")

    print("BUSINESS_PUBLIC_ROUTES_REMOVED_UNIT_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
