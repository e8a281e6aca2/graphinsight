#!/usr/bin/env python3
"""Run database migration rollback smoke coverage."""
from __future__ import annotations

import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path


TESTS_DIR = Path(__file__).resolve().parent


@dataclass(frozen=True)
class SmokeCase:
    name: str
    script: str
    timeout_seconds: int


CASES: tuple[SmokeCase, ...] = (
    SmokeCase("migrate_job_worker_lease", "check_migrate_job_worker_lease_rollback_unit.py", 120),
    SmokeCase("migrate_admin_log_audit_fields", "check_migrate_admin_log_audit_fields_rollback_unit.py", 120),
    SmokeCase("migrate_add_login_count", "check_migrate_add_login_count_rollback_unit.py", 120),
    SmokeCase("migrate_add_preferred_home_path", "check_migrate_add_preferred_home_path_rollback_unit.py", 120),
    SmokeCase("migrate_add_is_encrypted", "check_migrate_add_is_encrypted_rollback_unit.py", 120),
    SmokeCase("migrate_rbac_core", "check_migrate_rbac_core_rollback_unit.py", 120),
    SmokeCase("migrate_jobs_table", "check_migrate_jobs_table_rollback_unit.py", 120),
    SmokeCase("migrate_qa_traces_table", "check_migrate_qa_traces_table_rollback_unit.py", 120),
)


def _run_case(case: SmokeCase) -> tuple[bool, float, str]:
    started = time.perf_counter()
    proc = subprocess.run(  # noqa: S603
        [sys.executable, str(TESTS_DIR / case.script)],
        cwd=str(TESTS_DIR.parent.parent),
        capture_output=True,
        text=True,
        timeout=case.timeout_seconds,
        check=False,
    )
    duration = time.perf_counter() - started
    output = (proc.stdout or "").strip()
    err = (proc.stderr or "").strip()
    combined = output
    if err:
        combined = f"{combined}\n[stderr]\n{err}".strip()
    return proc.returncode == 0, duration, combined


def main() -> int:
    failed = 0
    for case in CASES:
        print("=" * 72)
        print(f"CASE {case.name}")
        try:
            success, duration, output = _run_case(case)
        except subprocess.TimeoutExpired:
            failed += 1
            print(f"[FAIL] {case.name} timeout>{case.timeout_seconds}s")
            continue

        print(output[:12000] if output else "(no output)")
        print(f"[{'OK' if success else 'FAIL'}] {case.name} duration={duration:.1f}s")
        if not success:
            failed += 1

    print("=" * 72)
    print(f"SUMMARY total={len(CASES)} failed={failed}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
