#!/usr/bin/env python3
"""DocQA health Go entry contract smoke check."""

from __future__ import annotations

import argparse
import json
import os
import urllib.error
import urllib.request


def _request(url: str, token: str) -> tuple[int, dict | str, dict[str, str]]:
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, method="GET", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
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
    parser = argparse.ArgumentParser(description="Check DocQA health Go entry contract")
    parser.add_argument("--base-url", default=os.getenv("ADMIN_BASE_URL", "http://127.0.0.1:8081"))
    parser.add_argument("--admin-token", default=os.getenv("ADMIN_TOKEN", ""))
    args = parser.parse_args()

    status, body, headers = _request(
        f"{args.base_url.rstrip('/')}/api/docqa/health?probe_llm=not-bool",
        args.admin_token.strip(),
    )
    owner = headers.get("x-graphinsight-route-owner", "")
    _assert(status == 400, f"expected 400 for invalid probe_llm, got status={status} body={body}")
    _assert(owner == "go-orchestrator", f"expected go-orchestrator owner, got owner={owner or '<missing>'}")
    _assert(isinstance(body, dict), f"expected dict body, got {type(body)}")
    _assert(body.get("message") == "参数错误", f"unexpected message body={body}")
    _assert(body.get("trace_id"), f"expected trace_id in body, got body={body}")

    print("DOCQA_HEALTH_GO_CONTRACT_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
