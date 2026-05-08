"""
Reset admin password helper.

Usage:
    python backend/tests/reset_admin_password.py --password "Admin@123456"
    python backend/tests/reset_admin_password.py --email "admin@example.com" --password "Admin@123456"
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description="Reset admin user password")
    parser.add_argument("--password", required=True, help="new password")
    parser.add_argument("--email", default="", help="target email (optional)")
    parser.add_argument("--username", default="", help="target username (optional)")
    args = parser.parse_args()

    backend_dir = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(backend_dir))

    from admin.database import SessionLocal  # noqa: WPS433
    from admin.models import AdminUser  # noqa: WPS433
    import bcrypt  # noqa: WPS433
    from admin.auth import get_password_hash  # noqa: WPS433

    db = SessionLocal()
    try:
        users = db.query(AdminUser).order_by(AdminUser.id.asc()).all()
        print(f"USERS={len(users)}")
        if not users:
            print("NO_USER")
            return 2

        target = None
        if args.email:
            target = db.query(AdminUser).filter(AdminUser.email == args.email).first()
        if target is None and args.username:
            target = db.query(AdminUser).filter(AdminUser.username == args.username).first()

        if target is None:
            target = next((u for u in users if (u.email or "").lower() == "admin@example.com"), None)
        if target is None:
            target = next((u for u in users if (u.username or "").lower() == "admin"), None)
        if target is None:
            target = users[0]

        target.password_hash = get_password_hash(args.password)
        target.is_active = True
        db.commit()
        db.refresh(target)
        matched = bcrypt.checkpw(args.password.encode("utf-8"), target.password_hash.encode("utf-8"))
        print(
            f"RESET_OK id={target.id} username={target.username} "
            f"email={target.email} active={target.is_active} matched={matched}"
        )
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
