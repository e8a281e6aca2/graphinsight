"""Helpers for Python internal entrypoints reached from the Go gateway."""
from __future__ import annotations

from typing import Optional

from fastapi import Request, status

from core import error_response


GO_ORCHESTRATOR_HEADER = "X-Go-Orchestrator"
GO_CONTROL_HEADER = "X-Go-Proxy"
GO_HEADER_VALUE = "graphinsight-go"
TRACE_HEADER = "X-Trace-Id"


def is_go_orchestrator_request(request: Request) -> bool:
    return request.headers.get(GO_ORCHESTRATOR_HEADER) == GO_HEADER_VALUE


def is_go_control_plane_request(request: Request) -> bool:
    return request.headers.get(GO_CONTROL_HEADER) == GO_HEADER_VALUE


def require_go_capability_request(request: Request):
    if not is_go_orchestrator_request(request):
        return error_response(
            message="禁止访问",
            code=status.HTTP_403_FORBIDDEN,
            error_code="FORBIDDEN",
        )
    trace_id = (request.headers.get(TRACE_HEADER) or request.headers.get(TRACE_HEADER.lower()) or "").strip()
    if trace_id:
        return None
    return error_response(
        message="缺少 trace_id",
        code=status.HTTP_400_BAD_REQUEST,
        error_code="MISSING_TRACE_ID",
    )


def operator_id_from_headers(request: Request) -> Optional[int]:
    raw = (request.headers.get("x-auth-user-id") or "").strip()
    if not raw:
        return None
    try:
        value = int(raw)
    except Exception:
        return None
    return value if value > 0 else None
