"""
认证 API 端点
"""
from fastapi import APIRouter, Depends, Request, status
from sqlalchemy.orm import Session

from ...database import get_db
from ...models import AdminUser
from ...schemas.auth import (
    LoginRequest,
    LoginResponse,
    UserInfo,
    ChangePasswordRequest,
    RegisterRequest,
    RegisterResponse,
)
from ...services import auth_service, authz_service
from ..deps import get_current_user, get_client_ip, get_user_agent, resolve_request_scope
from core import (
    success_response,
    error_response,
    AuthenticationException,
    ValidationException,
    get_logger,
)

logger = get_logger()
router = APIRouter(prefix="/admin/auth", tags=["认证"])


@router.post(
    "/login",
    summary="用户登录",
    description="使用邮箱和密码登录，返回 JWT Token"
)
async def login(
    login_request: LoginRequest,
    request: Request,
    db: Session = Depends(get_db)
):
    """
    用户登录 - 使用邮箱登录
    
    - **username**: 邮箱地址（字段名保持为 username 以兼容）
    - **password**: 密码（最少6字符）
    
    返回 JWT Token 和用户信息
    """
    try:
        # 获取客户端信息
        ip_address = get_client_ip(request)
        user_agent = get_user_agent(request)
        
        # 执行登录
        response, success = auth_service.login(
            db=db,
            login_request=login_request,
            ip_address=ip_address,
            user_agent=user_agent,
            tenant_id=resolve_request_scope(request).get("tenant_id"),
            trace_id=getattr(request.state, "trace_id", None),
        )
        
        if success:
            return success_response(
                data=response.model_dump(),
                message="登录成功"
            )
        else:
            return error_response(
                message="登录失败",
                code=status.HTTP_401_UNAUTHORIZED
            )
            
    except AuthenticationException as e:
        logger.warning(f"登录失败: {e.message}")
        return error_response(
            message=e.message,
            code=e.status_code,
            error_code=e.error_code,
            error_type="AuthenticationError"
        )
    except ValidationException as e:
        return error_response(
            message=e.message,
            code=e.status_code,
            error_code=e.error_code,
            error_type="ValidationError",
            details=e.details
        )
    except Exception as e:
        logger.error(f"登录异常: {str(e)}", exc_info=True)
        return error_response(
            message="登录失败，请稍后重试",
            code=status.HTTP_500_INTERNAL_SERVER_ERROR
        )


@router.post(
    "/logout",
    summary="用户登出",
    description="登出当前用户"
)
async def logout(
    request: Request,
    current_user: AdminUser = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    用户登出
    
    需要认证
    """
    try:
        ip_address = get_client_ip(request)
        user_agent = get_user_agent(request)
        
        auth_service.logout(
            db=db,
            user=current_user,
            ip_address=ip_address,
            user_agent=user_agent,
            tenant_id=resolve_request_scope(request).get("tenant_id"),
            trace_id=getattr(request.state, "trace_id", None),
        )
        
        return success_response(message="登出成功")
        
    except Exception as e:
        logger.error(f"登出异常: {str(e)}", exc_info=True)
        return error_response(
            message="登出失败",
            code=status.HTTP_500_INTERNAL_SERVER_ERROR
        )


@router.get(
    "/profile",
    summary="获取用户信息",
    description="获取当前登录用户的信息"
)
async def get_profile(
    current_user: AdminUser = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    获取用户信息
    
    需要认证
    """
    try:
        user_info = auth_service.get_user_info(db, current_user)
        
        return success_response(
            data=user_info.model_dump(),
            message="获取成功"
        )
        
    except Exception as e:
        logger.error(f"获取用户信息异常: {str(e)}", exc_info=True)
        return error_response(
            message="获取用户信息失败",
            code=status.HTTP_500_INTERNAL_SERVER_ERROR
        )


@router.post(
    "/register",
    summary="用户注册",
    description="使用邮箱注册新用户，注册后自动成为管理员"
)
async def register(
    register_request: RegisterRequest,
    request: Request,
    db: Session = Depends(get_db)
):
    """
    用户注册 - 使用邮箱注册
    
    - **email**: 邮箱（必填，用作登录账号）
    - **password**: 密码（最少8字符，必须包含字母和数字）
    
    注册后自动成为管理员，可以直接使用邮箱登录
    """
    try:
        # 获取客户端信息
        ip_address = get_client_ip(request)
        user_agent = get_user_agent(request)
        
        # 执行注册
        response = auth_service.register(
            db=db,
            register_request=register_request,
            ip_address=ip_address,
            user_agent=user_agent,
            tenant_id=resolve_request_scope(request).get("tenant_id"),
            trace_id=getattr(request.state, "trace_id", None),
        )
        
        return success_response(
            data=response.model_dump(),
            message="注册成功，请登录"
        )
        
    except ValidationException as e:
        logger.warning(f"注册失败: {e.message}")
        return error_response(
            message=e.message,
            code=e.status_code,
            error_code=e.error_code,
            error_type="ValidationError",
            details=e.details
        )
    except Exception as e:
        logger.error(f"注册异常: {str(e)}", exc_info=True)
        return error_response(
            message="注册失败，请稍后重试",
            code=status.HTTP_500_INTERNAL_SERVER_ERROR
        )


@router.post(
    "/change-password",
    summary="修改密码",
    description="修改当前用户的密码"
)
async def change_password(
    change_request: ChangePasswordRequest,
    request: Request,
    current_user: AdminUser = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    修改密码
    
    - **old_password**: 旧密码
    - **new_password**: 新密码（最少8字符，必须包含字母和数字）
    
    需要认证
    """
    try:
        ip_address = get_client_ip(request)
        
        success = auth_service.change_password(
            db=db,
            user=current_user,
            change_request=change_request,
            ip_address=ip_address,
            tenant_id=resolve_request_scope(request).get("tenant_id"),
            trace_id=getattr(request.state, "trace_id", None),
        )
        
        if success:
            return success_response(message="密码修改成功")
        else:
            return error_response(
                message="密码修改失败",
                code=status.HTTP_400_BAD_REQUEST
            )
            
    except AuthenticationException as e:
        return error_response(
            message=e.message,
            code=e.status_code,
            error_code=e.error_code,
            error_type="AuthenticationError"
        )
    except ValidationException as e:
        return error_response(
            message=e.message,
            code=e.status_code,
            error_code=e.error_code,
            error_type="ValidationError",
            details=e.details
        )
    except Exception as e:
        logger.error(f"修改密码异常: {str(e)}", exc_info=True)
        return error_response(
            message="修改密码失败",
            code=status.HTTP_500_INTERNAL_SERVER_ERROR
        )


@router.get(
    "/authorize",
    summary="授权校验",
    description="用于网关侧进行业务权限检查（携带当前用户 Token）",
)
async def authorize(
    permission: str,
    request: Request,
    current_user: AdminUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    授权校验（给 Go 网关调用）
    """
    try:
        scope = resolve_request_scope(request)
        allowed, reason, matched = authz_service.check_permission(
            db,
            user_id=current_user.id,
            permission_code=permission,
            request_scope=scope,
        )
        return success_response(
            data={
                "allowed": allowed,
                "reason": reason,
                "permission": permission,
                "scope": scope,
                "binding": matched,
                "user": {
                    "id": current_user.id,
                    "username": current_user.username,
                    "email": current_user.email,
                },
            },
            message="ok",
        )
    except Exception as e:
        logger.error(f"授权校验异常: {str(e)}", exc_info=True)
        return error_response(
            message="授权服务不可用",
            code=status.HTTP_503_SERVICE_UNAVAILABLE
        )
