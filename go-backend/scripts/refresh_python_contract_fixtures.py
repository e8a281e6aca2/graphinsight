#!/usr/bin/env python3
"""Refresh Python API contract fixtures for Go tests.

This script calls the running Python backend and writes stable JSON fixtures to:
  go-backend/testdata/contracts/python/

Usage example:
  python scripts/refresh_python_contract_fixtures.py \
    --base-url http://127.0.0.1:8001 \
    --token <admin_jwt_optional>
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, Optional, Tuple


def _request_json(
    *,
    base_url: str,
    method: str,
    path: str,
    payload: Optional[Dict[str, Any]],
    token: str,
    timeout: float,
) -> Tuple[int, Any]:
    url = base_url.rstrip("/") + path
    body = None
    headers = {"Accept": "application/json"}
    if payload is not None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if token.strip():
        headers["Authorization"] = f"Bearer {token.strip()}"

    req = urllib.request.Request(url=url, data=body, method=method.upper(), headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            return resp.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            return exc.code, json.loads(raw) if raw else {}
        except Exception:
            return exc.code, {"raw": raw}


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _extract_node_id(query_resp: Any) -> str:
    if not isinstance(query_resp, dict):
        return ""
    nodes = query_resp.get("nodes")
    if isinstance(nodes, list) and nodes:
        first = nodes[0]
        if isinstance(first, dict):
            return str(first.get("id") or "")
    return ""


def _normalize_node_not_found(resp: Any) -> Dict[str, Any]:
    # Normalize varied Python/FastAPI error shapes into Go fixture contract shape.
    if isinstance(resp, dict):
        if all(k in resp for k in ("error", "code", "message")):
            return {
                "error": resp.get("error"),
                "code": resp.get("code"),
                "message": resp.get("message"),
            }

        detail = resp.get("detail")
        if isinstance(detail, dict):
            return {
                "error": detail.get("error", "Node not found"),
                "code": detail.get("code", "NODE_NOT_FOUND"),
                "message": detail.get("message", "Node not found"),
            }
        if isinstance(detail, str):
            return {
                "error": "Node not found",
                "code": "NODE_NOT_FOUND",
                "message": detail,
            }

        if "message" in resp and "code" in resp and isinstance(resp.get("code"), str):
            return {
                "error": resp.get("error", "Node not found"),
                "code": resp.get("code"),
                "message": resp.get("message"),
            }

    return {
        "error": "Node not found",
        "code": "NODE_NOT_FOUND",
        "message": "Node not found",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Refresh Python API contract fixtures")
    parser.add_argument("--base-url", default=os.getenv("PYTHON_BACKEND_BASE_URL", "http://127.0.0.1:8001"))
    parser.add_argument("--token", default=os.getenv("ADMIN_BEARER_TOKEN", ""))
    parser.add_argument("--timeout", type=float, default=20.0)
    parser.add_argument(
        "--output-dir",
        default=str(Path(__file__).resolve().parents[1] / "testdata" / "contracts" / "python"),
    )
    parser.add_argument(
        "--query-cypher",
        default="MATCH (n)-[r]->(m) RETURN n, r, m LIMIT 20",
        help="Cypher used to generate query fixture",
    )
    parser.add_argument("--expand-node-id", default="", help="Node ID used for /api/expand")
    parser.add_argument("--node-id", default="", help="Node ID used for /api/node/{id}")
    args = parser.parse_args()

    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    summary: Dict[str, str] = {}

    # 1) Query fixture
    status, body = _request_json(
        base_url=args.base_url,
        method="POST",
        path="/api/query",
        payload={"cypher": args.query_cypher},
        token=args.token,
        timeout=args.timeout,
    )
    if status == 200 and isinstance(body, dict) and "nodes" in body and "edges" in body:
        _write_json(output_dir / "query_success.json", body)
        summary["query_success.json"] = "ok"
    else:
        summary["query_success.json"] = f"skip(status={status})"

    candidate_node_id = args.expand_node_id.strip() or args.node_id.strip() or _extract_node_id(body)

    # 2) Expand fixture
    if candidate_node_id:
        status, expand_body = _request_json(
            base_url=args.base_url,
            method="POST",
            path="/api/expand",
            payload={"nodeId": candidate_node_id, "direction": "both", "limit": 20},
            token=args.token,
            timeout=args.timeout,
        )
        if status == 200 and isinstance(expand_body, dict) and "nodes" in expand_body and "edges" in expand_body:
            _write_json(output_dir / "expand_success.json", expand_body)
            summary["expand_success.json"] = "ok"
        else:
            summary["expand_success.json"] = f"skip(status={status})"
    else:
        summary["expand_success.json"] = "skip(no-node-id)"

    # 3) Node detail fixture
    node_id_for_detail = args.node_id.strip() or candidate_node_id
    if node_id_for_detail:
        encoded = urllib.parse.quote(node_id_for_detail, safe="")
        status, node_body = _request_json(
            base_url=args.base_url,
            method="GET",
            path=f"/api/node/{encoded}",
            payload=None,
            token=args.token,
            timeout=args.timeout,
        )
        if status == 200 and isinstance(node_body, dict) and "id" in node_body and "media" in node_body:
            _write_json(output_dir / "node_success.json", node_body)
            summary["node_success.json"] = "ok"
        else:
            summary["node_success.json"] = f"skip(status={status})"
    else:
        summary["node_success.json"] = "skip(no-node-id)"

    # 4) Node not found fixture
    status, miss_body = _request_json(
        base_url=args.base_url,
        method="GET",
        path="/api/node/not-exists-contract-fixture",
        payload=None,
        token=args.token,
        timeout=args.timeout,
    )
    if status in {404, 400, 500, 401, 403}:
        _write_json(output_dir / "node_not_found_error.json", _normalize_node_not_found(miss_body))
        summary["node_not_found_error.json"] = f"ok(status={status})"
    else:
        summary["node_not_found_error.json"] = f"skip(status={status})"

    print("Fixture refresh summary:")
    for name, result in summary.items():
        print(f"- {name}: {result}")

    all_ok_or_skip = True
    for result in summary.values():
        if result.startswith("skip"):
            # Skips are allowed; we preserve previous fixtures.
            continue
        if not result.startswith("ok"):
            all_ok_or_skip = False

    if not all_ok_or_skip:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
