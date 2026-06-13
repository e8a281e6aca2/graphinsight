#!/usr/bin/env python3
"""NL2Cypher Go entry contract smoke check."""

from __future__ import annotations

import argparse
import json
import os
import urllib.error
import urllib.request


def _request(url: str, token: str | None = None) -> tuple[int, dict | str, dict[str, str]]:
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, method="GET", headers=headers)
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
    parser = argparse.ArgumentParser(description="Check NL2Cypher Go entry contract")
    parser.add_argument("--base-url", default=os.getenv("ADMIN_BASE_URL", "http://127.0.0.1:8081"))
    parser.add_argument("--admin-token", default=os.getenv("ADMIN_TOKEN", ""))
    args = parser.parse_args()

    base_url = args.base_url.rstrip("/")
    token = args.admin_token.strip()

    status, body, headers = _request(f"{base_url}/api/nl2cypher/examples")
    owner = headers.get("x-graphinsight-route-owner", "")
    _assert(status == 200, f"expected 200 for examples, got status={status} body={body}")
    _assert(owner == "go-native", f"expected go-native owner for examples, got owner={owner or '<missing>'}")
    _assert(isinstance(body, dict), f"expected dict examples body, got {type(body)}")
    _assert(body.get("success") is True, f"expected success=true for examples, got body={body}")
    examples = body.get("examples")
    _assert(isinstance(examples, list) and len(examples) > 0, f"expected non-empty examples list, got body={body}")
    _assert(all(isinstance(item, dict) for item in examples), f"expected example items to be objects, got body={body}")

    _assert(bool(token), "ADMIN_TOKEN is required for /api/nl2cypher/status contract check")
    status, body, headers = _request(f"{base_url}/api/nl2cypher/status", token=token)
    owner = headers.get("x-graphinsight-route-owner", "")
    _assert(status == 200, f"expected 200 for status, got status={status} body={body}")
    _assert(owner == "go-native", f"expected go-native owner for status, got owner={owner or '<missing>'}")
    _assert(isinstance(body, dict), f"expected dict status body, got {type(body)}")
    for key in ("enabled", "api_key_configured", "max_limit", "config_source"):
        _assert(key in body, f"expected {key} in status body, got body={body}")
    _assert(isinstance(body.get("enabled"), bool), f"expected enabled bool, got body={body}")
    _assert(isinstance(body.get("api_key_configured"), bool), f"expected api_key_configured bool, got body={body}")
    _assert(body.get("config_source") == "go-native", f"expected config_source=go-native, got body={body}")

    print("NL2CYPHER_GO_CONTRACT_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
