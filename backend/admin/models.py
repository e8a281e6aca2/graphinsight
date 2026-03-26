"""
管理系统数据模型
"""
from sqlalchemy import Column, Integer, String, Boolean, Text, DateTime, ForeignKey
from sqlalchemy.sql import func
from .database import Base


class AdminUser(Base):
    """管理员用户表 - 所有注册用户都是管理员"""
    __tablename__ = "admin_users"
    
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    email = Column(String(100), unique=True, nullable=False, index=True)
    
    # 基础信息
    full_name = Column(String(100))
    avatar = Column(String(255))  # 头像URL
    phone = Column(String(20))
    department = Column(String(100))
    
    # 状态
    is_active = Column(Boolean, default=True)
    
    # 登录信息
    last_login = Column(DateTime(timezone=True))
    last_login_ip = Column(String(45))  # 支持IPv6
    login_count = Column(Integer, default=0)
    
    # 时间戳
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class AdminConfig(Base):
    """配置表"""
    __tablename__ = "admin_configs"
    
    id = Column(Integer, primary_key=True, index=True)
    category = Column(String(50), nullable=False, index=True)
    key = Column(String(100), nullable=False)
    value = Column(Text, nullable=False)
    description = Column(Text)
    is_sensitive = Column(Boolean, default=False)
    is_encrypted = Column(Boolean, default=False)  # 新增：是否加密
    updated_by = Column(Integer, ForeignKey("admin_users.id"))
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    version = Column(Integer, default=1)  # 新增：版本号
    
    # 添加唯一约束
    __table_args__ = (
        {'sqlite_autoincrement': True},
    )


class AdminLog(Base):
    """操作日志表"""
    __tablename__ = "admin_logs"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("admin_users.id"))
    action = Column(String(100), nullable=False, index=True)
    resource = Column(String(100), index=True)
    resource_id = Column(String(100))  # 新增：资源ID
    details = Column(Text)
    ip_address = Column(String(50))
    user_agent = Column(String(500))  # 新增：User Agent
    status = Column(String(20), default="success", index=True)  # 新增：状态
    error_message = Column(Text)  # 新增：错误信息
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
