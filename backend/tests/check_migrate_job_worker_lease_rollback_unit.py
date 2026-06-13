#!/usr/bin/env python3
"""Verify admin_jobs worker lease migration supports migrate, dry-run, and rollback."""
from __future__ import annotations

import os
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "backend" / "admin" / "migrate_job_worker_lease.py"


def _assert(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def _sqlite_columns(db_path: Path) -> set[str]:
    with sqlite3.connect(db_path) as conn:
        rows = conn.execute("PRAGMA table_info(admin_jobs)").fetchall()
    return {str(row[1]) for row in rows}


def _sqlite_indexes(db_path: Path) -> set[str]:
    with sqlite3.connect(db_path) as conn:
        rows = conn.execute("PRAGMA index_list(admin_jobs)").fetchall()
    return {str(row[1]) for row in rows}


def _run_script(db_url: str, env_file: Path, *args: str) -> subprocess.CompletedProcess[str]:
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
    with tempfile.TemporaryDirectory(prefix="graphinsight-migrate-jobs-") as tmpdir:
        db_path = Path(tmpdir) / "admin.sqlite3"
        env_file = Path(tmpdir) / "backend.env"
        db_url = f"sqlite:///{db_path}"
        env_file.write_text(f'ADMIN_DATABASE_URL="{db_url}"\n', encoding="utf-8")

        with sqlite3.connect(db_path) as conn:
            conn.execute(
                """
                CREATE TABLE admin_jobs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    job_type TEXT,
                    status TEXT,
                    created_at TEXT
                )
                """
            )
            conn.commit()

        baseline_columns = _sqlite_columns(db_path)
        _assert(
            baseline_columns == {"id", "job_type", "status", "created_at"},
            f"unexpected baseline columns: {baseline_columns}",
        )

        dry_run_before = _run_script(db_url, env_file, "--dry-run")
        _assert(dry_run_before.returncode == 0, f"dry-run before migrate failed: {dry_run_before.stderr}")
        _assert(
            _sqlite_columns(db_path) == baseline_columns,
            "dry-run should not modify admin_jobs columns before migrate",
        )

        migrate_result = _run_script(db_url, env_file)
        _assert(migrate_result.returncode == 0, f"migrate failed: {migrate_result.stdout}\n{migrate_result.stderr}")
        migrated_columns = _sqlite_columns(db_path)
        expected_columns = baseline_columns | {"claimed_by", "claim_expires_at", "last_heartbeat_at"}
        _assert(migrated_columns == expected_columns, f"unexpected migrated columns: {migrated_columns}")
        migrated_indexes = _sqlite_indexes(db_path)
        _assert(
            {
                "idx_admin_jobs_claimed_by",
                "idx_admin_jobs_claim_expires_at",
                "idx_admin_jobs_last_heartbeat_at",
            }.issubset(migrated_indexes),
            f"expected worker lease indexes after migrate, got {migrated_indexes}",
        )

        dry_run_after = _run_script(db_url, env_file, "--action", "rollback", "--dry-run")
        _assert(dry_run_after.returncode == 0, f"rollback dry-run failed: {dry_run_after.stderr}")
        _assert(
            _sqlite_columns(db_path) == migrated_columns,
            "rollback dry-run should not modify admin_jobs columns",
        )

        rollback_result = _run_script(db_url, env_file, "--action", "rollback")
        _assert(
            rollback_result.returncode == 0,
            f"rollback failed: {rollback_result.stdout}\n{rollback_result.stderr}",
        )
        rolled_back_columns = _sqlite_columns(db_path)
        _assert(rolled_back_columns == baseline_columns, f"unexpected rolled back columns: {rolled_back_columns}")
        rolled_back_indexes = _sqlite_indexes(db_path)
        _assert(
            "idx_admin_jobs_claimed_by" not in rolled_back_indexes
            and "idx_admin_jobs_claim_expires_at" not in rolled_back_indexes
            and "idx_admin_jobs_last_heartbeat_at" not in rolled_back_indexes,
            f"expected worker lease indexes removed after rollback, got {rolled_back_indexes}",
        )

        rollback_again = _run_script(db_url, env_file, "--action", "rollback")
        _assert(rollback_again.returncode == 0, f"idempotent rollback failed: {rollback_again.stderr}")

    print("MIGRATE_JOB_WORKER_LEASE_ROLLBACK_UNIT_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
