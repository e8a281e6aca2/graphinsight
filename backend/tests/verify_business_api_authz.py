"""
业务 API 权限回归脚本（严格鉴权场景）

用法:
    ADMIN_BASE_URL=http://127.0.0.1:8081 \
    ADMIN_EMAIL=yh@qs.al \
    ADMIN_PASSWORD=Admin@123456 \
    python backend/tests/verify_business_api_authz.py
"""
from __future__ import annotations

import argparse
import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Optional


def _env(name: str, default: Optional[str] = None) -> Optional[str]:
    value = os.getenv(name)
    return value if value is not None and value.strip() else default


def _extract_data(body: dict | str) -> dict | list | None:
    if isinstance(body, dict):
        return body.get("data")
    return None


def _request(
    method: str,
    url: str,
    *,
    token: Optional[str] = None,
    payload: Optional[dict] = None,
) -> tuple[int, dict | str]:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read().decode("utf-8")
            try:
                return resp.status, json.loads(raw)
            except Exception:
                return resp.status, raw
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8")
        try:
            return exc.code, json.loads(raw)
        except Exception:
            return exc.code, raw


def _login(base_url: str, username: str, password: str) -> str:
    status, body = _request(
        "POST",
        f"{base_url}/api/v1/admin/auth/login",
        payload={"username": username, "password": password},
    )
    if status != 200 or not isinstance(body, dict):
        raise RuntimeError(f"登录失败: status={status}, body={body}")
    data = _extract_data(body)
    token = data.get("token") if isinstance(data, dict) else None
    if not token:
        raise RuntimeError(f"登录响应缺少 token: body={body}")
    return str(token)


def _ensure_low_user(
    *,
    base_url: str,
    admin_token: str,
    low_username: str,
    low_email: str,
    low_password: str,
) -> int:
    query_url = f"{base_url}/api/v1/admin/users?page=1&page_size=200&search={low_email}"
    status, body = _request("GET", query_url, token=admin_token)
    if status != 200 or not isinstance(body, dict):
        raise RuntimeError(f"查询用户失败: status={status}, body={body}")
    data = _extract_data(body)
    items = data.get("items", []) if isinstance(data, dict) else []
    for item in items:
        if (item.get("email") or "").lower() == low_email.lower():
            return int(item["id"])

    create_payload = {
        "username": low_username,
        "email": low_email,
        "password": low_password,
        "full_name": "Business API Viewer",
    }
    create_status, create_body = _request(
        "POST",
        f"{base_url}/api/v1/admin/users",
        token=admin_token,
        payload=create_payload,
    )
    if create_status in {200, 201} and isinstance(create_body, dict):
        create_data = _extract_data(create_body)
        if isinstance(create_data, dict) and create_data.get("id"):
            return int(create_data["id"])
    raise RuntimeError(f"创建低权限用户失败: status={create_status}, body={create_body}")


def _ensure_viewer_binding(*, base_url: str, admin_token: str, user_id: int) -> None:
    status, body = _request(
        "GET",
        f"{base_url}/api/v1/admin/rbac/bindings?user_id={user_id}",
        token=admin_token,
    )
    if status != 200 or not isinstance(body, dict):
        raise RuntimeError(f"查询 RBAC 绑定失败: status={status}, body={body}")
    data = _extract_data(body)
    bindings = data if isinstance(data, list) else []
    for item in bindings:
        if item.get("role_name") == "viewer" and item.get("scope_type") == "global":
            return
    payload = {"user_id": user_id, "role_name": "viewer", "scope_type": "global"}
    create_status, create_body = _request(
        "POST",
        f"{base_url}/api/v1/admin/rbac/bindings",
        token=admin_token,
        payload=payload,
    )
    if create_status != 200:
        raise RuntimeError(f"创建 viewer 绑定失败: status={create_status}, body={create_body}")


@dataclass
class Case:
    name: str
    method: str
    path: str
    token: Optional[str]
    payload: Optional[dict]
    expect_status: Optional[int] = None
    forbid_statuses: tuple[int, ...] = ()


def main() -> int:
    parser = argparse.ArgumentParser(description="业务 API 权限回归")
    parser.add_argument("--base-url", default=_env("ADMIN_BASE_URL", "http://127.0.0.1:8081"))
    parser.add_argument("--admin-email", default=_env("ADMIN_EMAIL", "yh@qs.al"))
    parser.add_argument("--admin-password", default=_env("ADMIN_PASSWORD", "Admin@123456"))
    parser.add_argument("--low-email", default=_env("LOW_EMAIL", "biz_viewer@example.com"))
    parser.add_argument("--low-username", default=_env("LOW_USERNAME", "biz_viewer"))
    parser.add_argument("--low-password", default=_env("LOW_PASSWORD", "Passw0rd123"))
    args = parser.parse_args()

    base_url = str(args.base_url).rstrip("/")

    try:
        admin_token = _login(base_url, args.admin_email, args.admin_password)
        low_user_id = _ensure_low_user(
            base_url=base_url,
            admin_token=admin_token,
            low_username=args.low_username,
            low_email=args.low_email,
            low_password=args.low_password,
        )
        _ensure_viewer_binding(base_url=base_url, admin_token=admin_token, user_id=low_user_id)
        low_token = _login(base_url, args.low_email, args.low_password)
    except Exception as exc:  # noqa: BLE001
        print(f"初始化失败: {exc}")
        return 1

    cases = [
        Case("unauth_documents_list", "GET", "/api/documents", None, None, expect_status=401),
        Case("unauth_docqa_health", "GET", "/api/docqa/health", None, None, expect_status=401),
        Case("lowrole_documents_list", "GET", "/api/documents", low_token, None, expect_status=200),
        Case(
            "lowrole_graph_build_forbidden",
            "POST",
            "/api/graph/build",
            low_token,
            {"source": "documents", "force": False},
            expect_status=403,
        ),
        Case(
            "lowrole_kb_clear_forbidden",
            "DELETE",
            "/api/documents?purge_graph=false",
            low_token,
            None,
            expect_status=403,
        ),
        Case(
            "lowrole_nl2cypher_status_forbidden",
            "GET",
            "/api/nl2cypher/status",
            low_token,
            None,
            expect_status=403,
        ),
        Case(
            "admin_nl2cypher_status_auth_ok",
            "GET",
            "/api/nl2cypher/status",
            admin_token,
            None,
            forbid_statuses=(401, 403),
        ),
    ]

    failed = 0
    for case in cases:
        status, body = _request(
            case.method,
            f"{base_url}{case.path}",
            token=case.token,
            payload=case.payload,
        )
        if case.expect_status is not None:
            ok = status == case.expect_status
        else:
            ok = status not in case.forbid_statuses
        print(f"[{'OK' if ok else 'FAIL'}] {case.name} -> {status}")
        if not ok:
            failed += 1
            print(f"  url={base_url}{case.path}")
            print(f"  body={body}")

    print("-" * 60)
    print(f"total={len(cases)} failed={failed}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
