#!/usr/bin/env python3
"""Verify admin_qa_traces table migration supports migrate, dry-run, and rollback."""
from __future__ import annotations

import os
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "backend" / "admin" / "migrate_qa_traces_table.py"


def _assert(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def _tables(db_path: Path) -> set[str]:
    with sqlite3.connect(db_path) as conn:
        rows = conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    return {str(row[0]) for row in rows}


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
    with tempfile.TemporaryDirectory(prefix="graphinsight-migrate-qa-traces-table-") as tmpdir:
        db_path = Path(tmpdir) / "admin.sqlite3"
        env_file = Path(tmpdir) / "backend.env"
        db_url = f"sqlite:///{db_path}"
        env_file.write_text(f'ADMIN_DATABASE_URL="{db_url}"\n', encoding="utf-8")

        baseline_tables = _tables(db_path)
        _assert("admin_qa_traces" not in baseline_tables, f"admin_qa_traces should not exist before migrate: {baseline_tables}")

        dry_run_before = _run(db_url, env_file, "--dry-run")
        _assert(dry_run_before.returncode == 0, f"dry-run before migrate failed: {dry_run_before.stderr}")
        _assert(_tables(db_path) == baseline_tables, "dry-run should not create admin_qa_traces")

        migrate = _run(db_url, env_file)
        _assert(migrate.returncode == 0, f"migrate failed: {migrate.stdout}\n{migrate.stderr}")
        migrated_tables = _tables(db_path)
        _assert("admin_qa_traces" in migrated_tables, f"admin_qa_traces missing after migrate: {migrated_tables}")

        rollback_dry = _run(db_url, env_file, "--action", "rollback", "--dry-run")
        _assert(rollback_dry.returncode == 0, f"rollback dry-run failed: {rollback_dry.stderr}")
        _assert(_tables(db_path) == migrated_tables, "rollback dry-run should not drop admin_qa_traces")

        rollback = _run(db_url, env_file, "--action", "rollback")
        _assert(rollback.returncode == 0, f"rollback failed: {rollback.stdout}\n{rollback.stderr}")
        _assert("admin_qa_traces" not in _tables(db_path), "admin_qa_traces should be removed after rollback")

        rollback_again = _run(db_url, env_file, "--action", "rollback")
        _assert(rollback_again.returncode == 0, f"idempotent rollback failed: {rollback_again.stderr}")

    print("MIGRATE_QA_TRACES_TABLE_ROLLBACK_UNIT_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
