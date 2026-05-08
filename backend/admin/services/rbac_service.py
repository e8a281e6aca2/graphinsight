"""
RBAC 服务
"""
from __future__ import annotations

from typing import List, Optional

from sqlalchemy.orm import Session

from ..crud import log_crud
from ..models import (
    AdminPermission,
    AdminRole,
    AdminUser,
    AdminUserRoleBinding,
)
from ..schemas.rbac import BindingCreateRequest, BindingItem, PermissionItem, RoleItem
from ..schemas.logs import LogCreate
from ..services.authz_service import authz_service
from core import BusinessException, NotFoundException, ValidationException, get_logger

logger = get_logger()


class RbacService:
    def _write_rbac_audit(
        self,
        db: Session,
        *,
        operator_id: Optional[int],
        action: str,
        resource_id: str,
        details: dict,
        status_value: str = "success",
        error_message: Optional[str] = None,
    ) -> None:
        try:
            log_crud.create(
                db,
                LogCreate(
                    user_id=operator_id,
                    operator_id=operator_id,
                    action=action,
                    resource="rbac_binding",
                    resource_id=resource_id,
                    details=details,
                    status=status_value,
                    error_message=error_message,
                ),
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("写入 RBAC 审计日志失败", context={"action": action, "error": str(exc)})

    def list_roles(self, db: Session) -> List[RoleItem]:
        try:
            authz_service.ensure_seed_data(db)
            roles = db.query(AdminRole).order_by(AdminRole.name.asc()).all()
            return [RoleItem.model_validate(role) for role in roles]
        except Exception as exc:
            logger.error(f"获取角色列表失败: {exc}", exc_info=True)
            raise BusinessException("获取角色列表失败")

    def list_permissions(self, db: Session) -> List[PermissionItem]:
        try:
            authz_service.ensure_seed_data(db)
            permissions = db.query(AdminPermission).order_by(AdminPermission.code.asc()).all()
            return [PermissionItem.model_validate(item) for item in permissions]
        except Exception as exc:
            logger.error(f"获取权限列表失败: {exc}", exc_info=True)
            raise BusinessException("获取权限列表失败")

    def list_bindings(self, db: Session, user_id: Optional[int] = None) -> List[BindingItem]:
        try:
            query = (
                db.query(AdminUserRoleBinding, AdminRole, AdminUser)
                .join(AdminRole, AdminRole.id == AdminUserRoleBinding.role_id)
                .join(AdminUser, AdminUser.id == AdminUserRoleBinding.user_id)
            )
            if user_id:
                query = query.filter(AdminUserRoleBinding.user_id == user_id)

            rows = query.order_by(AdminUserRoleBinding.created_at.desc()).all()
            items: List[BindingItem] = []
            for binding, role, user in rows:
                items.append(
                    BindingItem(
                        id=binding.id,
                        user_id=binding.user_id,
                        username=user.username,
                        email=user.email,
                        role_id=binding.role_id,
                        role_name=role.name,
                        scope_type=binding.scope_type,
                        tenant_id=binding.tenant_id,
                        project_id=binding.project_id,
                        kb_id=binding.kb_id,
                        expires_at=binding.expires_at,
                        created_by=binding.created_by,
                        created_at=binding.created_at,
                    )
                )
            return items
        except Exception as exc:
            logger.error(f"获取绑定列表失败: {exc}", exc_info=True)
            raise BusinessException("获取绑定列表失败")

    def create_binding(
        self,
        db: Session,
        payload: BindingCreateRequest,
        operator_id: Optional[int] = None,
    ) -> BindingItem:
        try:
            authz_service.ensure_seed_data(db)

            user = db.query(AdminUser).filter(AdminUser.id == payload.user_id).first()
            if not user:
                raise NotFoundException("用户不存在")

            role = db.query(AdminRole).filter(AdminRole.name == payload.role_name).first()
            if not role:
                raise NotFoundException("角色不存在")

            existing = (
                db.query(AdminUserRoleBinding)
                .filter(
                    AdminUserRoleBinding.user_id == payload.user_id,
                    AdminUserRoleBinding.role_id == role.id,
                    AdminUserRoleBinding.scope_type == payload.scope_type,
                    AdminUserRoleBinding.tenant_id == payload.tenant_id,
                    AdminUserRoleBinding.project_id == payload.project_id,
                    AdminUserRoleBinding.kb_id == payload.kb_id,
                )
                .first()
            )
            if existing:
                return BindingItem(
                    id=existing.id,
                    user_id=existing.user_id,
                    username=user.username,
                    email=user.email,
                    role_id=role.id,
                    role_name=role.name,
                    scope_type=existing.scope_type,
                    tenant_id=existing.tenant_id,
                    project_id=existing.project_id,
                    kb_id=existing.kb_id,
                    expires_at=existing.expires_at,
                    created_by=existing.created_by,
                    created_at=existing.created_at,
                )

            binding = AdminUserRoleBinding(
                user_id=payload.user_id,
                role_id=role.id,
                scope_type=payload.scope_type,
                tenant_id=payload.tenant_id,
                project_id=payload.project_id,
                kb_id=payload.kb_id,
                expires_at=payload.expires_at,
                created_by=operator_id,
            )
            db.add(binding)
            db.commit()
            db.refresh(binding)
            authz_service.invalidate_user_cache(payload.user_id)
            self._write_rbac_audit(
                db,
                operator_id=operator_id,
                action="rbac_binding_create",
                resource_id=str(binding.id),
                details={
                    "user_id": binding.user_id,
                    "role_name": role.name,
                    "scope_type": binding.scope_type,
                    "tenant_id": binding.tenant_id,
                    "project_id": binding.project_id,
                    "kb_id": binding.kb_id,
                    "expires_at": binding.expires_at.isoformat() if binding.expires_at else None,
                },
            )

            return BindingItem(
                id=binding.id,
                user_id=binding.user_id,
                username=user.username,
                email=user.email,
                role_id=role.id,
                role_name=role.name,
                scope_type=binding.scope_type,
                tenant_id=binding.tenant_id,
                project_id=binding.project_id,
                kb_id=binding.kb_id,
                expires_at=binding.expires_at,
                created_by=binding.created_by,
                created_at=binding.created_at,
            )
        except (NotFoundException, ValidationException):
            raise
        except Exception as exc:
            logger.error(f"创建绑定失败: {exc}", exc_info=True)
            raise BusinessException("创建绑定失败")

    def delete_binding(self, db: Session, binding_id: int, *, operator_id: Optional[int] = None) -> bool:
        try:
            binding = db.query(AdminUserRoleBinding).filter(AdminUserRoleBinding.id == binding_id).first()
            if not binding:
                raise NotFoundException("绑定不存在")

            user_id = binding.user_id
            details = {
                "user_id": binding.user_id,
                "role_id": binding.role_id,
                "scope_type": binding.scope_type,
                "tenant_id": binding.tenant_id,
                "project_id": binding.project_id,
                "kb_id": binding.kb_id,
            }
            db.delete(binding)
            db.commit()
            authz_service.invalidate_user_cache(user_id)
            self._write_rbac_audit(
                db,
                operator_id=operator_id,
                action="rbac_binding_delete",
                resource_id=str(binding_id),
                details=details,
            )
            return True
        except NotFoundException:
            raise
        except Exception as exc:
            logger.error(f"删除绑定失败: {exc}", exc_info=True)
            raise BusinessException("删除绑定失败")


rbac_service = RbacService()
