"""
AdminLog 审计字段迁移脚本。

新增字段：
1. operator_id
2. tenant_id
3. trace_id
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
class AuditColumn:
    name: str
    ddl: str
    index_name: str


AUDIT_COLUMNS: tuple[AuditColumn, ...] = (
    AuditColumn("operator_id", "INTEGER", "ix_admin_logs_operator_id"),
    AuditColumn("tenant_id", "VARCHAR(100)", "ix_admin_logs_tenant_id"),
    AuditColumn("trace_id", "VARCHAR(100)", "ix_admin_logs_trace_id"),
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


def _column_exists(column_name: str) -> bool:
    inspector = inspect(engine)
    columns = inspector.get_columns("admin_logs")
    return any(col.get("name") == column_name for col in columns)


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


def _print_plan(action: str) -> None:
    print("-" * 60)
    print(f"计划动作: {action}")
    if action == "migrate":
        for column in AUDIT_COLUMNS:
            print(f"- ensure column admin_logs.{column.name}")
            print(f"- ensure index {column.index_name}")
    else:
        for column in AUDIT_COLUMNS:
            print(f"- drop index {column.index_name}")
        for column in reversed(AUDIT_COLUMNS):
            print(f"- drop column admin_logs.{column.name}")
    print("-" * 60)


def _run(action: str) -> None:
    with engine.begin() as conn:
        if action == "migrate":
            for column in AUDIT_COLUMNS:
                if _column_exists(column.name):
                    print(f"✓ admin_logs.{column.name} already exists")
                else:
                    stmt = f"ALTER TABLE admin_logs ADD COLUMN {column.name} {column.ddl}"
                    conn.execute(text(stmt))
                    print(f"✓ 已执行: {stmt}")
            for column in AUDIT_COLUMNS:
                if _index_exists(conn, "admin_logs", column.index_name):
                    print(f"✓ {column.index_name} already exists")
                else:
                    conn.execute(text(f"CREATE INDEX IF NOT EXISTS {column.index_name} ON admin_logs ({column.name})"))
                    print(f"✓ 已创建索引: {column.index_name}")
            return

        if action == "rollback":
            for column in AUDIT_COLUMNS:
                if _index_exists(conn, "admin_logs", column.index_name):
                    conn.execute(text(f"DROP INDEX IF EXISTS {column.index_name}"))
                    print(f"✓ 已删除索引: {column.index_name}")
                else:
                    print(f"✓ {column.index_name} already absent")
            for column in reversed(AUDIT_COLUMNS):
                if _column_exists(column.name):
                    conn.execute(text(f"ALTER TABLE admin_logs DROP COLUMN {column.name}"))
                    print(f"✓ 已删除字段: admin_logs.{column.name}")
                else:
                    print(f"✓ admin_logs.{column.name} already absent")
            return

    raise RuntimeError(f"unsupported action: {action}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Migrate or rollback admin_logs audit columns")
    parser.add_argument("--action", choices=("migrate", "rollback"), default="migrate")
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    print("=" * 60)
    print("GraphInsight admin_logs audit fields migration")
    print("=" * 60)
    print(f"数据库: {_safe_db_url(os.getenv('ADMIN_DATABASE_URL', '未配置'))}")
    print(f"方言: {_dialect_name()}")
    _print_plan(args.action)
    if args.dry_run:
        print("✓ dry-run completed, database not modified")
        return 0
    _run(args.action)
    print(f"✓ admin_logs audit fields {args.action} completed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
