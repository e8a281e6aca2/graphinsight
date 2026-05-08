"""
创建后台任务表（admin_jobs）
"""
from __future__ import annotations

from admin.database import Base, engine
from admin.models import AdminJob  # noqa: F401 - ensure model registration


def main() -> int:
    Base.metadata.create_all(bind=engine, tables=[AdminJob.__table__])
    print("admin_jobs table is ready")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
