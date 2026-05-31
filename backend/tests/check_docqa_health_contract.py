#!/usr/bin/env python3
"""DocQA health contract smoke check."""

from __future__ import annotations

import argparse
import json
import os
import urllib.error
import urllib.request


def _request(url: str, token: str) -> tuple[int, dict | str]:
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, method="GET", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
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


def main() -> int:
    parser = argparse.ArgumentParser(description="Check DocQA health response contract")
    parser.add_argument("--base-url", default=os.getenv("ADMIN_BASE_URL", "http://127.0.0.1:8081"))
    parser.add_argument("--admin-token", default=os.getenv("ADMIN_TOKEN", ""))
    args = parser.parse_args()

    status, body = _request(f"{args.base_url.rstrip('/')}/api/docqa/health?probe_llm=false", args.admin_token.strip())
    if status != 200 or not isinstance(body, dict):
        print(f"DOCQA_HEALTH_CONTRACT_FAIL status={status} body={body}")
        return 1

    data = body.get("data")
    health_status = data.get("status") if isinstance(data, dict) else None
    checks = data.get("checks") if isinstance(data, dict) else None
    if health_status not in {"healthy", "degraded", "unhealthy"}:
        print(f"DOCQA_HEALTH_STATUS_INVALID status={health_status} body={body}")
        return 1
    if not isinstance(checks, dict) or not {"neo4j", "retrieval", "llm"}.issubset(checks):
        print(f"DOCQA_HEALTH_CHECKS_INVALID checks={checks} body={body}")
        return 1

    print(f"DOCQA_HEALTH_CONTRACT_OK status={health_status}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
