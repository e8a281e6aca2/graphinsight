"""
Quick check: login then call admin users create API.

Usage:
    python backend/tests/check_create_user_api.py
"""
from __future__ import annotations

import json
import os
import random
import string
import urllib.error
import urllib.request


def _post_json(url: str, payload: dict, token: str | None = None) -> tuple[int, dict | str]:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )
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


def main() -> int:
    base = os.getenv("ADMIN_BASE_URL", "http://127.0.0.1:8081").rstrip("/")
    admin_email = os.getenv("ADMIN_EMAIL", "yh@qs.al")
    admin_password = os.getenv("ADMIN_PASSWORD", "Admin@123456")
    status, body = _post_json(
        f"{base}/api/v1/admin/auth/login",
        {"username": admin_email, "password": admin_password},
    )
    if status != 200 or not isinstance(body, dict):
        print(f"LOGIN_FAIL status={status} body={body}")
        return 1

    token = body.get("data", {}).get("token")
    if not token:
        print(f"LOGIN_NO_TOKEN body={body}")
        return 1

    suffix = "".join(random.choice(string.digits) for _ in range(6))
    payload = {
        "username": f"api_user_{suffix}",
        "email": f"api_user_{suffix}@example.com",
        "password": "Passw0rd123",
        "full_name": "API User",
    }
    create_status, create_body = _post_json(f"{base}/api/v1/admin/users", payload, token=token)
    print(f"CREATE_STATUS={create_status}")
    print(create_body)
    return 0 if create_status in {200, 201} else 1


if __name__ == "__main__":
    raise SystemExit(main())
