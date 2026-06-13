#!/usr/bin/env python3
"""Verify admin_logs audit field migration supports migrate, dry-run, and rollback."""
from __future__ import annotations

import os
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "backend" / "admin" / "migrate_admin_log_audit_fields.py"


def _assert(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def _columns(db_path: Path) -> set[str]:
    with sqlite3.connect(db_path) as conn:
        rows = conn.execute("PRAGMA table_info(admin_logs)").fetchall()
    return {str(row[1]) for row in rows}


def _indexes(db_path: Path) -> set[str]:
    with sqlite3.connect(db_path) as conn:
        rows = conn.execute("PRAGMA index_list(admin_logs)").fetchall()
    return {str(row[1]) for row in rows}


def _run(db_url: str, env_file: Path, *args: str) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["ADMIN_DATABASE_URL"] = db_url
    env["GRAPHINSIGHT_BACKEND_ENV_FILE"] = str(env_file)
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        cwd=str(REPO_ROOT),
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="graphinsight-migrate-logs-") as tmpdir:
        db_path = Path(tmpdir) / "admin.sqlite3"
        env_file = Path(tmpdir) / "backend.env"
        db_url = f"sqlite:///{db_path}"
        env_file.write_text(f'ADMIN_DATABASE_URL="{db_url}"\n', encoding="utf-8")

        with sqlite3.connect(db_path) as conn:
            conn.execute(
                """
                CREATE TABLE admin_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    action TEXT,
                    resource TEXT,
                    created_at TEXT
                )
                """
            )
            conn.commit()

        baseline = _columns(db_path)
        _run(db_url, env_file, "--dry-run")
        migrate = _run(db_url, env_file)
        _assert(migrate.returncode == 0, f"migrate failed: {migrate.stdout}\n{migrate.stderr}")
        _assert(
            {"operator_id", "tenant_id", "trace_id"}.issubset(_columns(db_path)),
            f"unexpected columns after migrate: {_columns(db_path)}",
        )
        _assert(
            {"ix_admin_logs_operator_id", "ix_admin_logs_tenant_id", "ix_admin_logs_trace_id"}.issubset(_indexes(db_path)),
            f"unexpected indexes after migrate: {_indexes(db_path)}",
        )

        rollback_dry = _run(db_url, env_file, "--action", "rollback", "--dry-run")
        _assert(rollback_dry.returncode == 0, f"rollback dry-run failed: {rollback_dry.stderr}")

        rollback = _run(db_url, env_file, "--action", "rollback")
        _assert(rollback.returncode == 0, f"rollback failed: {rollback.stdout}\n{rollback.stderr}")
        _assert(_columns(db_path) == baseline, f"unexpected columns after rollback: {_columns(db_path)}")
        _assert(
            "ix_admin_logs_operator_id" not in _indexes(db_path)
            and "ix_admin_logs_tenant_id" not in _indexes(db_path)
            and "ix_admin_logs_trace_id" not in _indexes(db_path),
            f"unexpected indexes after rollback: {_indexes(db_path)}",
        )

    print("MIGRATE_ADMIN_LOG_AUDIT_FIELDS_ROLLBACK_UNIT_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
