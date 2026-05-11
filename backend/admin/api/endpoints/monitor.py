"""
监控 API 端点
"""
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from ...database import get_db
from ...models import AdminUser
from ...services import monitor_service
from ..deps import require_admin_permission
from core import (
    success_response,
    error_response,
    SystemException,
    get_logger,
)

logger = get_logger()
router = APIRouter(prefix="/admin/monitor", tags=["系统监控"])


@router.get(
    "/stats",
    summary="获取系统统计",
    description="获取系统资源使用情况"
)
async def get_system_stats(
    current_user: AdminUser = Depends(require_admin_permission("monitor:read", resource="monitor")),
):
    """
    获取系统统计
    
    包括 CPU、内存、磁盘使用率等
    """
    try:
        stats = monitor_service.get_system_stats()
        
        return success_response(
            data=stats.model_dump(),
            message="获取成功"
        )
        
    except SystemException as e:
        return error_response(
            message=e.message,
            code=e.status_code,
            error_code=e.error_code,
            error_type="SystemError"
        )
    except Exception as e:
        logger.error(f"获取系统统计异常: {str(e)}", exc_info=True)
        return error_response(
            message="获取系统统计失败",
            code=status.HTTP_500_INTERNAL_SERVER_ERROR
        )


@router.get(
    "/health",
    summary="健康检查",
    description="检查系统各组件的健康状态"
)
async def get_health_status(
    current_user: AdminUser = Depends(require_admin_permission("monitor:read", resource="monitor")),
    db: Session = Depends(get_db)
):
    """
    健康检查
    
    检查数据库、Neo4j、系统资源等
    """
    try:
        health = monitor_service.get_health_status(db)
        
        return success_response(
            data=health.model_dump(),
            message="获取成功"
        )
        
    except SystemException as e:
        return error_response(
            message=e.message,
            code=e.status_code,
            error_code=e.error_code,
            error_type="SystemError"
        )
    except Exception as e:
        logger.error(f"获取健康状态异常: {str(e)}", exc_info=True)
        return error_response(
            message="获取健康状态失败",
            code=status.HTTP_500_INTERNAL_SERVER_ERROR
        )


@router.get(
    "/metrics/unified",
    summary="统一指标快照",
    description="聚合 API、问答与任务中心的统一运营指标",
)
async def get_unified_metrics(
    api_window_seconds: int = Query(default=900, ge=60, le=86400),
    qa_window_seconds: int = Query(default=900, ge=60, le=86400),
    job_window_minutes: int = Query(default=60, ge=5, le=10080),
    current_user: AdminUser = Depends(require_admin_permission("monitor:read", resource="monitor")),
    db: Session = Depends(get_db),
):
    try:
        data = monitor_service.get_unified_metrics_snapshot(
            db,
            api_window_seconds=api_window_seconds,
            qa_window_seconds=qa_window_seconds,
            job_window_minutes=job_window_minutes,
        )
        return success_response(data=data, message="获取成功")
    except Exception as e:
        logger.error(f"获取统一指标快照异常: {str(e)}", exc_info=True)
        return error_response(
            message="获取统一指标快照失败",
            code=status.HTTP_500_INTERNAL_SERVER_ERROR
        )


@router.get(
    "/performance",
    summary="性能指标",
    description="获取 API 性能指标（延迟、错误率、RPS）",
)
async def get_performance_metrics(
    window_seconds: int = Query(default=900, ge=60, le=86400),
    current_user: AdminUser = Depends(require_admin_permission("monitor:read", resource="monitor")),
):
    try:
        data = monitor_service.get_performance_metrics(window_seconds=window_seconds)
        return success_response(data=data, message="获取成功")
    except Exception as e:
        logger.error(f"获取性能指标异常: {str(e)}", exc_info=True)
        return error_response(
            message="获取性能指标失败",
            code=status.HTTP_500_INTERNAL_SERVER_ERROR
        )


@router.get(
    "/qa",
    summary="问答质量指标",
    description="获取文档问答成功率、引用率、失败率与延迟分布",
)
async def get_qa_quality_metrics(
    window_seconds: int = Query(default=900, ge=60, le=86400),
    current_user: AdminUser = Depends(require_admin_permission("monitor:read", resource="monitor")),
):
    try:
        data = monitor_service.get_qa_quality_metrics(window_seconds=window_seconds)
        return success_response(data=data, message="获取成功")
    except Exception as e:
        logger.error(f"获取问答质量指标异常: {str(e)}", exc_info=True)
        return error_response(
            message="获取问答质量指标失败",
            code=status.HTTP_500_INTERNAL_SERVER_ERROR
        )


@router.get(
    "/slo",
    summary="SLO 快照",
    description="获取 API 与任务中心的 SLO 快照",
)
async def get_slo_snapshot(
    api_window_seconds: int = Query(default=900, ge=60, le=86400),
    job_window_minutes: int = Query(default=60, ge=5, le=10080),
    current_user: AdminUser = Depends(require_admin_permission("monitor:read", resource="monitor")),
    db: Session = Depends(get_db),
):
    try:
        data = monitor_service.get_slo_snapshot(
            db,
            api_window_seconds=api_window_seconds,
            job_window_minutes=job_window_minutes,
        )
        return success_response(data=data, message="获取成功")
    except Exception as e:
        logger.error(f"获取 SLO 快照异常: {str(e)}", exc_info=True)
        return error_response(
            message="获取 SLO 快照失败",
            code=status.HTTP_500_INTERNAL_SERVER_ERROR
        )


@router.get(
    "/log-severity",
    summary="日志分级指标",
    description="获取 error/warn/info 日志分级统计与告警路由策略",
)
async def get_log_severity_metrics(
    window_minutes: int = Query(default=60, ge=5, le=10080),
    current_user: AdminUser = Depends(require_admin_permission("monitor:read", resource="monitor")),
    db: Session = Depends(get_db),
):
    try:
        data = monitor_service.get_log_severity_metrics(db, window_minutes=window_minutes)
        return success_response(data=data, message="获取成功")
    except Exception as e:
        logger.error(f"获取日志分级指标异常: {str(e)}", exc_info=True)
        return error_response(
            message="获取日志分级指标失败",
            code=status.HTTP_500_INTERNAL_SERVER_ERROR
        )


@router.post(
    "/alerts/check",
    summary="检查并发送告警",
    description="按阈值检查 SLO 并可选发送 webhook 告警",
)
async def check_alerts(
    send_webhook: bool = Query(default=True, description="是否发送告警 webhook"),
    api_window_seconds: int = Query(default=900, ge=60, le=86400),
    job_window_minutes: int = Query(default=60, ge=5, le=10080),
    current_user: AdminUser = Depends(require_admin_permission("monitor:read", resource="monitor")),
    db: Session = Depends(get_db),
):
    try:
        data = monitor_service.check_and_send_alerts(
            db,
            send_webhook=send_webhook,
            api_window_seconds=api_window_seconds,
            job_window_minutes=job_window_minutes,
        )
        return success_response(data=data, message="检查完成")
    except Exception as e:
        logger.error(f"告警检查异常: {str(e)}", exc_info=True)
        return error_response(
            message="告警检查失败",
            code=status.HTTP_500_INTERNAL_SERVER_ERROR
        )


@router.get(
    "/health/simple",
    summary="简单健康检查",
    description="快速健康检查，无需认证"
)
async def simple_health_check():
    """
    简单健康检查
    
    无需认证，用于负载均衡器等
    """
    return success_response(
        data={"status": "healthy"},
        message="服务正常"
    )
