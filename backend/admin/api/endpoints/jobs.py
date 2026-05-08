"""
任务中心 API
"""
from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, Query, Request, status
from sqlalchemy.orm import Session

from ...database import get_db
from ...models import AdminUser
from ...schemas.jobs import JobCreateRequest, JobQuery
from ...services import job_service
from ..deps import get_current_user, require_admin_permission
from core import (
    BusinessException,
    NotFoundException,
    ValidationException,
    error_response,
    paginated_response,
    success_response,
    get_logger,
)

logger = get_logger()

router = APIRouter(prefix="/admin/jobs", tags=["任务中心"])


@router.post(
    "/build-graph",
    summary="创建建图任务",
    dependencies=[Depends(require_admin_permission("job:manage", resource="job"))],
)
async def create_build_graph_job(
    payload: JobCreateRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: AdminUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        item = job_service.create_job(
            db,
            job_type="build_graph",
            request=payload,
            requested_by=current_user.id,
            trace_id=getattr(request.state, "trace_id", None),
        )
        if job_service.should_auto_run(item):
            job_service.submit_job(background_tasks, item.id)
        return success_response(data=item.model_dump(), message="任务已创建", code=status.HTTP_201_CREATED)
    except (ValidationException, BusinessException) as exc:
        return error_response(message=exc.message, code=exc.status_code, error_code=exc.error_code)
    except Exception as exc:
        logger.error(f"创建建图任务异常: {exc}", exc_info=True)
        return error_response(message="创建建图任务失败", code=status.HTTP_500_INTERNAL_SERVER_ERROR)


@router.post(
    "/clear-kb",
    summary="创建清空知识库任务",
    dependencies=[Depends(require_admin_permission("job:manage", resource="job"))],
)
async def create_clear_kb_job(
    payload: JobCreateRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: AdminUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        item = job_service.create_job(
            db,
            job_type="clear_kb",
            request=payload,
            requested_by=current_user.id,
            trace_id=getattr(request.state, "trace_id", None),
        )
        if job_service.should_auto_run(item):
            job_service.submit_job(background_tasks, item.id)
        return success_response(data=item.model_dump(), message="任务已创建", code=status.HTTP_201_CREATED)
    except (ValidationException, BusinessException) as exc:
        return error_response(message=exc.message, code=exc.status_code, error_code=exc.error_code)
    except Exception as exc:
        logger.error(f"创建清库任务异常: {exc}", exc_info=True)
        return error_response(message="创建清库任务失败", code=status.HTTP_500_INTERNAL_SERVER_ERROR)


@router.post(
    "/reindex",
    summary="创建重建索引任务",
    dependencies=[Depends(require_admin_permission("job:manage", resource="job"))],
)
async def create_reindex_job(
    payload: JobCreateRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: AdminUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        item = job_service.create_job(
            db,
            job_type="reindex",
            request=payload,
            requested_by=current_user.id,
            trace_id=getattr(request.state, "trace_id", None),
        )
        if job_service.should_auto_run(item):
            job_service.submit_job(background_tasks, item.id)
        return success_response(data=item.model_dump(), message="任务已创建", code=status.HTTP_201_CREATED)
    except (ValidationException, BusinessException) as exc:
        return error_response(message=exc.message, code=exc.status_code, error_code=exc.error_code)
    except Exception as exc:
        logger.error(f"创建重建索引任务异常: {exc}", exc_info=True)
        return error_response(message="创建重建索引任务失败", code=status.HTTP_500_INTERNAL_SERVER_ERROR)


@router.get(
    "",
    summary="获取任务列表",
    dependencies=[Depends(require_admin_permission("job:read", resource="job"))],
)
async def list_jobs(
    job_type: str | None = Query(default=None),
    status_value: str | None = Query(default=None, alias="status"),
    tenant_id: str | None = Query(default=None),
    project_id: str | None = Query(default=None),
    kb_id: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    db: Session = Depends(get_db),
):
    try:
        query = JobQuery(
            job_type=job_type,
            status=status_value,
            tenant_id=tenant_id,
            project_id=project_id,
            kb_id=kb_id,
            page=page,
            page_size=page_size,
        )
        items, total = job_service.list_jobs(db, query)
        return paginated_response(
            items=[item.model_dump() for item in items],
            total=total,
            page=page,
            page_size=page_size,
            message="获取成功",
        )
    except (ValidationException, BusinessException) as exc:
        return error_response(message=exc.message, code=exc.status_code, error_code=exc.error_code)
    except Exception as exc:
        logger.error(f"查询任务列表异常: {exc}", exc_info=True)
        return error_response(message="查询任务列表失败", code=status.HTTP_500_INTERNAL_SERVER_ERROR)


@router.get(
    "/{job_id}",
    summary="获取任务详情",
    dependencies=[Depends(require_admin_permission("job:read", resource="job"))],
)
async def get_job(job_id: int, db: Session = Depends(get_db)):
    try:
        item = job_service.get_job(db, job_id)
        return success_response(data=item.model_dump(), message="获取成功")
    except (NotFoundException, ValidationException, BusinessException) as exc:
        return error_response(message=exc.message, code=exc.status_code, error_code=exc.error_code)
    except Exception as exc:
        logger.error(f"查询任务详情异常: {exc}", exc_info=True)
        return error_response(message="查询任务详情失败", code=status.HTTP_500_INTERNAL_SERVER_ERROR)


@router.get(
    "/{job_id}/logs",
    summary="获取任务日志",
    dependencies=[Depends(require_admin_permission("job:read", resource="job"))],
)
async def get_job_logs(
    job_id: int,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    try:
        items, total = job_service.get_job_logs(db, job_id, page=page, page_size=page_size)
        return paginated_response(
            items=items,
            total=total,
            page=page,
            page_size=page_size,
            message="获取成功",
        )
    except (NotFoundException, ValidationException, BusinessException) as exc:
        return error_response(message=exc.message, code=exc.status_code, error_code=exc.error_code)
    except Exception as exc:
        logger.error(f"查询任务日志异常: {exc}", exc_info=True)
        return error_response(message="查询任务日志失败", code=status.HTTP_500_INTERNAL_SERVER_ERROR)


@router.post(
    "/{job_id}:retry",
    summary="重试任务",
    dependencies=[Depends(require_admin_permission("job:manage", resource="job"))],
)
async def retry_job(
    job_id: int,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: AdminUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        item = job_service.retry_job(
            db,
            job_id,
            operator_id=current_user.id,
            trace_id=getattr(request.state, "trace_id", None),
        )
        if job_service.should_auto_run(item):
            job_service.submit_job(background_tasks, item.id)
        return success_response(data=item.model_dump(), message="重试已提交")
    except (NotFoundException, ValidationException, BusinessException) as exc:
        return error_response(message=exc.message, code=exc.status_code, error_code=exc.error_code)
    except Exception as exc:
        logger.error(f"重试任务异常: {exc}", exc_info=True)
        return error_response(message="重试任务失败", code=status.HTTP_500_INTERNAL_SERVER_ERROR)


@router.post(
    "/{job_id}:cancel",
    summary="取消任务",
    dependencies=[Depends(require_admin_permission("job:manage", resource="job"))],
)
async def cancel_job(
    job_id: int,
    request: Request,
    db: Session = Depends(get_db),
):
    try:
        item = job_service.cancel_job(db, job_id, trace_id=getattr(request.state, "trace_id", None))
        return success_response(data=item.model_dump(), message="任务已取消")
    except (NotFoundException, ValidationException, BusinessException) as exc:
        return error_response(message=exc.message, code=exc.status_code, error_code=exc.error_code)
    except Exception as exc:
        logger.error(f"取消任务异常: {exc}", exc_info=True)
        return error_response(message="取消任务失败", code=status.HTTP_500_INTERNAL_SERVER_ERROR)
