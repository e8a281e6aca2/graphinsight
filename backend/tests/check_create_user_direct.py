"""
Directly verify user creation through user_crud with current code.

Usage:
    python backend/tests/check_create_user_direct.py
"""
from __future__ import annotations

import random
import string
import sys
from pathlib import Path


def main() -> int:
    backend_dir = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(backend_dir))

    from admin.crud.user import user_crud  # noqa: WPS433
    from admin.database import SessionLocal  # noqa: WPS433

    suffix = "".join(random.choice(string.digits) for _ in range(6))
    username = f"direct_user_{suffix}"
    email = f"direct_user_{suffix}@example.com"

    db = SessionLocal()
    try:
        user = user_crud.create(
            db,
            username=username,
            email=email,
            password="Passw0rd123",
            is_active=True,
        )
        print(f"CREATE_OK id={user.id} username={user.username} email={user.email}")
        return 0
    except Exception as exc:  # noqa: BLE001
        print(f"CREATE_FAIL {exc}")
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
