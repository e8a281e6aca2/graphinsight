"""
监控 API 端点
"""
from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from ...database import get_db
from ...models import AdminUser
from ...services import monitor_service
from ..deps import get_current_user
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
    current_user: AdminUser = Depends(get_current_user)
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
    current_user: AdminUser = Depends(get_current_user),
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
