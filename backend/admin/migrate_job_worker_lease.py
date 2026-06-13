"""
为 admin_jobs 增加或回滚 Python worker lease 字段。

新增字段：
1. claimed_by
2. claim_expires_at
3. last_heartbeat_at
"""
from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass
from pathlib import Path

from dotenv import find_dotenv, load_dotenv
from sqlalchemy import text


backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

from admin.database import engine

load_dotenv(find_dotenv(), override=True)


@dataclass(frozen=True)
class LeaseColumn:
    name: str
    ddl: str
    index_name: str


LEASE_COLUMNS: tuple[LeaseColumn, ...] = (
    LeaseColumn("claimed_by", "claimed_by VARCHAR(100)", "idx_admin_jobs_claimed_by"),
    LeaseColumn(
        "claim_expires_at",
        "claim_expires_at TIMESTAMP WITH TIME ZONE",
        "idx_admin_jobs_claim_expires_at",
    ),
    LeaseColumn(
        "last_heartbeat_at",
        "last_heartbeat_at TIMESTAMP WITH TIME ZONE",
        "idx_admin_jobs_last_heartbeat_at",
    ),
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


def _dialect_name() -> str:
    dialect = engine.dialect.name
    if dialect not in {"postgresql", "sqlite"}:
        raise RuntimeError(f"unsupported dialect: {dialect}")
    return dialect


def _column_exists(conn, table: str, column: str) -> bool:
    dialect = _dialect_name()
    if dialect == "postgresql":
        result = conn.execute(
            text(
                """
                SELECT 1
                FROM information_schema.columns
                WHERE table_name = :table_name AND column_name = :column_name
                LIMIT 1
                """
            ),
            {"table_name": table, "column_name": column},
        ).scalar()
        return bool(result)

    rows = conn.execute(text(f"PRAGMA table_info({table})")).fetchall()
    return any(str(row[1]) == column for row in rows)


def _index_exists(conn, table: str, index_name: str) -> bool:
    dialect = _dialect_name()
    if dialect == "postgresql":
        result = conn.execute(
            text(
                """
                SELECT 1
                FROM pg_indexes
                WHERE schemaname = CURRENT_SCHEMA()
                  AND tablename = :table_name
                  AND indexname = :index_name
                LIMIT 1
                """
            ),
            {"table_name": table, "index_name": index_name},
        ).scalar()
        return bool(result)

    rows = conn.execute(text(f"PRAGMA index_list({table})")).fetchall()
    return any(str(row[1]) == index_name for row in rows)


def _ensure_column(conn, table: str, column: LeaseColumn) -> bool:
    if _column_exists(conn, table, column.name):
        print(f"✓ {table}.{column.name} already exists")
        return False
    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column.ddl}"))
    print(f"✓ added column {table}.{column.name}")
    return True


def _drop_column(conn, table: str, column: LeaseColumn) -> bool:
    if not _column_exists(conn, table, column.name):
        print(f"✓ {table}.{column.name} already absent")
        return False
    conn.execute(text(f"ALTER TABLE {table} DROP COLUMN {column.name}"))
    print(f"✓ dropped column {table}.{column.name}")
    return True


def _ensure_index(conn, table: str, column: LeaseColumn) -> bool:
    if _index_exists(conn, table, column.index_name):
        print(f"✓ ensured index {column.index_name}")
        return False
    conn.execute(text(f"CREATE INDEX IF NOT EXISTS {column.index_name} ON {table} ({column.name})"))
    print(f"✓ ensured index {column.index_name}")
    return True


def _drop_index(conn, table: str, column: LeaseColumn) -> bool:
    if not _index_exists(conn, table, column.index_name):
        print(f"✓ {column.index_name} already absent")
        return False
    conn.execute(text(f"DROP INDEX IF EXISTS {column.index_name}"))
    print(f"✓ dropped index {column.index_name}")
    return True


def _build_plan(action: str) -> list[str]:
    table = "admin_jobs"
    plan: list[str] = []
    if action == "migrate":
        for column in LEASE_COLUMNS:
            plan.append(f"ensure column {table}.{column.name}")
            plan.append(f"ensure index {column.index_name}")
        return plan
    if action == "rollback":
        for column in LEASE_COLUMNS:
            plan.append(f"drop index {column.index_name}")
        for column in reversed(LEASE_COLUMNS):
            plan.append(f"drop column {table}.{column.name}")
        return plan
    raise RuntimeError(f"unsupported action: {action}")


def _print_plan(action: str) -> None:
    print("-" * 60)
    print(f"计划动作: {action}")
    for step in _build_plan(action):
        print(f"- {step}")
    print("-" * 60)


def _run(action: str) -> None:
    table = "admin_jobs"
    with engine.begin() as conn:
        if action == "migrate":
            for column in LEASE_COLUMNS:
                _ensure_column(conn, table, column)
            for column in LEASE_COLUMNS:
                _ensure_index(conn, table, column)
            return

        if action == "rollback":
            for column in LEASE_COLUMNS:
                _drop_index(conn, table, column)
            for column in reversed(LEASE_COLUMNS):
                _drop_column(conn, table, column)
            return

    raise RuntimeError(f"unsupported action: {action}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Migrate or rollback admin_jobs worker lease columns")
    parser.add_argument(
        "--action",
        choices=("migrate", "rollback"),
        default="migrate",
        help="apply forward migration or rollback",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="show the migration plan without modifying the database",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    db_url = os.getenv("ADMIN_DATABASE_URL", "未配置")
    print("=" * 60)
    print("GraphInsight admin_jobs worker lease migration")
    print("=" * 60)
    print(f"数据库: {_safe_db_url(db_url)}")
    print(f"方言: {_dialect_name()}")
    _print_plan(args.action)

    if args.dry_run:
        print("✓ dry-run completed, database not modified")
        return 0

    _run(args.action)
    print(f"✓ admin_jobs worker lease {args.action} completed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
