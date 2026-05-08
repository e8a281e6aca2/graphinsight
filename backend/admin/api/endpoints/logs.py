"""
日志 API 端点
"""
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session
from datetime import datetime
from typing import Optional

from ...database import get_db
from ...models import AdminUser
from ...schemas.logs import LogQuery
from ...services import log_service
from ..deps import get_current_user, require_admin_permission
from core import (
    success_response,
    error_response,
    paginated_response,
    BusinessException,
    NotFoundException,
    get_logger,
)

logger = get_logger()
router = APIRouter(
    prefix="/admin/logs",
    tags=["日志管理"],
    dependencies=[Depends(require_admin_permission("logs:read", resource="audit_log"))],
)


@router.get(
    "",
    summary="获取日志列表",
    description="分页查询日志列表，支持多条件过滤"
)
async def get_log_list(
    user_id: int = Query(None, description="用户ID"),
    action: str = Query(None, description="操作类型"),
    resource: str = Query(None, description="资源类型"),
    status_filter: str = Query(None, alias="status", description="状态"),
    trace_id: str = Query(None, description="追踪ID"),
    start_date: datetime = Query(None, description="开始时间"),
    end_date: datetime = Query(None, description="结束时间"),
    ip_address: str = Query(None, description="IP地址"),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(20, ge=1, le=100, description="每页大小"),
    current_user: AdminUser = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    获取日志列表
    
    支持分页和多条件过滤
    """
    try:
        query = LogQuery(
            user_id=user_id,
            action=action,
            resource=resource,
            status=status_filter,
            trace_id=trace_id,
            start_date=start_date,
            end_date=end_date,
            ip_address=ip_address,
            page=page,
            page_size=page_size
        )
        
        items, total = log_service.get_log_list(db, query)
        
        return paginated_response(
            items=[item.model_dump() for item in items],
            total=total,
            page=page,
            page_size=page_size,
            message="获取成功"
        )
        
    except Exception as e:
        logger.error(f"获取日志列表异常: {str(e)}", exc_info=True)
        return error_response(
            message="获取日志列表失败",
            code=status.HTTP_500_INTERNAL_SERVER_ERROR
        )


@router.get(
    "/{log_id}",
    summary="获取日志详情",
    description="根据ID获取日志详情"
)
async def get_log_detail(
    log_id: int,
    current_user: AdminUser = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    获取日志详情
    """
    try:
        log = log_service.get_log_by_id(db, log_id)
        
        return success_response(
            data=log.model_dump(),
            message="获取成功"
        )
        
    except NotFoundException as e:
        return error_response(
            message=e.message,
            code=e.status_code,
            error_code=e.error_code,
            error_type="NotFoundError"
        )
    except Exception as e:
        logger.error(f"获取日志详情异常: {str(e)}", exc_info=True)
        return error_response(
            message="获取日志详情失败",
            code=status.HTTP_500_INTERNAL_SERVER_ERROR
        )


@router.get(
    "/stats/summary",
    summary="获取日志统计",
    description="获取日志统计信息"
)
async def get_log_stats(
    start_date: datetime = Query(None, description="开始时间"),
    end_date: datetime = Query(None, description="结束时间"),
    current_user: AdminUser = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    获取日志统计
    
    包括总数、成功率、操作分布等
    """
    try:
        stats = log_service.get_log_stats(db, start_date, end_date)
        
        return success_response(
            data=stats.model_dump(),
            message="获取成功"
        )
        
    except BusinessException as e:
        return error_response(
            message=e.message,
            code=e.status_code,
            error_code=e.error_code,
            error_type="BusinessError"
        )
    except Exception as e:
        logger.error(f"获取日志统计异常: {str(e)}", exc_info=True)
        return error_response(
            message="获取日志统计失败",
            code=status.HTTP_500_INTERNAL_SERVER_ERROR
        )


@router.get(
    "/recent/list",
    summary="获取最近日志",
    description="获取最近的日志记录"
)
async def get_recent_logs(
    limit: int = Query(10, ge=1, le=100, description="数量限制"),
    action: str = Query(None, description="操作类型"),
    current_user: AdminUser = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    获取最近日志
    """
    try:
        logs = log_service.get_recent_logs(db, limit, action)
        
        return success_response(
            data=[log.model_dump() for log in logs],
            message="获取成功"
        )
        
    except Exception as e:
        logger.error(f"获取最近日志异常: {str(e)}", exc_info=True)
        return error_response(
            message="获取最近日志失败",
            code=status.HTTP_500_INTERNAL_SERVER_ERROR
        )


@router.delete(
    "/clean",
    summary="清理旧日志",
    description="删除指定天数之前的日志",
    dependencies=[Depends(require_admin_permission("logs:clean", resource="audit_log"))],
)
async def clean_old_logs(
    days: int = Query(90, ge=1, le=365, description="保留天数"),
    current_user: AdminUser = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    清理旧日志
    
    删除指定天数之前的日志记录
    """
    try:
        deleted_count = log_service.clean_old_logs(db, days)
        
        return success_response(
            data={"deleted_count": deleted_count, "days": days},
            message=f"清理完成，删除了 {deleted_count} 条日志"
        )
        
    except BusinessException as e:
        return error_response(
            message=e.message,
            code=e.status_code,
            error_code=e.error_code,
            error_type="BusinessError"
        )
    except Exception as e:
        logger.error(f"清理日志异常: {str(e)}", exc_info=True)
        return error_response(
            message="清理日志失败",
            code=status.HTTP_500_INTERNAL_SERVER_ERROR
        )
