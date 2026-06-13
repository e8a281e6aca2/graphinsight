#!/usr/bin/env python3
"""
添加或回滚 admin_configs 的 is_encrypted / version 字段。
"""
from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass
from pathlib import Path

from dotenv import find_dotenv, load_dotenv
from sqlalchemy import inspect, text


backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

from admin.database import engine

load_dotenv(find_dotenv(), override=True)


@dataclass(frozen=True)
class ConfigColumn:
    name: str
    ddl: str


COLUMNS: tuple[ConfigColumn, ...] = (
    ConfigColumn("is_encrypted", "BOOLEAN DEFAULT FALSE"),
    ConfigColumn("version", "INTEGER DEFAULT 1"),
)


def _safe_db_url(raw: str) -> str:
    if "@" not in raw:
        return raw
    left, right = raw.split("@", 1)
    if "://" in left and ":" in left.split("://", 1)[1]:
        prefix, account = left.split("://", 1)
        username = account.split(":", 1)[0]
        return f"{prefix}://{username}:****@{right}"
    return raw


def _column_exists(name: str) -> bool:
    inspector = inspect(engine)
    columns = inspector.get_columns("admin_configs")
    return any(col.get("name") == name for col in columns)


def _print_plan(action: str) -> None:
    print("-" * 60)
    print(f"计划动作: {action}")
    if action == "migrate":
        for column in COLUMNS:
            print(f"- ensure column admin_configs.{column.name}")
    else:
        for column in reversed(COLUMNS):
            print(f"- drop column admin_configs.{column.name}")
    print("-" * 60)


def _run(action: str) -> None:
    with engine.begin() as conn:
        if action == "migrate":
            for column in COLUMNS:
                if _column_exists(column.name):
                    print(f"✓ admin_configs.{column.name} already exists")
                else:
                    conn.execute(text(f"ALTER TABLE admin_configs ADD COLUMN {column.name} {column.ddl}"))
                    print(f"✓ added column admin_configs.{column.name}")
            return

        if action == "rollback":
            for column in reversed(COLUMNS):
                if _column_exists(column.name):
                    conn.execute(text(f"ALTER TABLE admin_configs DROP COLUMN {column.name}"))
                    print(f"✓ dropped column admin_configs.{column.name}")
                else:
                    print(f"✓ admin_configs.{column.name} already absent")
            return

    raise RuntimeError(f"unsupported action: {action}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Migrate or rollback admin_configs encryption/version fields")
    parser.add_argument("--action", choices=("migrate", "rollback"), default="migrate")
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    print("=" * 60)
    print("GraphInsight admin_configs encryption/version migration")
    print("=" * 60)
    print(f"数据库: {_safe_db_url(os.getenv('ADMIN_DATABASE_URL', '未配置'))}")
    print(f"方言: {engine.dialect.name}")
    _print_plan(args.action)
    if args.dry_run:
        print("✓ dry-run completed, database not modified")
        return 0
    _run(args.action)
    print(f"✓ admin_configs encryption/version {args.action} completed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
