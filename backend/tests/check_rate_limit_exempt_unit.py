#!/usr/bin/env python3
"""Unit check for rate limit exemption paths."""
from __future__ import annotations

import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient


BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

from core.middleware import RateLimitMiddleware  # noqa: E402


def _assert(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def _build_app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(
        RateLimitMiddleware,
        default_limit=2,
        window_seconds=60,
        exempt_paths=["/api/internal/docqa/health"],
    )

    @app.get("/api/internal/docqa/health")
    async def docqa_health() -> JSONResponse:
        return JSONResponse({"code": 200, "message": "ok"})

    @app.post("/api/internal/nl2cypher")
    async def nl2cypher_capability() -> JSONResponse:
        return JSONResponse({"code": 200, "message": "ok"})

    return app


def main() -> int:
    client = TestClient(_build_app())

    for index in range(5):
        resp = client.get("/api/internal/docqa/health")
        _assert(
            resp.status_code == 200,
            f"expected exempt docqa health request {index + 1} to stay 200, got status={resp.status_code} body={resp.text}",
        )

    first = client.post("/api/internal/nl2cypher")
    second = client.post("/api/internal/nl2cypher")
    third = client.post("/api/internal/nl2cypher")
    _assert(first.status_code == 200, f"expected first non-exempt request 200, got {first.status_code}")
    _assert(second.status_code == 200, f"expected second non-exempt request 200, got {second.status_code}")
    _assert(third.status_code == 429, f"expected third non-exempt request 429, got {third.status_code}")

    print("RATE_LIMIT_EXEMPT_UNIT_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
