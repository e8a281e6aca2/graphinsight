"""
用户管理 API
"""
import csv
import io
from datetime import datetime

from fastapi import APIRouter, Depends, Query, Request, status
from fastapi.responses import Response
from sqlalchemy.orm import Session

from ...database import get_db
from ...models import AdminUser
from ...schemas.users import (
    BatchResetPasswordRequest,
    BatchDeleteRequest,
    BatchStatusUpdateRequest,
    UserCreateRequest,
    UserPasswordResetRequest,
    UserResponse,
    UserUpdateRequest,
)
from ...crud import log_crud, user_crud
from ...schemas.logs import LogCreate
from ..deps import get_client_ip, get_current_user, get_user_agent, require_admin_permission
from core import error_response, get_logger, get_password_hash, paginated_response, success_response

logger = get_logger()

router = APIRouter(
    prefix="/admin/users",
    tags=["用户管理"],
    dependencies=[Depends(require_admin_permission("user:manage", resource="user"))],
)


def _write_user_audit_log(
    db: Session,
    request: Request,
    current_user: AdminUser,
    action: str,
    resource_id: str | None = None,
    details: dict | None = None,
    status_value: str = "success",
    error_message: str | None = None,
) -> None:
    """用户管理操作审计日志，不影响主流程"""
    try:
        log_crud.create(
            db,
            LogCreate(
                user_id=current_user.id,
                operator_id=current_user.id,
                tenant_id=request.headers.get("x-tenant-id"),
                trace_id=getattr(request.state, "trace_id", None),
                action=action,
                resource="user",
                resource_id=resource_id,
                details=details,
                ip_address=get_client_ip(request),
                user_agent=get_user_agent(request),
                status=status_value,
                error_message=error_message,
            ),
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning(f"写入用户审计日志失败: {exc}")


@router.get(
    "",
    summary="获取用户列表",
)
async def list_users(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    search: str | None = Query(None),
    is_active: bool | None = Query(None),
    department: str | None = Query(None),
    order_by: str = Query("created_at"),
    order_desc: bool = Query(True),
    db: Session = Depends(get_db),
):
    try:
        skip = (page - 1) * page_size
        users, total = user_crud.get_multi(
            db,
            skip=skip,
            limit=page_size,
            search=search,
            is_active=is_active,
            department=department,
            order_by=order_by,
            order_desc=order_desc,
        )
        items = [UserResponse.model_validate(user).model_dump() for user in users]
        return paginated_response(items=items, total=total, page=page, page_size=page_size, message="ok")
    except Exception as exc:
        logger.error(f"获取用户列表异常: {exc}", exc_info=True)
        return error_response(message="获取用户列表失败", code=status.HTTP_500_INTERNAL_SERVER_ERROR)


@router.get(
    "/export-csv",
    summary="导出用户 CSV",
)
async def export_users_csv(
    request: Request,
    search: str | None = Query(None),
    is_active: bool | None = Query(None),
    department: str | None = Query(None),
    order_by: str = Query("created_at"),
    order_desc: bool = Query(True),
    db: Session = Depends(get_db),
    current_user: AdminUser = Depends(get_current_user),
):
    try:
        users, _ = user_crud.get_multi(
            db,
            skip=0,
            limit=100000,
            search=search,
            is_active=is_active,
            department=department,
            order_by=order_by,
            order_desc=order_desc,
        )

        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow([
            "id",
            "username",
            "email",
            "full_name",
            "phone",
            "department",
            "is_active",
            "last_login",
            "last_login_ip",
            "login_count",
            "created_at",
            "updated_at",
        ])
        for user in users:
            writer.writerow([
                user.id,
                user.username,
                user.email or "",
                user.full_name or "",
                user.phone or "",
                user.department or "",
                "true" if user.is_active else "false",
                user.last_login.isoformat() if user.last_login else "",
                user.last_login_ip or "",
                user.login_count or 0,
                user.created_at.isoformat() if user.created_at else "",
                user.updated_at.isoformat() if user.updated_at else "",
            ])

        _write_user_audit_log(
            db=db,
            request=request,
            current_user=current_user,
            action="user_export_csv",
            details={
                "rows": len(users),
                "search": search,
                "is_active": is_active,
                "department": department,
            },
        )

        filename = f"users_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.csv"
        return Response(
            content="\ufeff" + output.getvalue(),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except Exception as exc:
        logger.error(f"导出用户 CSV 异常: {exc}", exc_info=True)
        return error_response(message="导出失败", code=status.HTTP_500_INTERNAL_SERVER_ERROR)


@router.post(
    "",
    summary="创建用户",
)
async def create_user(
    payload: UserCreateRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: AdminUser = Depends(get_current_user),
):
    try:
        existing = user_crud.get_by_username(db, payload.username)
        if existing:
            return error_response(message="用户名已存在", code=status.HTTP_400_BAD_REQUEST)

        existing_email = user_crud.get_by_email(db, payload.email)
        if existing_email:
            return error_response(message="邮箱已存在", code=status.HTTP_400_BAD_REQUEST)

        user = user_crud.create(
            db,
            username=payload.username.strip(),
            email=payload.email.strip().lower(),
            password_hash=get_password_hash(payload.password),
            full_name=payload.full_name,
            phone=payload.phone,
            department=payload.department,
            is_active=True,
        )
        _write_user_audit_log(
            db=db,
            request=request,
            current_user=current_user,
            action="user_create",
            resource_id=str(user.id),
            details={"target_username": user.username, "target_email": user.email},
        )
        logger.info("创建用户", context={"operator": current_user.username, "target_user_id": user.id})
        return success_response(data=UserResponse.model_validate(user).model_dump(), message="创建成功")
    except ValueError as exc:
        return error_response(message=str(exc), code=status.HTTP_400_BAD_REQUEST)
    except Exception as exc:
        logger.error(f"创建用户异常: {exc}", exc_info=True)
        return error_response(message="创建用户失败", code=status.HTTP_500_INTERNAL_SERVER_ERROR)


@router.put(
    "/{user_id}",
    summary="更新用户",
)
async def update_user(
    user_id: int,
    payload: UserUpdateRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: AdminUser = Depends(get_current_user),
):
    try:
        user = user_crud.get_by_id(db, user_id)
        if not user:
            return error_response(message="用户不存在", code=status.HTTP_404_NOT_FOUND)

        if payload.is_active is False and current_user.id == user_id:
            return error_response(message="不能禁用当前登录账号", code=status.HTTP_400_BAD_REQUEST)

        if payload.email and payload.email != user.email:
            existing = user_crud.get_by_email(db, payload.email)
            if existing and existing.id != user_id:
                return error_response(message="邮箱已存在", code=status.HTTP_400_BAD_REQUEST)

        update_data = payload.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(user, field, value)

        db.commit()
        db.refresh(user)
        _write_user_audit_log(
            db=db,
            request=request,
            current_user=current_user,
            action="user_update",
            resource_id=str(user.id),
            details={"updated_fields": list(update_data.keys())},
        )
        logger.info("更新用户", context={"operator": current_user.username, "target_user_id": user.id})
        return success_response(data=UserResponse.model_validate(user).model_dump(), message="更新成功")
    except Exception as exc:
        logger.error(f"更新用户异常: {exc}", exc_info=True)
        return error_response(message="更新用户失败", code=status.HTTP_500_INTERNAL_SERVER_ERROR)


@router.post(
    "/{user_id}/toggle-status",
    summary="切换用户启用状态",
)
async def toggle_user_status(
    user_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: AdminUser = Depends(get_current_user),
):
    try:
        if current_user.id == user_id:
            return error_response(message="不能停用当前登录账号", code=status.HTTP_400_BAD_REQUEST)

        user = user_crud.toggle_status(db, user_id)
        if not user:
            return error_response(message="用户不存在", code=status.HTTP_404_NOT_FOUND)

        _write_user_audit_log(
            db=db,
            request=request,
            current_user=current_user,
            action="user_toggle_status",
            resource_id=str(user.id),
            details={"is_active": user.is_active},
        )
        logger.info("切换用户状态", context={"operator": current_user.username, "target_user_id": user.id, "is_active": user.is_active})
        return success_response(data=UserResponse.model_validate(user).model_dump(), message="状态已更新")
    except Exception as exc:
        logger.error(f"切换用户状态异常: {exc}", exc_info=True)
        return error_response(message="切换状态失败", code=status.HTTP_500_INTERNAL_SERVER_ERROR)


@router.post(
    "/{user_id}/reset-password",
    summary="重置用户密码",
)
async def reset_user_password(
    user_id: int,
    payload: UserPasswordResetRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: AdminUser = Depends(get_current_user),
):
    try:
        user = user_crud.reset_password(db, user_id=user_id, new_password=payload.new_password)
        if not user:
            return error_response(message="用户不存在", code=status.HTTP_404_NOT_FOUND)

        _write_user_audit_log(
            db=db,
            request=request,
            current_user=current_user,
            action="user_reset_password",
            resource_id=str(user.id),
            details={"target_username": user.username},
        )
        logger.info("重置用户密码", context={"operator": current_user.username, "target_user_id": user.id})
        return success_response(message="密码重置成功")
    except Exception as exc:
        logger.error(f"重置用户密码异常: {exc}", exc_info=True)
        return error_response(message="重置密码失败", code=status.HTTP_500_INTERNAL_SERVER_ERROR)


@router.delete(
    "/{user_id}",
    summary="删除用户",
)
async def delete_user(
    user_id: int,
    request: Request,
    soft_delete: bool = Query(True),
    db: Session = Depends(get_db),
    current_user: AdminUser = Depends(get_current_user),
):
    try:
        if current_user.id == user_id:
            return error_response(message="不能删除当前登录账号", code=status.HTTP_400_BAD_REQUEST)

        deleted = user_crud.delete(db, user_id=user_id, soft_delete=soft_delete)
        if not deleted:
            return error_response(message="用户不存在", code=status.HTTP_404_NOT_FOUND)

        _write_user_audit_log(
            db=db,
            request=request,
            current_user=current_user,
            action="user_delete",
            resource_id=str(user_id),
            details={"soft_delete": soft_delete},
        )
        logger.info("删除用户", context={"operator": current_user.username, "target_user_id": user_id, "soft_delete": soft_delete})
        return success_response(message="删除成功")
    except Exception as exc:
        logger.error(f"删除用户异常: {exc}", exc_info=True)
        return error_response(message="删除用户失败", code=status.HTTP_500_INTERNAL_SERVER_ERROR)


@router.post(
    "/batch-reset-password",
    summary="批量重置密码",
)
async def batch_reset_users_password(
    payload: BatchResetPasswordRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: AdminUser = Depends(get_current_user),
):
    try:
        result = user_crud.batch_reset_password(
            db=db,
            user_ids=payload.user_ids,
            new_password=payload.new_password,
            exclude_user_id=current_user.id,
        )
        _write_user_audit_log(
            db=db,
            request=request,
            current_user=current_user,
            action="user_batch_reset_password",
            details={
                "reset_ids": result.get("reset_ids", []),
                "not_found_ids": result.get("not_found_ids", []),
                "skipped_self_ids": result.get("skipped_self_ids", []),
            },
        )
        return success_response(
            data={
                "reset_count": len(result.get("reset_ids", [])),
                "reset_ids": result.get("reset_ids", []),
                "not_found_ids": result.get("not_found_ids", []),
                "skipped_self_ids": result.get("skipped_self_ids", []),
            },
            message="批量重置密码完成",
        )
    except Exception as exc:
        logger.error(f"批量重置密码异常: {exc}", exc_info=True)
        return error_response(message="批量重置密码失败", code=status.HTTP_500_INTERNAL_SERVER_ERROR)


@router.post(
    "/batch-status",
    summary="批量更新用户状态",
)
async def batch_update_user_status(
    payload: BatchStatusUpdateRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: AdminUser = Depends(get_current_user),
):
    try:
        result = user_crud.batch_update_status(
            db=db,
            user_ids=payload.user_ids,
            is_active=payload.is_active,
            exclude_user_id=current_user.id,
        )
        _write_user_audit_log(
            db=db,
            request=request,
            current_user=current_user,
            action="user_batch_status",
            details={
                "is_active": payload.is_active,
                "updated_ids": result.get("updated_ids", []),
                "not_found_ids": result.get("not_found_ids", []),
                "skipped_self_ids": result.get("skipped_self_ids", []),
            },
        )
        return success_response(
            data={
                "updated_count": len(result.get("updated_ids", [])),
                "updated_ids": result.get("updated_ids", []),
                "not_found_ids": result.get("not_found_ids", []),
                "skipped_self_ids": result.get("skipped_self_ids", []),
            },
            message="批量状态更新完成",
        )
    except Exception as exc:
        logger.error(f"批量更新用户状态异常: {exc}", exc_info=True)
        return error_response(message="批量状态更新失败", code=status.HTTP_500_INTERNAL_SERVER_ERROR)


@router.post(
    "/batch-delete",
    summary="批量删除用户",
)
async def batch_delete_users(
    payload: BatchDeleteRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: AdminUser = Depends(get_current_user),
):
    try:
        result = user_crud.batch_delete_users(
            db=db,
            user_ids=payload.user_ids,
            soft_delete=payload.soft_delete,
            exclude_user_id=current_user.id,
        )
        _write_user_audit_log(
            db=db,
            request=request,
            current_user=current_user,
            action="user_batch_delete",
            details={
                "soft_delete": payload.soft_delete,
                "deleted_ids": result.get("deleted_ids", []),
                "not_found_ids": result.get("not_found_ids", []),
                "skipped_self_ids": result.get("skipped_self_ids", []),
            },
        )
        return success_response(
            data={
                "deleted_count": len(result.get("deleted_ids", [])),
                "deleted_ids": result.get("deleted_ids", []),
                "not_found_ids": result.get("not_found_ids", []),
                "skipped_self_ids": result.get("skipped_self_ids", []),
            },
            message="批量删除完成",
        )
    except Exception as exc:
        logger.error(f"批量删除用户异常: {exc}", exc_info=True)
        return error_response(message="批量删除失败", code=status.HTTP_500_INTERNAL_SERVER_ERROR)
