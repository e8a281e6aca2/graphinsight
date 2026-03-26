"""
API 依赖项
提供通用的依赖注入
"""
from typing import Optional
from fastapi import Depends, HTTPException, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import AdminUser
from ..services import auth_service
from core import AuthenticationException, get_logger

logger = get_logger()
security = HTTPBearer()


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
) -> AdminUser:
    """
    获取当前登录用户
    
    依赖项，用于需要认证的端点
    """
    try:
        # 验证 Token
        token = credentials.credentials
        token_data = auth_service.verify_token(token)
        
        # 获取用户 - Token中存储的是邮箱
        from ..crud import user_crud
        # 先尝试用邮箱查找
        user = user_crud.get_by_email(db, token_data.username)
        
        # 如果找不到,再尝试用用户名查找(兼容旧Token)
        if not user:
            user = user_crud.get_by_username(db, token_data.username)
        
        if not user:
            raise AuthenticationException("用户不存在")
        
        if not user.is_active:
            raise AuthenticationException("用户已被禁用")
        
        return user
        
    except AuthenticationException as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=e.message,
            headers={"WWW-Authenticate": "Bearer"},
        )
    except Exception as e:
        logger.error(f"认证失败: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="认证失败",
            headers={"WWW-Authenticate": "Bearer"},
        )


def get_client_ip(request: Request) -> Optional[str]:
    """获取客户端 IP 地址"""
    if request.client:
        return request.client.host
    return None


def get_user_agent(request: Request) -> Optional[str]:
    """获取 User Agent"""
    return request.headers.get("user-agent")
