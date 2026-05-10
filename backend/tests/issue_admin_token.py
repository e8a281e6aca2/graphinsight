#!/usr/bin/env python3
"""Issue a local admin JWT for smoke/E2E scripts.

This script is intended for local diagnostics only. It reads the configured
admin database, finds an existing active admin user, and prints a JWT signed
with the local ADMIN_SECRET_KEY.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))


def issue_token(identifier: str) -> str:
    from admin.database import SessionLocal
    from admin.models import AdminUser
    from admin.services.auth_service import auth_service

    db = SessionLocal()
    try:
        query = db.query(AdminUser).filter(AdminUser.is_active.is_(True))
        if identifier:
            user = query.filter(
                (AdminUser.email == identifier) | (AdminUser.username == identifier)
            ).first()
        else:
            user = query.order_by(AdminUser.id.asc()).first()
        if user is None:
            raise RuntimeError("no active admin user found")
        return auth_service.create_access_token({"sub": user.email or user.username})
    finally:
        db.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Issue a local admin token for GraphInsight tests")
    parser.add_argument("--email", default="", help="Admin email or username. Defaults to first active admin user.")
    args = parser.parse_args()

    try:
        print(issue_token(args.email.strip()))
        return 0
    except Exception as exc:  # noqa: BLE001
        print(f"ISSUE_ADMIN_TOKEN_FAIL {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
