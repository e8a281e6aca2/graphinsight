"""
创建后台任务表（admin_jobs）
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from dotenv import find_dotenv, load_dotenv

backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

from admin.database import Base, engine
from admin.models import AdminJob  # noqa: F401 - ensure model registration

load_dotenv(find_dotenv(), override=True)


def _safe_db_url(raw: str) -> str:
    if "@" not in raw:
        return raw
    left, right = raw.split("@", 1)
    if "://" in left and ":" in left.split("://", 1)[1]:
        prefix, account = left.split("://", 1)
        username = account.split(":", 1)[0]
        return f"{prefix}://{username}:****@{right}"
    return raw


def _print_plan(action: str) -> None:
    print("-" * 60)
    print(f"计划动作: {action}")
    if action == "migrate":
        print("- ensure table admin_jobs")
    else:
        print("- drop table admin_jobs")
    print("-" * 60)


def _run(action: str) -> None:
    if action == "migrate":
        Base.metadata.create_all(bind=engine, tables=[AdminJob.__table__])
        print("✓ admin_jobs table is ready")
        return
    if action == "rollback":
        AdminJob.__table__.drop(bind=engine, checkfirst=True)
        print("✓ admin_jobs table rollback completed")
        return
    raise RuntimeError(f"unsupported action: {action}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Migrate or rollback admin_jobs table")
    parser.add_argument("--action", choices=("migrate", "rollback"), default="migrate")
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    print("=" * 60)
    print("GraphInsight admin_jobs table migration")
    print("=" * 60)
    print(f"数据库: {_safe_db_url(os.getenv('ADMIN_DATABASE_URL', '未配置'))}")
    print(f"方言: {engine.dialect.name}")
    _print_plan(args.action)
    if args.dry_run:
        print("✓ dry-run completed, database not modified")
        return 0
    _run(args.action)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
