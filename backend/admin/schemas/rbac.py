"""
RBAC 相关 Pydantic 模型
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, field_validator, model_validator

ALLOWED_SCOPE_TYPES = {"global", "tenant", "project", "kb"}


class RoleItem(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    is_system: bool
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class PermissionItem(BaseModel):
    id: int
    code: str
    resource_type: str
    action: str
    description: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class BindingItem(BaseModel):
    id: int
    user_id: int
    username: Optional[str] = None
    email: Optional[str] = None
    role_id: int
    role_name: str
    scope_type: str
    tenant_id: Optional[str] = None
    project_id: Optional[str] = None
    kb_id: Optional[str] = None
    expires_at: Optional[datetime] = None
    created_by: Optional[int] = None
    created_at: datetime

    class Config:
        from_attributes = True


class BindingCreateRequest(BaseModel):
    user_id: int = Field(..., ge=1)
    role_name: str = Field(..., min_length=1)
    scope_type: str = Field(default="global")
    tenant_id: Optional[str] = None
    project_id: Optional[str] = None
    kb_id: Optional[str] = None
    expires_at: Optional[datetime] = None

    @field_validator("scope_type")
    @classmethod
    def validate_scope_type(cls, value: str) -> str:
        if value not in ALLOWED_SCOPE_TYPES:
            raise ValueError("scope_type 必须是 global/tenant/project/kb")
        return value

    @model_validator(mode="after")
    def validate_scope_fields(self):
        if self.scope_type == "tenant" and not self.tenant_id:
            raise ValueError("tenant 作用域需要 tenant_id")
        if self.scope_type == "project" and not self.project_id:
            raise ValueError("project 作用域需要 project_id")
        if self.scope_type == "kb" and not self.kb_id:
            raise ValueError("kb 作用域需要 kb_id")
        return self
