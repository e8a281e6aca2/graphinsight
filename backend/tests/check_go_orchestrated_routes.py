#!/usr/bin/env python3
"""Run the Go orchestrated routes smoke script from the backend smoke suite."""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

from runtime_env import resolve_base_url


BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_ROOT.parent
GO_SMOKE_SCRIPT = REPO_ROOT / "go-backend" / "scripts" / "smoke_orchestrated_routes.py"
sys.path.insert(0, str(BACKEND_ROOT))


def _issue_local_token(email: str) -> str | None:
    from admin.database import SessionLocal
    from admin.models import AdminUser
    from admin.services.auth_service import auth_service

    db = SessionLocal()
    try:
        user = db.query(AdminUser).filter(AdminUser.email == email).first()
        if user is None:
            return None
        return auth_service.create_access_token({"sub": user.email or user.username})
    except Exception:  # noqa: BLE001
        return None
    finally:
        db.close()


def main() -> int:
    base_url = resolve_base_url("GO_BASE_URL", resolve_base_url("ADMIN_BASE_URL", "http://127.0.0.1:8081"))
    cmd = [
        sys.executable,
        str(GO_SMOKE_SCRIPT),
        "--go-base-url",
        base_url,
        "--require-orchestrator-connected",
    ]

    token = (os.getenv("ADMIN_TOKEN") or "").strip()
    admin_email = (os.getenv("ADMIN_EMAIL") or "yh@qs.al").strip()
    admin_password = (os.getenv("ADMIN_PASSWORD") or "").strip()
    if not token:
        token = _issue_local_token(admin_email) or ""
    if token:
        cmd.extend(["--token", token])
    elif admin_email and admin_password:
        cmd.extend(["--admin-email", admin_email, "--admin-password", admin_password])

    proc = subprocess.run(  # noqa: S603
        cmd,
        cwd=str(REPO_ROOT),
        env=os.environ.copy(),
        capture_output=True,
        text=True,
        check=False,
    )

    if proc.stdout:
        print(proc.stdout.strip())
    if proc.stderr:
        print("[stderr]")
        print(proc.stderr.strip())
    return proc.returncode


if __name__ == "__main__":
    raise SystemExit(main())
