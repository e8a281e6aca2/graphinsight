"""
Build-graph async job flow smoke check.

Usage:
    python backend/tests/check_build_graph_job_flow.py
"""
from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request


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


def main() -> int:
    base = os.getenv("ADMIN_BASE_URL", os.getenv("ADMIN_API_BASE", "http://127.0.0.1:8081")).rstrip("/")
    username = os.getenv("ADMIN_EMAIL", os.getenv("ADMIN_SMOKE_USERNAME", "yh@qs.al"))
    password = os.getenv("ADMIN_PASSWORD", os.getenv("ADMIN_SMOKE_PASSWORD"))
    timeout_seconds = int(os.getenv("JOB_FLOW_TIMEOUT_SECONDS", "180"))
    poll_interval = float(os.getenv("JOB_FLOW_POLL_SECONDS", "2"))

    if not password:
        print("MISSING_ADMIN_PASSWORD")
        return 1

    status, body = _request(
        "POST",
        f"{base}/api/v1/admin/auth/login",
        {"username": username, "password": password},
    )
    if status != 200:
        print(f"LOGIN_FAIL status={status} body={body}")
        return 1
    token = (_data(body) or {}).get("token") if isinstance(_data(body), dict) else None
    if not token:
        print(f"LOGIN_NO_TOKEN body={body}")
        return 1

    create_payload = {
        "tenant_id": "t-smoke",
        "project_id": "p-smoke",
        "payload": {"source": "smoke", "force": False},
        "max_retries": 2,
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
    created_status = c_data.get("status")
    print(f"JOB_CREATED id={job_id} status={created_status}")

    deadline = time.time() + timeout_seconds
    last_status = str(created_status or "")
    while time.time() < deadline:
        g_status, g_body = _request("GET", f"{base}/api/v1/admin/jobs/{job_id}", token=token)
        if g_status != 200:
            print(f"GET_FAIL status={g_status} body={g_body}")
            return 1
        g_data = _data(g_body)
        if not isinstance(g_data, dict):
            print(f"GET_INVALID body={g_body}")
            return 1

        last_status = str(g_data.get("status") or "")
        started_at = g_data.get("started_at")
        finished_at = g_data.get("finished_at")
        print(f"JOB_POLL id={job_id} status={last_status} started_at={started_at} finished_at={finished_at}")

        if last_status in {"succeeded", "failed", "cancelled"}:
            result = g_data.get("result")
            error_message = g_data.get("error_message")
            print(f"JOB_DONE id={job_id} status={last_status} error={error_message} result={result}")
            if not started_at or not finished_at:
                print("JOB_INVALID_TIMING missing started_at/finished_at")
                return 1
            print("BUILD_GRAPH_JOB_FLOW_OK")
            return 0
        time.sleep(poll_interval)

    print(f"JOB_TIMEOUT id={job_id} last_status={last_status}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
