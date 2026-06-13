"""
数据库迁移脚本：添加或回滚 preferred_home_path 字段。
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from dotenv import find_dotenv, load_dotenv
from sqlalchemy import inspect, text


backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

from admin.database import engine

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


def _column_exists() -> bool:
    inspector = inspect(engine)
    columns = inspector.get_columns("admin_users")
    return any(col.get("name") == "preferred_home_path" for col in columns)


def _print_plan(action: str) -> None:
    print("-" * 60)
    print(f"计划动作: {action}")
    if action == "migrate":
        print("- ensure column admin_users.preferred_home_path")
        print("- normalize NULL/empty preferred_home_path to /admin/dashboard")
    else:
        print("- drop column admin_users.preferred_home_path")
    print("-" * 60)


def _run(action: str) -> None:
    with engine.begin() as conn:
        if action == "migrate":
            if _column_exists():
                print("✓ admin_users.preferred_home_path already exists")
            else:
                conn.execute(text("ALTER TABLE admin_users ADD COLUMN preferred_home_path VARCHAR(64) DEFAULT '/admin/dashboard'"))
                print("✓ added column admin_users.preferred_home_path")
            conn.execute(
                text(
                    """
                    UPDATE admin_users
                    SET preferred_home_path = '/admin/dashboard'
                    WHERE preferred_home_path IS NULL
                       OR TRIM(preferred_home_path) = ''
                    """
                )
            )
            print("✓ normalized admin_users.preferred_home_path")
            return

        if action == "rollback":
            if not _column_exists():
                print("✓ admin_users.preferred_home_path already absent")
                return
            conn.execute(text("ALTER TABLE admin_users DROP COLUMN preferred_home_path"))
            print("✓ dropped column admin_users.preferred_home_path")
            return

    raise RuntimeError(f"unsupported action: {action}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Migrate or rollback admin_users.preferred_home_path")
    parser.add_argument("--action", choices=("migrate", "rollback"), default="migrate")
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    print("=" * 60)
    print("GraphInsight admin_users preferred_home_path migration")
    print("=" * 60)
    print(f"数据库: {_safe_db_url(os.getenv('ADMIN_DATABASE_URL', '未配置'))}")
    print(f"方言: {engine.dialect.name}")
    _print_plan(args.action)
    if args.dry_run:
        print("✓ dry-run completed, database not modified")
        return 0
    _run(args.action)
    print(f"✓ admin_users preferred_home_path {args.action} completed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
