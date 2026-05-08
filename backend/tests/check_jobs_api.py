"""
Jobs API smoke check.

Usage:
    python backend/tests/check_jobs_api.py
"""
from __future__ import annotations

import argparse
import json
import os
import urllib.error
import urllib.request


def _request(method: str, url: str, payload: dict | None = None, token: str | None = None) -> tuple[int, dict | str]:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
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
    parser = argparse.ArgumentParser(description="Jobs API smoke check")
    parser.add_argument("--base-url", default=os.getenv("ADMIN_BASE_URL", "http://127.0.0.1:8081"))
    parser.add_argument("--admin-token", default=os.getenv("ADMIN_TOKEN"))
    parser.add_argument("--admin-email", default=os.getenv("ADMIN_EMAIL", "yh@qs.al"))
    parser.add_argument("--admin-password", default=os.getenv("ADMIN_PASSWORD"))
    args = parser.parse_args()

    base = str(args.base_url).rstrip("/")
    token = args.admin_token.strip() if args.admin_token else ""
    if not token:
        if not args.admin_password:
            print("MISSING_ADMIN_PASSWORD")
            return 1
        status, body = _request(
            "POST",
            f"{base}/api/v1/admin/auth/login",
            {"username": args.admin_email, "password": args.admin_password},
        )
        if status != 200:
            print(f"LOGIN_FAIL status={status} body={body}")
            return 1
        token = (_data(body) or {}).get("token") if isinstance(_data(body), dict) else None
        if not token:
            print(f"LOGIN_NO_TOKEN body={body}")
            return 1

    create_payload = {"tenant_id": "t-demo", "project_id": "p-demo", "payload": {"source": "smoke"}}
    c_status, c_body = _request("POST", f"{base}/api/v1/admin/jobs/build-graph", create_payload, token)
    print(f"CREATE_JOB status={c_status}")
    if c_status not in {200, 201}:
        print(c_body)
        return 1
    c_data = _data(c_body)
    if not isinstance(c_data, dict) or not c_data.get("id"):
        print(f"CREATE_JOB_INVALID body={c_body}")
        return 1
    job_id = int(c_data["id"])

    l_status, l_body = _request("GET", f"{base}/api/v1/admin/jobs?page=1&page_size=10", token=token)
    print(f"LIST_JOB status={l_status}")
    if l_status != 200:
        print(l_body)
        return 1

    g_status, g_body = _request("GET", f"{base}/api/v1/admin/jobs/{job_id}", token=token)
    print(f"GET_JOB status={g_status}")
    if g_status != 200:
        print(g_body)
        return 1

    x_status, x_body = _request("POST", f"{base}/api/v1/admin/jobs/{job_id}:cancel", token=token)
    print(f"CANCEL_JOB status={x_status}")
    if x_status != 200:
        print(x_body)
        return 1

    r_status, r_body = _request("POST", f"{base}/api/v1/admin/jobs/{job_id}:retry", token=token)
    print(f"RETRY_JOB status={r_status}")
    if r_status != 200:
        print(r_body)
        return 1

    print("JOBS_API_SMOKE_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
