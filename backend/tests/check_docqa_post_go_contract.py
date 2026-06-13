#!/usr/bin/env python3
"""DocQA POST Go entry contract smoke check."""

from __future__ import annotations

import argparse
import json
import os
import urllib.error
import urllib.request


def _request(url: str, payload: dict, token: str | None = None) -> tuple[int, dict | str, dict[str, str]]:
    data = json.dumps(payload).encode("utf-8")
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, method="POST", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            try:
                body: dict | str = json.loads(raw)
            except Exception:
                body = raw
            return resp.status, body, {k.lower(): v for k, v in resp.headers.items()}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            body = json.loads(raw)
        except Exception:
            body = raw
        return exc.code, body, {k.lower(): v for k, v in exc.headers.items()}


def _assert(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> int:
    parser = argparse.ArgumentParser(description="Check DocQA POST Go entry contract")
    parser.add_argument("--base-url", default=os.getenv("ADMIN_BASE_URL", "http://127.0.0.1:8081"))
    parser.add_argument("--admin-token", default=os.getenv("ADMIN_TOKEN", ""))
    args = parser.parse_args()

    base_url = args.base_url.rstrip("/")
    token = args.admin_token.strip()
    _assert(bool(token), "ADMIN_TOKEN is required for /api/docqa POST contract check")

    status, body, headers = _request(f"{base_url}/api/docqa", {"question": "   "}, token=token)
    owner = headers.get("x-graphinsight-route-owner", "")
    _assert(status == 400, f"expected 400 for blank question, got status={status} body={body}")
    _assert(owner == "go-orchestrator", f"expected go-orchestrator owner, got owner={owner or '<missing>'}")
    _assert(isinstance(body, dict), f"expected dict body, got {type(body)}")
    _assert(body.get("message") == "问题不能为空", f"unexpected message body={body}")
    _assert(body.get("trace_id"), f"expected trace_id in body, got body={body}")

    print("DOCQA_POST_GO_CONTRACT_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
