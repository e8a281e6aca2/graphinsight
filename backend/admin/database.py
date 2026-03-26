"""
管理系统数据库连接
"""
import os
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv, find_dotenv

# 自动查找并加载 .env 文件
load_dotenv(find_dotenv(), override=True)

# PostgreSQL 连接配置
# 从环境变量读取，如果没有则使用默认值
ADMIN_DATABASE_URL = os.getenv(
    "ADMIN_DATABASE_URL",
    "postgresql://user:password@localhost:5432/graphinsight_admin"
)

# 创建数据库引擎
engine = create_engine(ADMIN_DATABASE_URL, pool_pre_ping=True)

# 创建会话工厂
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# 创建基类
Base = declarative_base()


def get_db():
    """获取数据库会话"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """初始化数据库表"""
    Base.metadata.create_all(bind=engine)
