"""
用户 CRUD 操作
"""
from sqlalchemy.orm import Session
from sqlalchemy import or_, func, desc, asc
from typing import Optional, List, Tuple
from datetime import datetime

from ..models import AdminUser
from ..schemas.auth import UserCreate, UserUpdate
from core.security import get_password_hash, verify_password
from core.logger import logger


class UserCRUD:
    """用户 CRUD 操作"""
    
    def get_by_id(self, db: Session, user_id: int) -> Optional[AdminUser]:
        """根据ID获取用户"""
        return db.query(AdminUser).filter(AdminUser.id == user_id).first()
    
    def get_by_username(self, db: Session, username: str) -> Optional[AdminUser]:
        """根据用户名获取用户"""
        return db.query(AdminUser).filter(AdminUser.username == username).first()
    
    def get_by_email(self, db: Session, email: str) -> Optional[AdminUser]:
        """根据邮箱获取用户"""
        return db.query(AdminUser).filter(AdminUser.email == email).first()
    
    def get_multi(
        self, 
        db: Session, 
        skip: int = 0, 
        limit: int = 100,
        search: str = None,
        is_active: bool = None,
        department: str = None,
        order_by: str = "created_at",
        order_desc: bool = True
    ) -> Tuple[List[AdminUser], int]:
        """获取用户列表（分页、搜索、过滤）"""
        # 基础查询
        query = db.query(AdminUser)
        
        # 搜索条件
        if search:
            search_filter = or_(
                AdminUser.username.ilike(f"%{search}%"),
                AdminUser.email.ilike(f"%{search}%"),
                AdminUser.full_name.ilike(f"%{search}%")
            )
            query = query.filter(search_filter)
        
        # 状态过滤
        if is_active is not None:
            query = query.filter(AdminUser.is_active == is_active)
        
        # 部门过滤
        if department:
            query = query.filter(AdminUser.department == department)
        
        # 总数统计
        total = query.count()
        
        # 排序
        if hasattr(AdminUser, order_by):
            order_column = getattr(AdminUser, order_by)
            if order_desc:
                query = query.order_by(desc(order_column))
            else:
                query = query.order_by(asc(order_column))
        
        # 分页
        users = query.offset(skip).limit(limit).all()
        
        return users, total
    
    def get_departments(self, db: Session) -> List[str]:
        """获取所有部门列表"""
        result = db.query(AdminUser.department).filter(
            AdminUser.department.isnot(None),
            AdminUser.department != ""
        ).distinct().all()
        return [dept[0] for dept in result if dept[0]]
    
    def create(self, db: Session, user_create: UserCreate) -> AdminUser:
        """创建用户 - 所有用户都是管理员"""
        # 检查用户名是否已存在
        if self.get_by_username(db, user_create.username):
            raise ValueError(f"用户名 {user_create.username} 已存在")
        
        # 检查邮箱是否已存在
        if user_create.email and self.get_by_email(db, user_create.email):
            raise ValueError(f"邮箱 {user_create.email} 已存在")
        
        # 创建用户数据
        user_data = {
            "username": user_create.username,
            "email": user_create.email,
            "password_hash": get_password_hash(user_create.password),
            "is_active": True
        }
        
        # 创建用户
        db_user = AdminUser(**user_data)
        db.add(db_user)
        db.commit()
        db.refresh(db_user)
        
        logger.info(f"创建用户成功: {user_create.username}")
        return db_user
    
    def update(self, db: Session, user_id: int, user_update: UserUpdate) -> Optional[AdminUser]:
        """更新用户"""
        db_user = self.get_by_id(db, user_id)
        if not db_user:
            return None
        
        # 更新字段
        update_data = user_update.dict(exclude_unset=True, exclude={"password"})
        
        # 如果更新密码，需要加密
        if hasattr(user_update, 'password') and user_update.password:
            update_data["password_hash"] = get_password_hash(user_update.password)
        
        # 更新时间戳
        update_data["updated_at"] = datetime.utcnow()
        
        for field, value in update_data.items():
            setattr(db_user, field, value)
        
        db.commit()
        db.refresh(db_user)
        
        logger.info(f"更新用户成功: {db_user.username}")
        return db_user
    
    def delete(self, db: Session, user_id: int, soft_delete: bool = True) -> bool:
        """删除用户（支持软删除）"""
        db_user = self.get_by_id(db, user_id)
        if not db_user:
            return False
        
        if soft_delete:
            # 软删除：设置为非活跃状态
            db_user.is_active = False
            db_user.updated_at = datetime.utcnow()
            db.commit()
            logger.info(f"软删除用户成功: {db_user.username}")
        else:
            # 硬删除：从数据库中删除
            username = db_user.username
            db.delete(db_user)
            db.commit()
            logger.info(f"硬删除用户成功: {username}")
        
        return True
    
    def batch_delete(self, db: Session, user_ids: List[int], soft_delete: bool = True) -> int:
        """批量删除用户"""
        count = 0
        for user_id in user_ids:
            if self.delete(db, user_id, soft_delete):
                count += 1
        return count
    
    def toggle_status(self, db: Session, user_id: int) -> Optional[AdminUser]:
        """切换用户状态"""
        db_user = self.get_by_id(db, user_id)
        if not db_user:
            return None
        
        db_user.is_active = not db_user.is_active
        db_user.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(db_user)
        
        status = "激活" if db_user.is_active else "禁用"
        logger.info(f"{status}用户成功: {db_user.username}")
        return db_user
    
    def authenticate(self, db: Session, username: str, password: str) -> Optional[AdminUser]:
        """用户认证"""
        user = self.get_by_username(db, username) or self.get_by_email(db, username)
        if not user:
            return None
        
        if not verify_password(password, user.password_hash):
            return None
        
        # 更新登录信息
        user.last_login = datetime.utcnow()
        user.login_count = (user.login_count or 0) + 1
        db.commit()
        
        return user
    
    def update_login_info(self, db: Session, user_id: int, ip_address: str = None):
        """更新登录信息"""
        user = self.get_by_id(db, user_id)
        if user:
            user.last_login = datetime.utcnow()
            user.login_count = (user.login_count or 0) + 1
            if ip_address:
                user.last_login_ip = ip_address
            db.commit()
    
    def update_last_login(self, db: Session, user_id: int):
        """更新最后登录时间（别名方法，用于兼容）"""
        self.update_login_info(db, user_id)
    
    def get_count(self, db: Session) -> int:
        """获取用户总数"""
        return db.query(func.count(AdminUser.id)).scalar()


# 创建全局实例
user_crud = UserCRUD()
