"""Route registration helpers for Python admin capability APIs."""
from __future__ import annotations

from typing import Iterable

from fastapi import APIRouter, FastAPI

from admin.api.endpoints import jobs as jobs_endpoints


RouterSpec = tuple[APIRouter, str, list[str]]

# Do not add public /api/v1/admin/* routers here. Go owns the external admin
# control plane; Python only exposes the internal worker wake capability.
INTERNAL_ADMIN_CAPABILITY_ROUTERS: tuple[RouterSpec, ...] = (
    (jobs_endpoints.internal_router, "/api", ["任务中心"]),
)


def _include_router_specs(app: FastAPI, router_specs: Iterable[RouterSpec]) -> None:
    for router, prefix, tags in router_specs:
        app.include_router(router, prefix=prefix, tags=tags)


def register_internal_admin_capability_routes(app: FastAPI) -> None:
    """Mount internal admin capability routes used by the Go control plane."""
    _include_router_specs(app, INTERNAL_ADMIN_CAPABILITY_ROUTERS)
