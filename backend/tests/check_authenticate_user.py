"""
Check authenticate_user() directly against current ADMIN_DATABASE_URL.

Usage:
    python backend/tests/check_authenticate_user.py --email yh@qs.al --password Admin@123456
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--email", required=True)
    parser.add_argument("--password", required=True)
    args = parser.parse_args()

    backend_dir = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(backend_dir))

    from admin.database import SessionLocal  # noqa: WPS433
    from admin.services.auth_service import auth_service  # noqa: WPS433

    db = SessionLocal()
    try:
        user = auth_service.authenticate_user(db, args.email, args.password)
        if user is None:
            print("AUTH=False")
            return 1
        print(f"AUTH=True id={user.id} username={user.username} email={user.email} active={user.is_active}")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
