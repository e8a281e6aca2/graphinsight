#!/usr/bin/env python3
"""Verify admin.database does not clobber the unified runtime env override."""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1]
DEV_ENV_FILE = BACKEND_ROOT.parent / "logs" / "dev" / "backend.env"


def _assert(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> int:
    _assert(DEV_ENV_FILE.exists(), f"expected unified runtime env file: {DEV_ENV_FILE}")
    env = os.environ.copy()
    env["GRAPHINSIGHT_BACKEND_ENV_FILE"] = str(DEV_ENV_FILE)
    script = (
        "import os, sys; "
        f"sys.path.insert(0, {str(BACKEND_ROOT)!r}); "
        "import config; "
        "before = os.getenv('NEO4J_URI'); "
        "import admin.database; "
        "after = os.getenv('NEO4J_URI'); "
        "print(before); "
        "print(after)"
    )
    result = subprocess.run(
        [sys.executable, "-c", script],
        cwd=str(BACKEND_ROOT),
        env=env,
        capture_output=True,
        text=True,
        check=True,
    )
    lines = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    _assert(len(lines) >= 2, f"unexpected output: {result.stdout!r}")
    before, after = lines[-2], lines[-1]
    _assert(before == "bolt://127.0.0.1:7687", f"unexpected pre-admin NEO4J_URI: {before}")
    _assert(after == before, f"admin.database should not clobber env override: before={before} after={after}")
    print("ADMIN_ENV_OVERRIDE_UNIT_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
