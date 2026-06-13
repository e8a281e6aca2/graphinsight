#!/usr/bin/env python3
"""Smoke check for build-graph reasoning profile propagation."""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from admin.database import SessionLocal
from admin.models import AdminUser
from admin.services.auth_service import auth_service


def _request(method: str, url: str, payload: dict | None = None, token: str | None = None) -> tuple[int, dict | str]:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = resp.read().decode("utf-8")
            return resp.status, json.loads(raw)
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8")
        try:
            return exc.code, json.loads(raw)
        except Exception:
            return exc.code, raw


def _data(body: dict | str) -> dict | list | None:
    if isinstance(body, dict):
        return body.get("data")
    return None


def _login(base: str, username: str, password: str) -> str | None:
    status, body = _request(
        "POST",
        f"{base}/api/v1/admin/auth/login",
        {"username": username, "password": password},
    )
    if status != 200:
        return None
    data = _data(body)
    if isinstance(data, dict):
        token = data.get("token")
        return str(token) if token else None
    return None


def _issue_local_token(email: str) -> str | None:
    db = SessionLocal()
    try:
        user = db.query(AdminUser).filter(AdminUser.email == email).first()
        if user is None:
            return None
        return auth_service.create_access_token({"sub": user.email or user.username})
    finally:
        db.close()


def _poll_job(base: str, token: str, job_id: int, timeout_seconds: int) -> dict | None:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        status, body = _request("GET", f"{base}/api/v1/admin/jobs/{job_id}", token=token)
        if status != 200:
            return None
        data = _data(body)
        if isinstance(data, dict) and str(data.get("status") or "") in {"succeeded", "failed", "cancelled"}:
            return data
        time.sleep(2)
    return None


def main() -> int:
    base = os.getenv("ADMIN_BASE_URL", os.getenv("ADMIN_API_BASE", "http://127.0.0.1:8081")).rstrip("/")
    username = os.getenv("ADMIN_EMAIL", os.getenv("ADMIN_SMOKE_USERNAME", "yh@qs.al"))
    password = os.getenv("ADMIN_PASSWORD", os.getenv("ADMIN_SMOKE_PASSWORD"))
    timeout_seconds = int(os.getenv("JOB_FLOW_TIMEOUT_SECONDS", "180"))

    token = _login(base, username, password) if password else None
    if not token:
        token = _issue_local_token(username)
    if not token:
        print("LOGIN_FAIL")
        return 1

    create_payload = {
        "tenant_id": "t-graph-profile-smoke",
        "project_id": "p-graph-profile-smoke",
        "payload": {
            "source": "smoke",
            "force": False,
            "complex_extraction": True,
        },
        "max_retries": 0,
    }
    c_status, c_body = _request("POST", f"{base}/api/v1/admin/jobs/build-graph", create_payload, token)
    if c_status not in {200, 201}:
        print(f"CREATE_FAIL status={c_status} body={c_body}")
        return 1

    c_data = _data(c_body)
    if not isinstance(c_data, dict) or not c_data.get("id"):
        print(f"CREATE_INVALID body={c_body}")
        return 1

    job_id = int(c_data["id"])
    job = _poll_job(base, token, job_id, timeout_seconds)
    if not isinstance(job, dict):
        print(f"JOB_TIMEOUT id={job_id}")
        return 1

    payload = job.get("payload") if isinstance(job.get("payload"), dict) else {}
    result = job.get("result") if isinstance(job.get("result"), dict) else {}

    if payload.get("complex_extraction") is not True:
        print(f"PAYLOAD_COMPLEX_EXTRACTION_INVALID payload={payload}")
        return 1
    if payload.get("reasoning_profile") != "balanced":
        print(f"PAYLOAD_REASONING_PROFILE_INVALID payload={payload}")
        return 1
    if result and result.get("reasoning_profile") != "balanced":
        print(f"RESULT_REASONING_PROFILE_INVALID result={result}")
        return 1

    print("BUILD_GRAPH_REASONING_PROFILE_SMOKE_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
