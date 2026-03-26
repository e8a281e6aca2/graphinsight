"""
日志管理路由
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import AdminUser, AdminLog
from ..schemas import LogListResponse, LogResponse
from ..auth import get_current_user

router = APIRouter(prefix="/admin/logs", tags=["admin-logs"])


@router.get("", response_model=LogListResponse)
async def get_logs(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user: AdminUser = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取日志列表"""
    # 计算偏移量
    offset = (page - 1) * limit
    
    # 查询日志
    logs = db.query(AdminLog).order_by(
        AdminLog.created_at.desc()
    ).offset(offset).limit(limit).all()
    
    # 总数
    total = db.query(AdminLog).count()
    
    return LogListResponse(
        logs=[LogResponse.model_validate(log) for log in logs],
        total=total,
        page=page,
        limit=limit
    )


@router.get("/{log_id}", response_model=LogResponse)
async def get_log_detail(
    log_id: int,
    current_user: AdminUser = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取日志详情"""
    log = db.query(AdminLog).filter(AdminLog.id == log_id).first()
    if not log:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="日志不存在")
    
    return LogResponse.model_validate(log)
