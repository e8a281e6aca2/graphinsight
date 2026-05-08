"""
Check admin login API quickly.

Usage:
    python backend/tests/check_admin_login.py --username yh@qs.al --password Admin@123456
"""
from __future__ import annotations

import argparse
import json
import os
import urllib.error
import urllib.request


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default=os.getenv("ADMIN_BASE_URL", "http://127.0.0.1:8081"))
    parser.add_argument("--username", required=True)
    parser.add_argument("--password", required=True)
    args = parser.parse_args()

    payload = json.dumps({"username": args.username, "password": args.password}).encode("utf-8")
    req = urllib.request.Request(
        f"{args.base_url.rstrip('/')}/api/v1/admin/auth/login",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = resp.read().decode("utf-8")
            print(f"STATUS={resp.status}")
            print(body[:500])
            return 0
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8")
        print(f"STATUS={exc.code}")
        print(body[:500])
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
