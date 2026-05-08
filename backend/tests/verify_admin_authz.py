"""
RBAC 权限回归脚本（黑盒）

用法:
    # 方式1：直接提供 token
    ADMIN_BASE_URL=http://127.0.0.1:8081 \
    ADMIN_TOKEN=... \
    LOW_ROLE_TOKEN=... \
    python backend/tests/verify_admin_authz.py

    # 方式2：提供管理员账号密码（脚本会自动准备低权限账号并登录）
    ADMIN_BASE_URL=http://127.0.0.1:8081 \
    ADMIN_EMAIL=yh@qs.al \
    ADMIN_PASSWORD=Admin@123456 \
    python backend/tests/verify_admin_authz.py

说明:
    - ADMIN_TOKEN: 拥有 super_admin 权限的 token
    - LOW_ROLE_TOKEN: 低权限角色 token（比如 viewer）
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
    return value if value is not None and value.strip() != "" else default


def _extract_data(body: dict | str) -> dict | list | None:
    if isinstance(body, dict) and "data" in body:
        return body.get("data")
    return None


def _request(method: str, url: str, token: Optional[str] = None, payload: Optional[dict] = None) -> tuple[int, dict | str]:
    body = None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
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
        "full_name": "RBAC Viewer",
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

    # 兼容重复创建/并发创建场景：再查一次
    status2, body2 = _request("GET", query_url, token=admin_token)
    if status2 == 200 and isinstance(body2, dict):
        data2 = _extract_data(body2)
        items2 = data2.get("items", []) if isinstance(data2, dict) else []
        for item in items2:
            if (item.get("email") or "").lower() == low_email.lower():
                return int(item["id"])

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

    bind_payload = {"user_id": user_id, "role_name": "viewer", "scope_type": "global"}
    create_status, create_body = _request(
        "POST",
        f"{base_url}/api/v1/admin/rbac/bindings",
        token=admin_token,
        payload=bind_payload,
    )
    if create_status != 200:
        raise RuntimeError(f"创建 RBAC 绑定失败: status={create_status}, body={create_body}")


@dataclass
class Case:
    name: str
    method: str
    path: str
    token: Optional[str]
    expect_status: int


def main() -> int:
    parser = argparse.ArgumentParser(description="RBAC 权限回归")
    parser.add_argument("--base-url", default=_env("ADMIN_BASE_URL", "http://127.0.0.1:8081"))
    parser.add_argument("--admin-token", default=_env("ADMIN_TOKEN"))
    parser.add_argument("--low-token", default=_env("LOW_ROLE_TOKEN"))
    parser.add_argument("--admin-email", default=_env("ADMIN_EMAIL", "yh@qs.al"))
    parser.add_argument("--admin-password", default=_env("ADMIN_PASSWORD"))
    parser.add_argument("--low-email", default=_env("LOW_EMAIL", "rbac_viewer@example.com"))
    parser.add_argument("--low-username", default=_env("LOW_USERNAME", "rbac_viewer"))
    parser.add_argument("--low-password", default=_env("LOW_PASSWORD", "Passw0rd123"))
    parser.add_argument("--skip-ensure-low-user", action="store_true")
    args = parser.parse_args()

    base_url = str(args.base_url).rstrip("/")
    admin_token = args.admin_token
    low_token = args.low_token

    try:
        if not admin_token:
            if not args.admin_email or not args.admin_password:
                print("缺少管理员登录信息：请提供 ADMIN_TOKEN 或 ADMIN_EMAIL + ADMIN_PASSWORD")
                return 1
            admin_token = _login(base_url, args.admin_email, args.admin_password)
            print("admin_token 获取成功")

        if not low_token:
            if not args.skip_ensure_low_user:
                low_user_id = _ensure_low_user(
                    base_url=base_url,
                    admin_token=admin_token,
                    low_username=args.low_username,
                    low_email=args.low_email,
                    low_password=args.low_password,
                )
                _ensure_viewer_binding(base_url=base_url, admin_token=admin_token, user_id=low_user_id)
                print(f"low_user 准备完成: user_id={low_user_id}")
            low_token = _login(base_url, args.low_email, args.low_password)
            print("low_role_token 获取成功")
    except Exception as exc:  # noqa: BLE001
        print(f"初始化凭证失败: {exc}")
        return 1

    cases = [
        Case("unauth_logs_list", "GET", "/api/v1/admin/logs", None, 401),
        Case("unauth_config_list", "GET", "/api/v1/admin/config", None, 401),
        Case("unauth_users_list", "GET", "/api/v1/admin/users", None, 401),
        Case("lowrole_config_read", "GET", "/api/v1/admin/config", low_token, 403),
        Case("lowrole_logs_read", "GET", "/api/v1/admin/logs", low_token, 403),
        Case("lowrole_user_manage", "GET", "/api/v1/admin/users", low_token, 403),
        Case("admin_logs_list", "GET", "/api/v1/admin/logs", admin_token, 200),
        Case("admin_config_list", "GET", "/api/v1/admin/config/neo4j/all", admin_token, 200),
        Case("admin_users_list", "GET", "/api/v1/admin/users", admin_token, 200),
        Case("admin_monitor", "GET", "/api/v1/admin/monitor/health", admin_token, 200),
    ]

    failed = 0
    for case in cases:
        url = f"{base_url}{case.path}"
        status, body = _request(case.method, url, token=case.token)
        ok = status == case.expect_status
        if not ok:
            failed += 1
        print(f"[{'OK' if ok else 'FAIL'}] {case.name} -> {status}")
        if not ok:
            print(f"  expected={case.expect_status} url={url}")
            print(f"  body={body}")

    print("-" * 60)
    print(f"total={len(cases)} failed={failed}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
