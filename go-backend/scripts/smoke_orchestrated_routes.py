#!/usr/bin/env python3
"""Smoke test for Go orchestrated routes.

Default mode is read-only (no graph build, no file upload).

Examples:
  python scripts/smoke_orchestrated_routes.py \
    --go-base-url http://127.0.0.1:8081 \
    --admin-email yh@qs.al \
    --admin-password '***' \
    --require-orchestrator-connected

  python scripts/smoke_orchestrated_routes.py \
    --go-base-url http://127.0.0.1:8081 \
    --token <admin_jwt> \
    --with-build \
    --with-upload
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
from dataclasses import dataclass
from typing import Any, Dict, Optional


@dataclass
class StepResult:
    name: str
    ok: bool
    status: int
    detail: str


def _request(
    *,
    base_url: str,
    method: str,
    path: str,
    payload: Optional[Dict[str, Any]] = None,
    token: str = "",
    timeout: float = 20.0,
    headers: Optional[Dict[str, str]] = None,
) -> tuple[int, Any]:
    url = base_url.rstrip("/") + path
    body = None
    req_headers: Dict[str, str] = {"Accept": "application/json"}
    if payload is not None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        req_headers["Content-Type"] = "application/json"
    if token.strip():
        req_headers["Authorization"] = f"Bearer {token.strip()}"
    if headers:
        req_headers.update(headers)

    req = urllib.request.Request(url=url, data=body, method=method.upper(), headers=req_headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            text = resp.read().decode("utf-8", errors="replace")
            return resp.status, json.loads(text) if text else {}
    except urllib.error.HTTPError as exc:
        text = exc.read().decode("utf-8", errors="replace")
        try:
            return exc.code, json.loads(text) if text else {}
        except Exception:
            return exc.code, {"raw": text}


def _login(base_url: str, username: str, password: str, timeout: float) -> str:
    status, body = _request(
        base_url=base_url,
        method="POST",
        path="/api/v1/admin/auth/login",
        payload={"username": username, "password": password},
        timeout=timeout,
    )
    if status != 200 or not isinstance(body, dict):
        raise RuntimeError(f"LOGIN_FAIL status={status} body={_as_json(body)}")
    data = body.get("data")
    token = data.get("token") if isinstance(data, dict) else None
    if not token:
        raise RuntimeError(f"LOGIN_NO_TOKEN body={_as_json(body)}")
    return str(token)


def _request_upload(
    *,
    base_url: str,
    token: str,
    timeout: float,
    filename: str,
    content: bytes,
) -> tuple[int, Any]:
    boundary = "----GraphInsightSmoke" + uuid.uuid4().hex
    url = base_url.rstrip("/") + "/api/documents/upload"

    body = bytearray()
    body.extend(f"--{boundary}\r\n".encode())
    body.extend(f'Content-Disposition: form-data; name="files"; filename="{filename}"\r\n'.encode())
    body.extend(b"Content-Type: text/plain\r\n\r\n")
    body.extend(content)
    body.extend(b"\r\n")
    body.extend(f"--{boundary}--\r\n".encode())

    headers = {
        "Accept": "application/json",
        "Content-Type": f"multipart/form-data; boundary={boundary}",
    }
    if token.strip():
        headers["Authorization"] = f"Bearer {token.strip()}"

    req = urllib.request.Request(url=url, data=bytes(body), method="POST", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            text = resp.read().decode("utf-8", errors="replace")
            return resp.status, json.loads(text) if text else {}
    except urllib.error.HTTPError as exc:
        text = exc.read().decode("utf-8", errors="replace")
        try:
            return exc.code, json.loads(text) if text else {}
        except Exception:
            return exc.code, {"raw": text}


def _envelope_code(payload: Any) -> Any:
    if isinstance(payload, dict):
        return payload.get("code")
    return None


def _as_json(payload: Any) -> str:
    try:
        return json.dumps(payload, ensure_ascii=False)
    except Exception:
        return str(payload)


def main() -> int:
    parser = argparse.ArgumentParser(description="Smoke test for Go orchestrated routes")
    parser.add_argument("--go-base-url", default=os.getenv("GO_BASE_URL", os.getenv("ADMIN_BASE_URL", "http://127.0.0.1:8081")))
    parser.add_argument("--token", default=os.getenv("ADMIN_TOKEN", ""))
    parser.add_argument("--admin-email", default=os.getenv("ADMIN_EMAIL", "yh@qs.al"))
    parser.add_argument("--admin-password", default=os.getenv("ADMIN_PASSWORD", ""))
    parser.add_argument("--timeout", type=float, default=20.0)
    parser.add_argument("--require-orchestrator-connected", action="store_true")
    parser.add_argument("--with-build", action="store_true")
    parser.add_argument("--with-upload", action="store_true")
    args = parser.parse_args()

    token = args.token.strip()
    if not token and args.admin_password.strip():
        try:
            token = _login(args.go_base_url, args.admin_email, args.admin_password, args.timeout)
        except Exception as exc:
            print(f"LOGIN_INIT_FAIL {exc}")
            return 1

    results: list[StepResult] = []

    # 1) Health
    status, health = _request(
        base_url=args.go_base_url,
        method="GET",
        path="/health",
        token=token,
        timeout=args.timeout,
    )
    if status != 200:
        results.append(StepResult("health", False, status, f"unexpected status, payload={_as_json(health)}"))
    else:
        orch = (health or {}).get("data", {}).get("orchestrator", {}) if isinstance(health, dict) else {}
        connected = bool(orch.get("connected"))
        if args.require_orchestrator_connected and not connected:
            results.append(StepResult("health", False, status, f"orchestrator not connected: {_as_json(orch)}"))
        else:
            results.append(StepResult("health", True, status, f"orchestrator={_as_json(orch)}"))

    # 2) Documents list (orchestrated)
    status, docs = _request(
        base_url=args.go_base_url,
        method="GET",
        path="/api/documents",
        token=token,
        timeout=args.timeout,
    )
    ok_docs = status == 200 and isinstance(docs, dict)
    detail_docs = f"envelope_code={_envelope_code(docs)}"
    results.append(StepResult("documents.list", ok_docs, status, detail_docs))

    # 3) DocQA health (orchestrated)
    status, qa_health = _request(
        base_url=args.go_base_url,
        method="GET",
        path="/api/docqa/health?probe_llm=false",
        token=token,
        timeout=args.timeout,
    )
    ok_qa = status in {200, 500} and isinstance(qa_health, dict)
    detail_qa = f"envelope_code={_envelope_code(qa_health)}"
    results.append(StepResult("docqa.health", ok_qa, status, detail_qa))

    # 4) Optional graph build trigger (orchestrated)
    if args.with_build:
        status, build = _request(
            base_url=args.go_base_url,
            method="POST",
            path="/api/graph/build",
            payload={"source": "documents", "force": False, "note": "smoke"},
            token=token,
            timeout=max(args.timeout, 60.0),
        )
        ok_build = status == 200 and isinstance(build, dict)
        detail_build = f"envelope_code={_envelope_code(build)}"
        results.append(StepResult("graph.build", ok_build, status, detail_build))

    # 5) Optional upload (orchestrated stream)
    if args.with_upload:
        status, upload = _request_upload(
            base_url=args.go_base_url,
            token=token,
            timeout=args.timeout,
            filename="smoke_upload.txt",
            content=b"GraphInsight smoke upload test\n",
        )
        ok_upload = status == 200 and isinstance(upload, dict)
        detail_upload = f"envelope_code={_envelope_code(upload)}"
        results.append(StepResult("documents.upload", ok_upload, status, detail_upload))

    print("Smoke results:")
    for item in results:
        icon = "PASS" if item.ok else "FAIL"
        print(f"- [{icon}] {item.name}: status={item.status} | {item.detail}")

    failed = [item for item in results if not item.ok]
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
