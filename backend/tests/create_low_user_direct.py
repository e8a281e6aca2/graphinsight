"""
Create or update a low-privilege user directly in admin DB.

Usage:
    python backend/tests/create_low_user_direct.py \
      --email rbac_viewer@example.com \
      --username rbac_viewer \
      --password Passw0rd123
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--email", required=True)
    parser.add_argument("--username", required=True)
    parser.add_argument("--password", required=True)
    args = parser.parse_args()

    backend_dir = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(backend_dir))

    from admin.auth import get_password_hash  # noqa: WPS433
    from admin.database import SessionLocal  # noqa: WPS433
    from admin.models import AdminUser  # noqa: WPS433

    db = SessionLocal()
    try:
        user = db.query(AdminUser).filter(AdminUser.email == args.email).first()
        if user is None:
            user = db.query(AdminUser).filter(AdminUser.username == args.username).first()

        if user is None:
            user = AdminUser(
                username=args.username,
                email=args.email,
                password_hash=get_password_hash(args.password),
                is_active=True,
                full_name="RBAC Viewer",
            )
            db.add(user)
            db.commit()
            db.refresh(user)
            print(f"CREATED id={user.id} username={user.username} email={user.email}")
            return 0

        user.username = args.username
        user.email = args.email
        user.password_hash = get_password_hash(args.password)
        user.is_active = True
        db.commit()
        db.refresh(user)
        print(f"UPDATED id={user.id} username={user.username} email={user.email}")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
