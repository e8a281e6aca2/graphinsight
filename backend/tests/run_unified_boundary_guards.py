#!/usr/bin/env python3
"""Run the Python-side unified boundary guard suite."""
from __future__ import annotations

import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TESTS_DIR = Path(__file__).resolve().parent
PYTHON_EXE = ROOT / ".venv" / "bin" / "python"


@dataclass(frozen=True)
class GuardCase:
    name: str
    script: str
    timeout_seconds: int
    description: str


CASES: tuple[GuardCase, ...] = (
    GuardCase("migration_cleanup", "check_migration_cleanup_guards.py", 60, "迁移清理静态守卫"),
    GuardCase("route_mounts", "check_unified_route_mounts_unit.py", 60, "统一运行态路由挂载边界"),
    GuardCase("internal_inventory", "check_python_internal_route_inventory_unit.py", 60, "Python internal capability inventory"),
    GuardCase("business_public_removed", "check_business_public_routes_removed_unit.py", 60, "Python 公开业务路由移除守卫"),
    GuardCase("admin_public_removed", "check_admin_public_routes_removed_unit.py", 60, "Python 公开管理路由移除守卫"),
    GuardCase("docqa_internal", "check_docqa_internal_route_unit.py", 60, "DocQA internal header contract"),
    GuardCase("nl2cypher_internal", "check_nl2cypher_internal_route_unit.py", 60, "NL2Cypher internal header contract"),
    GuardCase("runtime_config_boundary", "check_runtime_config_boundary_unit.py", 60, "Python runtime config boundary"),
    GuardCase("job_worker", "check_job_worker_unit.py", 60, "Python worker lease and wake behavior"),
    GuardCase("qa_cost", "check_qa_cost_summary_unit.py", 60, "QA cost aggregation unit check"),
    GuardCase("admin_env_override", "check_admin_env_override_unit.py", 60, "unified runtime env override guard"),
    GuardCase("rate_limit_exempt", "check_rate_limit_exempt_unit.py", 60, "internal health probe rate limit exemption"),
)


def _resolve_python() -> Path:
    if PYTHON_EXE.exists():
        return PYTHON_EXE
    raise RuntimeError(
        f"未找到 Linux 后端虚拟环境 Python: {PYTHON_EXE}。"
        "请先运行: python3 -m venv backend/.venv && backend/.venv/bin/python -m pip install -r backend/requirements.txt"
    )


def _run_case(python_bin: Path, case: GuardCase) -> tuple[bool, float, str]:
    started = time.perf_counter()
    proc = subprocess.run(  # noqa: S603
        [str(python_bin), str(TESTS_DIR / case.script)],
        cwd=str(ROOT.parent),
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
    python_bin = _resolve_python()
    failed = 0
    for case in CASES:
        print("=" * 72)
        print(f"CASE {case.name}: {case.description}")
        try:
            success, duration, output = _run_case(python_bin, case)
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
