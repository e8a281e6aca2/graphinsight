#!/usr/bin/env python3
"""Verify RBAC core migration supports migrate, dry-run, and rollback."""
from __future__ import annotations

import os
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "backend" / "admin" / "migrate_rbac_core.py"

RBAC_TABLES = {
    "admin_roles",
    "admin_permissions",
    "admin_role_permissions",
    "admin_user_role_bindings",
}


def _assert(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def _tables(db_path: Path) -> set[str]:
    with sqlite3.connect(db_path) as conn:
        rows = conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    return {str(row[0]) for row in rows}


def _count(db_path: Path, table_name: str) -> int:
    with sqlite3.connect(db_path) as conn:
        value = conn.execute(f"SELECT COUNT(*) FROM {table_name}").fetchone()
    return int(value[0] if value else 0)


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
    with tempfile.TemporaryDirectory(prefix="graphinsight-migrate-rbac-") as tmpdir:
        db_path = Path(tmpdir) / "admin.sqlite3"
        env_file = Path(tmpdir) / "backend.env"
        db_url = f"sqlite:///{db_path}"
        env_file.write_text(f'ADMIN_DATABASE_URL="{db_url}"\n', encoding="utf-8")

        with sqlite3.connect(db_path) as conn:
            conn.execute(
                """
                CREATE TABLE admin_users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT NOT NULL,
                    password_hash TEXT NOT NULL,
                    email TEXT NOT NULL,
                    full_name TEXT,
                    avatar TEXT,
                    phone TEXT,
                    department TEXT,
                    is_active INTEGER DEFAULT 1,
                    last_login TEXT,
                    last_login_ip TEXT,
                    login_count INTEGER DEFAULT 0,
                    created_at TEXT,
                    updated_at TEXT
                )
                """
            )
            conn.execute(
                """
                INSERT INTO admin_users (username, password_hash, email, is_active, login_count)
                VALUES ('admin', 'hash', 'admin@example.com', 1, 0)
                """
            )
            conn.commit()

        baseline_tables = _tables(db_path)
        _assert("admin_users" in baseline_tables, f"expected admin_users baseline table, got {baseline_tables}")

        dry_run_before = _run(db_url, env_file, "--dry-run")
        _assert(dry_run_before.returncode == 0, f"dry-run before migrate failed: {dry_run_before.stderr}")
        _assert(_tables(db_path) == baseline_tables, "dry-run should not modify baseline tables")

        migrate = _run(db_url, env_file)
        _assert(migrate.returncode == 0, f"migrate failed: {migrate.stdout}\n{migrate.stderr}")
        migrated_tables = _tables(db_path)
        _assert(RBAC_TABLES.issubset(migrated_tables), f"missing RBAC tables after migrate: {migrated_tables}")
        _assert(_count(db_path, "admin_roles") >= 4, "expected seeded roles after migrate")
        _assert(_count(db_path, "admin_permissions") >= 10, "expected seeded permissions after migrate")
        _assert(_count(db_path, "admin_role_permissions") > 0, "expected seeded role-permission bindings after migrate")
        _assert(_count(db_path, "admin_user_role_bindings") == 1, "expected first admin super_admin binding after migrate")

        rollback_dry = _run(db_url, env_file, "--action", "rollback", "--dry-run")
        _assert(rollback_dry.returncode == 0, f"rollback dry-run failed: {rollback_dry.stderr}")
        _assert(_tables(db_path) == migrated_tables, "rollback dry-run should not modify RBAC tables")

        rollback = _run(db_url, env_file, "--action", "rollback")
        _assert(rollback.returncode == 0, f"rollback failed: {rollback.stdout}\n{rollback.stderr}")
        rolled_back_tables = _tables(db_path)
        _assert(RBAC_TABLES.isdisjoint(rolled_back_tables), f"RBAC tables should be removed: {rolled_back_tables}")
        _assert("admin_users" in rolled_back_tables, "rollback must not remove admin_users")

        rollback_again = _run(db_url, env_file, "--action", "rollback")
        _assert(rollback_again.returncode == 0, f"idempotent rollback failed: {rollback_again.stderr}")

    print("MIGRATE_RBAC_CORE_ROLLBACK_UNIT_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
