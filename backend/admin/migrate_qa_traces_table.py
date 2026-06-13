"""
创建问答链路追踪表（admin_qa_traces）
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from dotenv import find_dotenv, load_dotenv

backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

from admin.database import engine  # noqa: E402
from admin.models import AdminQATrace  # noqa: F401,E402 - ensure model registration

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
        print("- ensure table admin_qa_traces")
    else:
        print("- drop table admin_qa_traces")
    print("-" * 60)


def _run(action: str) -> None:
    if action == "migrate":
        AdminQATrace.__table__.create(bind=engine, checkfirst=True)
        print("✓ admin_qa_traces table is ready")
        return
    if action == "rollback":
        AdminQATrace.__table__.drop(bind=engine, checkfirst=True)
        print("✓ admin_qa_traces table rollback completed")
        return
    raise RuntimeError(f"unsupported action: {action}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Migrate or rollback admin_qa_traces table")
    parser.add_argument("--action", choices=("migrate", "rollback"), default="migrate")
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    print("=" * 60)
    print("GraphInsight admin_qa_traces table migration")
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
