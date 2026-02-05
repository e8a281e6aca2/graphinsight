"""
个人设置 API 端点
"""
from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from ...database import get_db
from ...models import AdminUser
from ...schemas.users import (
    ProfileResponse,
    ProfileUpdateRequest,
    UserPasswordUpdate,
)
from ...crud import user_crud
from ..deps import get_current_user
from core import (
    success_response,
    ValidationException,
    AuthenticationException,
    get_logger,
)
from core.security import get_password_hash, verify_password

logger = get_logger()

router = APIRouter(prefix="/admin/profile", tags=["个人设置"])


@router.get("")
async def get_profile(
    current_user: AdminUser = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    获取个人信息
    """
    try:
        # 刷新用户数据
        user = user_crud.get_by_id(db, current_user.id)
        if not user:
            raise AuthenticationException("用户不存在")
        
        logger.info(
            f"获取个人信息: {user.username}",
            context={"user_id": user.id}
        )
        
        return success_response(
            data=ProfileResponse.model_validate(user),
            message="获取个人信息成功"
        )
    except Exception as e:
        logger.error(f"获取个人信息失败: {str(e)}", exc_info=True)
        raise


@router.put("")
async def update_profile(
    profile_update: ProfileUpdateRequest,
    current_user: AdminUser = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    更新个人信息
    """
    try:
        # 更新用户信息
        update_data = profile_update.dict(exclude_unset=True)
        
        for field, value in update_data.items():
            setattr(current_user, field, value)
        
        db.commit()
        db.refresh(current_user)
        
        logger.info(
            f"更新个人信息: {current_user.username}",
            context={"user_id": current_user.id, "fields": list(update_data.keys())}
        )
        
        return success_response(
            data=ProfileResponse.model_validate(current_user),
            message="个人信息更新成功"
        )
    except Exception as e:
        logger.error(f"更新个人信息失败: {str(e)}", exc_info=True)
        db.rollback()
        raise ValidationException("更新个人信息失败")


@router.put("/password")
async def change_password(
    password_update: UserPasswordUpdate,
    request: Request,
    current_user: AdminUser = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    修改密码
    """
    try:
        # 验证旧密码
        if not verify_password(password_update.old_password, current_user.password_hash):
            raise AuthenticationException("旧密码错误")
        
        # 更新密码
        new_password_hash = get_password_hash(password_update.new_password)
        current_user.password_hash = new_password_hash
        
        db.commit()
        
        logger.info(
            f"修改密码成功: {current_user.username}",
            context={
                "user_id": current_user.id,
                "ip_address": request.client.host if request.client else None
            }
        )
        
        return success_response(message="密码修改成功，请重新登录")
    except AuthenticationException:
        raise
    except Exception as e:
        logger.error(f"修改密码失败: {str(e)}", exc_info=True)
        db.rollback()
        raise ValidationException("修改密码失败")


@router.get("/stats")
async def get_profile_stats(
    current_user: AdminUser = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    获取个人统计信息
    """
    try:
        from ...models import AdminLog
        from datetime import datetime, timedelta
        
        # 获取最近30天的登录次数
        thirty_days_ago = datetime.utcnow() - timedelta(days=30)
        recent_logins = db.query(AdminLog).filter(
            AdminLog.user_id == current_user.id,
            AdminLog.action == "login",
            AdminLog.created_at >= thirty_days_ago
        ).count()
        
        # 获取总操作次数
        total_operations = db.query(AdminLog).filter(
            AdminLog.user_id == current_user.id
        ).count()
        
        stats = {
            "total_logins": current_user.login_count or 0,
            "recent_logins_30d": recent_logins,
            "total_operations": total_operations,
            "last_login": current_user.last_login,
            "last_login_ip": current_user.last_login_ip,
            "account_created": current_user.created_at,
        }
        
        return success_response(data=stats, message="获取统计信息成功")
    except Exception as e:
        logger.error(f"获取统计信息失败: {str(e)}", exc_info=True)
        raise ValidationException("获取统计信息失败")
