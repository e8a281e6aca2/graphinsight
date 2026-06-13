#!/usr/bin/env python3
"""Run a local Go gateway configuration rollback drill on an isolated port."""
from __future__ import annotations

import argparse
import json
import os
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = ROOT.parent
GO_BACKEND_DIR = REPO_ROOT / "go-backend"
ACCEPTANCE = ROOT / "tests" / "run_release_acceptance.sh"
DEV_BACKEND_ENV = REPO_ROOT / "logs" / "dev" / "backend.env"


def _request_json(url: str, timeout: float = 5.0) -> tuple[int, dict[str, Any] | str]:
    req = urllib.request.Request(url, method="GET", headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            try:
                return resp.status, json.loads(raw)
            except Exception:
                return resp.status, raw
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            return exc.code, json.loads(raw)
        except Exception:
            return exc.code, raw


def _wait_for_http(url: str, timeout_seconds: float, *, require_python_connected: bool | None = None) -> dict[str, Any]:
    started = time.time()
    last_status = None
    last_body: dict[str, Any] | str | None = None
    while time.time() - started < timeout_seconds:
        try:
            status, body = _request_json(url, timeout=3.0)
            last_status = status
            last_body = body
            if status == 200 and isinstance(body, dict):
                data = body.get("data") or {}
                service_status = str(data.get("status") or "").strip().lower()
                python_connected = bool((data.get("python_backend") or {}).get("connected"))
                orchestrator_connected = bool((data.get("orchestrator") or {}).get("connected"))
                if require_python_connected is None:
                    return {
                        "status": status,
                        "body": body,
                        "elapsed_seconds": round(time.time() - started, 3),
                    }
                if require_python_connected and python_connected and orchestrator_connected:
                    return {
                        "status": status,
                        "body": body,
                        "elapsed_seconds": round(time.time() - started, 3),
                    }
                if not require_python_connected and service_status and service_status != "healthy":
                    return {
                        "status": status,
                        "body": body,
                        "elapsed_seconds": round(time.time() - started, 3),
                    }
        except Exception:
            pass
        time.sleep(1)
    raise RuntimeError(
        f"timeout waiting for {url}; last_status={last_status} last_body={last_body}"
    )


def _wait_for_port_release(host: str, port: int, timeout_seconds: float) -> None:
    started = time.time()
    while time.time() - started < timeout_seconds:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(1.0)
            if sock.connect_ex((host, port)) != 0:
                return
        time.sleep(0.5)
    raise RuntimeError(f"port did not release in time: {host}:{port}")


def _read_env_file(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    data: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            data[key] = value
    return data


def _build_shared_env() -> dict[str, str]:
    file_values = _read_env_file(DEV_BACKEND_ENV)
    shared: dict[str, str] = {}
    for key in (
        "NEO4J_URI",
        "NEO4J_USER",
        "NEO4J_PASSWORD",
        "NEO4J_DATABASE",
        "NEO4J_CONFIG_SOURCE",
        "MEDIA_STORAGE_PATH",
        "DOCUMENT_STORAGE_PATH",
        "ADMIN_DATABASE_URL",
        "RBAC_AUTHZ_MODE",
        "ADMIN_SECRET_KEY",
    ):
        value = (file_values.get(key) or os.getenv(key) or "").strip()
        if value:
            shared[key] = value
    shared.setdefault("NEO4J_CONFIG_SOURCE", "env")
    shared.setdefault("RBAC_AUTHZ_MODE", "go_db")
    return shared


def _start_go_gateway(
    *,
    host: str,
    port: int,
    python_base_url: str,
    log_path: Path,
    shared_env: dict[str, str],
) -> subprocess.Popen[str]:
    env = os.environ.copy()
    env.update(shared_env)
    env["API_HOST"] = host
    env["API_PORT"] = str(port)
    env["PYTHON_BACKEND_BASE_URL"] = python_base_url.rstrip("/")
    env.setdefault("RBAC_AUTHZ_MODE", "go_db")
    log_path.parent.mkdir(parents=True, exist_ok=True)
    log_file = log_path.open("w", encoding="utf-8")
    return subprocess.Popen(  # noqa: S603
        ["go", "run", "./cmd/api"],
        cwd=str(GO_BACKEND_DIR),
        env=env,
        stdout=log_file,
        stderr=subprocess.STDOUT,
        text=True,
        preexec_fn=os.setsid,
    )


def _stop_process(proc: subprocess.Popen[str] | None) -> None:
    if proc is None or proc.poll() is not None:
        return
    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except Exception:
        proc.terminate()
    try:
        proc.wait(timeout=15)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except Exception:
            proc.kill()
        proc.wait(timeout=5)


def _run_acceptance(base_url: str, artifacts_dir: Path) -> tuple[int, str]:
    cmd = [
        str(ACCEPTANCE),
        "--base-url",
        base_url.rstrip("/"),
        "--skip-frontend-e2e",
        "--skip-perf-probe",
        "--include",
        "migration_cleanup_guards",
        "--include",
        "go_orchestrated",
        "--include",
        "unified_mode",
        "--artifacts-dir",
        str(artifacts_dir),
    ]
    proc = subprocess.run(  # noqa: S603
        cmd,
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
        check=False,
    )
    combined = (proc.stdout or "").strip()
    err = (proc.stderr or "").strip()
    if err:
        combined = f"{combined}\n[stderr]\n{err}".strip()
    return proc.returncode, combined


def _request_docqa_health(base_url: str) -> tuple[int, dict[str, Any] | str]:
    return _request_json(base_url.rstrip("/") + "/api/docqa/health?probe_llm=false", timeout=10.0)


def _issue_local_token(email: str) -> str:
    sys.path.insert(0, str(ROOT))
    from admin.database import SessionLocal
    from admin.models import AdminUser
    from admin.services.auth_service import auth_service

    db = SessionLocal()
    try:
        user = db.query(AdminUser).filter(AdminUser.email == email).first()
        if user is None:
            raise RuntimeError(f"admin user not found: {email}")
        return auth_service.create_access_token({"sub": user.email or user.username})
    finally:
        db.close()


def _request_docqa_health_with_token(base_url: str, token: str) -> tuple[int, dict[str, Any] | str]:
    req = urllib.request.Request(
        base_url.rstrip("/") + "/api/docqa/health?probe_llm=false",
        method="GET",
        headers={"Accept": "application/json", "Authorization": f"Bearer {token.strip()}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10.0) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            try:
                return resp.status, json.loads(raw)
            except Exception:
                return resp.status, raw
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            return exc.code, json.loads(raw)
        except Exception:
            return exc.code, raw


def _write_report(path: Path, report: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Run local configuration rollback drill on isolated Go port")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=18081)
    parser.add_argument("--python-base-url", default="http://127.0.0.1:8001")
    parser.add_argument("--broken-python-base-url", default="http://127.0.0.1:65535")
    parser.add_argument("--admin-email", default=os.getenv("ADMIN_EMAIL", "yh@qs.al"))
    parser.add_argument("--timeout-seconds", type=float, default=60.0)
    parser.add_argument("--output-dir", default="artifacts/rollback-drill/2026-06-07")
    args = parser.parse_args()

    output_dir = Path(args.output_dir)
    report: dict[str, Any] = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "base_url": f"http://{args.host}:{args.port}",
        "python_base_url": args.python_base_url.rstrip("/"),
        "broken_python_base_url": args.broken_python_base_url.rstrip("/"),
        "steps": [],
    }

    python_status, python_body = _request_json(args.python_base_url.rstrip("/") + "/health", timeout=10.0)
    if python_status != 200:
        raise SystemExit(f"python capability backend unavailable: status={python_status} body={python_body}")
    report["python_health"] = {"status": python_status, "body": python_body}
    admin_token = _issue_local_token(args.admin_email)
    shared_env = _build_shared_env()
    report["shared_env_keys"] = sorted(shared_env.keys())

    gateway: subprocess.Popen[str] | None = None
    base_url = f"http://{args.host}:{args.port}"
    try:
        healthy_log = output_dir / "go-healthy.log"
        gateway = _start_go_gateway(
            host=args.host,
            port=args.port,
            python_base_url=args.python_base_url,
            log_path=healthy_log,
            shared_env=shared_env,
        )
        healthy_result = _wait_for_http(
            base_url.rstrip("/") + "/health",
            args.timeout_seconds,
            require_python_connected=True,
        )
        report["steps"].append({"name": "healthy_start", **healthy_result, "log": str(healthy_log)})

        broken_probe_status, broken_probe_body = _request_docqa_health(base_url)
        report["steps"].append(
            {"name": "healthy_docqa_health", "status": broken_probe_status, "body": broken_probe_body}
        )

        _stop_process(gateway)
        gateway = None
        _wait_for_port_release(args.host, args.port, 30.0)

        broken_log = output_dir / "go-broken.log"
        gateway = _start_go_gateway(
            host=args.host,
            port=args.port,
            python_base_url=args.broken_python_base_url,
            log_path=broken_log,
            shared_env=shared_env,
        )
        broken_health = _wait_for_http(
            base_url.rstrip("/") + "/health",
            args.timeout_seconds,
            require_python_connected=None,
        )
        report["steps"].append({"name": "broken_start", **broken_health, "log": str(broken_log)})
        broken_docqa_status, broken_docqa_body = _request_docqa_health_with_token(base_url, admin_token)
        report["steps"].append(
            {"name": "broken_docqa_health", "status": broken_docqa_status, "body": broken_docqa_body}
        )
        if broken_docqa_status != 502:
            raise RuntimeError(
                f"expected broken docqa health status=502, got status={broken_docqa_status} body={broken_docqa_body}"
            )

        _stop_process(gateway)
        gateway = None
        _wait_for_port_release(args.host, args.port, 30.0)

        rollback_log = output_dir / "go-rollback.log"
        rollback_started = time.time()
        gateway = _start_go_gateway(
            host=args.host,
            port=args.port,
            python_base_url=args.python_base_url,
            log_path=rollback_log,
            shared_env=shared_env,
        )
        rollback_health = _wait_for_http(
            base_url.rstrip("/") + "/health",
            args.timeout_seconds,
            require_python_connected=True,
        )
        rollback_health["rollback_elapsed_seconds"] = round(time.time() - rollback_started, 3)
        report["steps"].append({"name": "rollback_start", **rollback_health, "log": str(rollback_log)})

        acceptance_dir = output_dir / "acceptance"
        acceptance_exit, acceptance_output = _run_acceptance(base_url, acceptance_dir)
        report["acceptance"] = {
            "exit_code": acceptance_exit,
            "artifacts_dir": str(acceptance_dir),
            "output": acceptance_output,
        }
        if acceptance_exit != 0:
            raise RuntimeError(f"rollback acceptance failed: {acceptance_output}")

        report["result"] = "pass"
    finally:
        _stop_process(gateway)

    _write_report(output_dir / "summary.json", report)
    print(f"ROLLBACK_DRILL_SUMMARY result={report['result']} summary={output_dir / 'summary.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
