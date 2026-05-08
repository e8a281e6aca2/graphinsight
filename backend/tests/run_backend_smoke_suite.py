"""
后端关键路径烟测总控脚本

默认串行执行：
1. 管理后台权限回归
2. 文档软删除/恢复流程
3. 任务中心基础 API
4. reindex + 可观测性联调
5. docqa -> qa-traces 联调
6. 上传 -> 建图 -> 问答 -> 追踪 -> 删除 全链路

用法:
    ADMIN_BASE_URL=http://127.0.0.1:8081 \
    ADMIN_EMAIL=yh@qs.al \
    ADMIN_PASSWORD=*** \
    python backend/tests/run_backend_smoke_suite.py

    python backend/tests/run_backend_smoke_suite.py --include authz --include qa_traces
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PYTHON = ROOT / "venv" / "Scripts" / "python.exe"
sys.path.insert(0, str(ROOT))


@dataclass(frozen=True)
class SmokeCase:
    name: str
    script: str
    timeout_seconds: int
    description: str


CASES: list[SmokeCase] = [
    SmokeCase("authz", "verify_admin_authz.py", 120, "后台权限与越权访问回归"),
    SmokeCase("documents", "check_documents_soft_delete_flow.py", 120, "文档软删除、回收站与恢复流程"),
    SmokeCase("jobs_api", "check_jobs_api.py", 120, "任务创建、查询、取消与重试"),
    SmokeCase("reindex_obs", "check_job_reindex_and_observability.py", 180, "reindex 与监控联调"),
    SmokeCase("qa_traces", "check_qa_traces_api.py", 240, "问答与问答追踪联调"),
    SmokeCase("docqa_full_chain", "check_docqa_full_chain.py", 360, "上传、建图、问答、追踪与删除全链路"),
]


def _issue_local_token(email: str) -> str:
    from admin.database import SessionLocal
    from admin.models import AdminUser
    from admin.services.auth_service import auth_service

    db = SessionLocal()
    try:
        user = db.query(AdminUser).filter(AdminUser.email == email).first()
        if user is None:
            raise RuntimeError(f"用户不存在: {email}")
        return auth_service.create_access_token({"sub": user.email or user.username})
    finally:
        db.close()


def _resolve_local_tokens(admin_email: str, low_email: str) -> tuple[str | None, str | None]:
    try:
        admin_token = _issue_local_token(admin_email)
    except Exception:  # noqa: BLE001
        admin_token = None
    try:
        low_token = _issue_local_token(low_email)
    except Exception:  # noqa: BLE001
        low_token = None
    return admin_token, low_token


def _health_check(base_url: str) -> tuple[bool, str]:
    req = urllib.request.Request(f"{base_url.rstrip('/')}/health", method="GET")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status == 200, f"status={resp.status}"
    except urllib.error.HTTPError as exc:
        return False, f"status={exc.code}"
    except Exception as exc:  # noqa: BLE001
        return False, str(exc)


def _run_case(case: SmokeCase, env: dict[str, str]) -> tuple[bool, float, str]:
    started = time.perf_counter()
    cmd = [str(PYTHON), str(Path(__file__).resolve().parent / case.script)]
    proc = subprocess.run(  # noqa: S603
        cmd,
        cwd=str(ROOT.parent),
        env=env,
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
    parser = argparse.ArgumentParser(description="后端关键路径烟测总控")
    parser.add_argument("--base-url", default=os.getenv("ADMIN_BASE_URL", "http://127.0.0.1:8081"))
    parser.add_argument("--admin-token", default=os.getenv("ADMIN_TOKEN"))
    parser.add_argument("--low-token", default=os.getenv("LOW_ROLE_TOKEN"))
    parser.add_argument("--admin-email", default=os.getenv("ADMIN_EMAIL", "yh@qs.al"))
    parser.add_argument("--low-email", default=os.getenv("LOW_EMAIL", "rbac_viewer@example.com"))
    parser.add_argument("--admin-password", default=os.getenv("ADMIN_PASSWORD"))
    parser.add_argument("--include", action="append", default=[], help="只执行指定 case，可重复传入")
    parser.add_argument("--fail-fast", action="store_true", help="遇到失败立即停止")
    args = parser.parse_args()

    base_url = str(args.base_url).rstrip("/")
    admin_token = args.admin_token.strip() if args.admin_token else ""
    low_token = args.low_token.strip() if args.low_token else ""
    if not admin_token:
        auto_admin_token, auto_low_token = _resolve_local_tokens(args.admin_email, args.low_email)
        admin_token = auto_admin_token or ""
        if not low_token:
            low_token = auto_low_token or ""

    ok, detail = _health_check(base_url)
    if not ok:
        print(f"HEALTH_CHECK_FAIL base_url={base_url} detail={detail}")
        return 1
    print(f"HEALTH_CHECK_OK base_url={base_url} detail={detail}")

    if admin_token:
        print("ADMIN_TOKEN_READY source=local_or_env")
    elif args.admin_password:
        print("ADMIN_PASSWORD_READY source=env_or_arg")
    else:
        print("缺少管理员凭证：请提供 ADMIN_TOKEN / ADMIN_PASSWORD，或确保本地 admin 数据可签发 token")
        return 1

    selected_names = set(args.include or [])
    selected_cases = [case for case in CASES if not selected_names or case.name in selected_names]
    if not selected_cases:
        print(f"NO_CASE_SELECTED include={args.include}")
        return 1

    env = os.environ.copy()
    env["ADMIN_BASE_URL"] = base_url
    env["ADMIN_EMAIL"] = args.admin_email
    env["LOW_EMAIL"] = args.low_email
    if args.admin_password:
        env["ADMIN_PASSWORD"] = args.admin_password
    if admin_token:
        env["ADMIN_TOKEN"] = admin_token
    if low_token:
        env["LOW_ROLE_TOKEN"] = low_token

    failed = 0
    for case in selected_cases:
        print("=" * 72)
        print(f"CASE {case.name}: {case.description}")
        try:
            success, duration, output = _run_case(case, env)
        except subprocess.TimeoutExpired:
            failed += 1
            print(f"[FAIL] {case.name} timeout>{case.timeout_seconds}s")
            if args.fail_fast:
                break
            continue

        print(output[:12000] if output else "(no output)")
        print(f"[{'OK' if success else 'FAIL'}] {case.name} duration={duration:.1f}s")
        if not success:
            failed += 1
            if args.fail_fast:
                break

    print("=" * 72)
    print(f"SUMMARY total={len(selected_cases)} failed={failed}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
