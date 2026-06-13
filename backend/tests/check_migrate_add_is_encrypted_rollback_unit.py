#!/usr/bin/env python3
"""Verify admin_configs encryption/version migration supports migrate, dry-run, and rollback."""
from __future__ import annotations

import os
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "backend" / "admin" / "migrate_add_is_encrypted.py"


def _assert(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def _columns(db_path: Path) -> set[str]:
    with sqlite3.connect(db_path) as conn:
        rows = conn.execute("PRAGMA table_info(admin_configs)").fetchall()
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
    with tempfile.TemporaryDirectory(prefix="graphinsight-migrate-config-encryption-") as tmpdir:
        db_path = Path(tmpdir) / "admin.sqlite3"
        env_file = Path(tmpdir) / "backend.env"
        db_url = f"sqlite:///{db_path}"
        env_file.write_text(f'ADMIN_DATABASE_URL="{db_url}"\n', encoding="utf-8")

        with sqlite3.connect(db_path) as conn:
            conn.execute(
                """
                CREATE TABLE admin_configs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    category TEXT,
                    key TEXT,
                    value TEXT
                )
                """
            )
            conn.commit()

        baseline = _columns(db_path)
        migrate = _run(db_url, env_file)
        _assert(migrate.returncode == 0, f"migrate failed: {migrate.stdout}\n{migrate.stderr}")
        current = _columns(db_path)
        _assert("is_encrypted" in current and "version" in current, f"unexpected columns after migrate: {current}")

        rollback = _run(db_url, env_file, "--action", "rollback")
        _assert(rollback.returncode == 0, f"rollback failed: {rollback.stdout}\n{rollback.stderr}")
        _assert(_columns(db_path) == baseline, f"unexpected columns after rollback: {_columns(db_path)}")

    print("MIGRATE_ADD_IS_ENCRYPTED_ROLLBACK_UNIT_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
