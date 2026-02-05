"""
认证路由
"""
from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from ..database import get_db
from ..models import AdminUser, AdminLog
from ..schemas import UserLogin, Token, UserResponse
from ..auth import authenticate_user, create_access_token, get_current_user

router = APIRouter(prefix="/admin/auth", tags=["admin-auth"])


@router.post("/login", response_model=Token)
async def login(
    user_login: UserLogin,
    request: Request,
    db: Session = Depends(get_db)
):
    """用户登录"""
    user = authenticate_user(db, user_login.username, user_login.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户名或密码错误"
        )
    
    # 更新最后登录时间
    user.last_login = datetime.utcnow()
    db.commit()
    
    # 记录登录日志
    log = AdminLog(
        user_id=user.id,
        action="login",
        resource="auth",
        details="用户登录",
        ip_address=request.client.host if request.client else None
    )
    db.add(log)
    db.commit()
    
    # 生成 Token
    access_token = create_access_token(
        data={"sub": user.username},
        expires_delta=timedelta(hours=24)
    )
    
    return {"access_token": access_token, "token_type": "bearer"}


@router.post("/logout")
async def logout(
    request: Request,
    current_user: AdminUser = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """用户登出"""
    # 记录登出日志
    log = AdminLog(
        user_id=current_user.id,
        action="logout",
        resource="auth",
        details="用户登出",
        ip_address=request.client.host if request.client else None
    )
    db.add(log)
    db.commit()
    
    return {"message": "登出成功"}


@router.get("/me", response_model=UserResponse)
async def get_current_user_info(
    current_user: AdminUser = Depends(get_current_user)
):
    """获取当前用户信息"""
    return current_user
