"""
RBAC 管理 API
"""
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from ...database import get_db
from ...models import AdminUser
from ...schemas.rbac import BindingCreateRequest
from ...services import rbac_service
from ..deps import require_admin_permission
from core import (
    success_response,
    error_response,
    BusinessException,
    NotFoundException,
    ValidationException,
    get_logger,
)

logger = get_logger()

router = APIRouter(
    prefix="/admin/rbac",
    tags=["权限管理"],
    dependencies=[Depends(require_admin_permission("user:manage", resource="rbac"))],
)


@router.get(
    "/roles",
    summary="获取角色列表",
)
async def list_roles(db: Session = Depends(get_db)):
    try:
        roles = rbac_service.list_roles(db)
        return success_response(data=[item.model_dump() for item in roles], message="ok")
    except BusinessException as exc:
        return error_response(message=exc.message, code=exc.status_code, error_code=exc.error_code)
    except Exception as exc:
        logger.error(f"获取角色列表异常: {exc}", exc_info=True)
        return error_response(message="获取角色列表失败", code=status.HTTP_500_INTERNAL_SERVER_ERROR)


@router.get(
    "/permissions",
    summary="获取权限列表",
)
async def list_permissions(db: Session = Depends(get_db)):
    try:
        permissions = rbac_service.list_permissions(db)
        return success_response(data=[item.model_dump() for item in permissions], message="ok")
    except BusinessException as exc:
        return error_response(message=exc.message, code=exc.status_code, error_code=exc.error_code)
    except Exception as exc:
        logger.error(f"获取权限列表异常: {exc}", exc_info=True)
        return error_response(message="获取权限列表失败", code=status.HTTP_500_INTERNAL_SERVER_ERROR)


@router.get(
    "/bindings",
    summary="获取用户角色绑定",
)
async def list_bindings(
    user_id: int | None = Query(None, description="用户 ID"),
    db: Session = Depends(get_db),
):
    try:
        bindings = rbac_service.list_bindings(db, user_id=user_id)
        return success_response(data=[item.model_dump() for item in bindings], message="ok")
    except BusinessException as exc:
        return error_response(message=exc.message, code=exc.status_code, error_code=exc.error_code)
    except Exception as exc:
        logger.error(f"获取绑定列表异常: {exc}", exc_info=True)
        return error_response(message="获取绑定列表失败", code=status.HTTP_500_INTERNAL_SERVER_ERROR)


@router.post(
    "/bindings",
    summary="创建用户角色绑定",
)
async def create_binding(
    payload: BindingCreateRequest,
    current_user: AdminUser = Depends(require_admin_permission("user:manage", resource="rbac")),
    db: Session = Depends(get_db),
):
    try:
        binding = rbac_service.create_binding(db, payload, operator_id=current_user.id)
        return success_response(data=binding.model_dump(), message="绑定成功")
    except (NotFoundException, ValidationException, BusinessException) as exc:
        return error_response(message=exc.message, code=exc.status_code, error_code=exc.error_code)
    except Exception as exc:
        logger.error(f"创建绑定异常: {exc}", exc_info=True)
        return error_response(message="创建绑定失败", code=status.HTTP_500_INTERNAL_SERVER_ERROR)


@router.delete(
    "/bindings/{binding_id}",
    summary="删除用户角色绑定",
)
async def delete_binding(
    binding_id: int,
    current_user: AdminUser = Depends(require_admin_permission("user:manage", resource="rbac")),
    db: Session = Depends(get_db),
):
    try:
        rbac_service.delete_binding(db, binding_id, operator_id=current_user.id)
        return success_response(message="删除成功")
    except NotFoundException as exc:
        return error_response(message=exc.message, code=exc.status_code, error_code=exc.error_code)
    except BusinessException as exc:
        return error_response(message=exc.message, code=exc.status_code, error_code=exc.error_code)
    except Exception as exc:
        logger.error(f"删除绑定异常: {exc}", exc_info=True)
        return error_response(message="删除绑定失败", code=status.HTTP_500_INTERNAL_SERVER_ERROR)
