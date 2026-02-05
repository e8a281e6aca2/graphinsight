"""
管理系统 Pydantic 模型
"""
from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import datetime


# 用户相关
class UserLogin(BaseModel):
    username: str
    password: str


class UserResponse(BaseModel):
    id: int
    username: str
    email: Optional[str] = None
    is_active: bool
    created_at: datetime
    last_login: Optional[datetime] = None
    
    class Config:
        from_attributes = True


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class TokenData(BaseModel):
    username: Optional[str] = None


# 配置相关
class ConfigItem(BaseModel):
    category: str
    key: str
    value: str
    description: Optional[str] = None
    is_sensitive: bool = False


class ConfigUpdate(BaseModel):
    category: str
    key: str
    value: str


class ConfigResponse(BaseModel):
    id: int
    category: str
    key: str
    value: str
    description: Optional[str] = None
    is_sensitive: bool
    updated_at: datetime
    
    class Config:
        from_attributes = True


class ConfigTest(BaseModel):
    type: str  # "neo4j" or "openai"


# 监控相关
class ServiceStatus(BaseModel):
    status: str
    message: Optional[str] = None
    latency: Optional[float] = None


class MonitorStatus(BaseModel):
    neo4j: ServiceStatus
    openai: ServiceStatus
    backend: ServiceStatus


class MonitorStats(BaseModel):
    api_calls: int
    queries: int
    ai_generations: int


# 日志相关
class LogResponse(BaseModel):
    id: int
    user_id: Optional[int] = None
    action: str
    resource: Optional[str] = None
    details: Optional[str] = None
    ip_address: Optional[str] = None
    created_at: datetime
    
    class Config:
        from_attributes = True


class LogListResponse(BaseModel):
    logs: list[LogResponse]
    total: int
    page: int
    limit: int
