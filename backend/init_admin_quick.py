"""
快速初始化管理员用户
"""
from admin.database import SessionLocal, engine, Base
from admin.models import AdminUser
from admin.auth import get_password_hash

# 创建表
Base.metadata.create_all(bind=engine)

# 创建管理员用户
db = SessionLocal()
try:
    # 检查是否已存在
    existing = db.query(AdminUser).filter(AdminUser.username == "admin").first()
    if existing:
        print("管理员用户已存在")
    else:
        admin_user = AdminUser(
            username="admin",
            email="admin@example.com",
            hashed_password=get_password_hash("admin123"),
            is_active=True
        )
        db.add(admin_user)
        db.commit()
        print("管理员用户创建成功")
        print("   用户名: admin")
        print("   密码: admin123")
finally:
    db.close()
