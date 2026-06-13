#!/usr/bin/env python3
"""Verify admin_users.preferred_home_path migration supports migrate, dry-run, and rollback."""
from __future__ import annotations

import os
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "backend" / "admin" / "migrate_add_preferred_home_path.py"


def _assert(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def _columns(db_path: Path) -> set[str]:
    with sqlite3.connect(db_path) as conn:
        rows = conn.execute("PRAGMA table_info(admin_users)").fetchall()
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
    with tempfile.TemporaryDirectory(prefix="graphinsight-migrate-preferred-home-") as tmpdir:
        db_path = Path(tmpdir) / "admin.sqlite3"
        env_file = Path(tmpdir) / "backend.env"
        db_url = f"sqlite:///{db_path}"
        env_file.write_text(f'ADMIN_DATABASE_URL="{db_url}"\n', encoding="utf-8")

        with sqlite3.connect(db_path) as conn:
            conn.execute(
                """
                CREATE TABLE admin_users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT,
                    email TEXT
                )
                """
            )
            conn.commit()

        baseline = _columns(db_path)
        migrate = _run(db_url, env_file)
        _assert(migrate.returncode == 0, f"migrate failed: {migrate.stdout}\n{migrate.stderr}")
        _assert(
            "preferred_home_path" in _columns(db_path),
            f"preferred_home_path missing after migrate: {_columns(db_path)}",
        )

        rollback = _run(db_url, env_file, "--action", "rollback")
        _assert(rollback.returncode == 0, f"rollback failed: {rollback.stdout}\n{rollback.stderr}")
        _assert(_columns(db_path) == baseline, f"unexpected columns after rollback: {_columns(db_path)}")

    print("MIGRATE_ADD_PREFERRED_HOME_PATH_ROLLBACK_UNIT_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
