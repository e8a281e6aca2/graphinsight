"""
任务中心 API
"""
from __future__ import annotations

PYTHON_PUBLIC_ADMIN_API_RETIRED = True
"""Go owns public admin jobs routes; Python only mounts internal jobs wake."""

import threading

from fastapi import APIRouter, Request, status

from ...services import job_service
from api.internal_access import is_go_control_plane_request
from core import (
    error_response,
    success_response,
    get_logger,
)

logger = get_logger()

internal_router = APIRouter(prefix="/internal/jobs", tags=["任务中心"])


async def _wake_job_worker(request: Request):
    try:
        if not is_go_control_plane_request(request):
            return error_response(
                message="禁止访问",
                code=status.HTTP_403_FORBIDDEN,
                error_code="FORBIDDEN",
            )

        threading.Thread(
            target=job_service.wake_worker,
            daemon=True,
            name="admin-job-worker-wake-request",
        ).start()
        return success_response(data={"accepted": True}, message="任务 worker 已唤醒")
    except Exception as exc:
        logger.error(f"唤醒任务 worker 异常: {exc}", exc_info=True)
        return error_response(message="唤醒任务 worker 失败", code=status.HTTP_500_INTERNAL_SERVER_ERROR)


@internal_router.post("/wake", summary="唤醒后台任务 worker")
async def wake_job_worker_internal(request: Request):
    return await _wake_job_worker(request)
