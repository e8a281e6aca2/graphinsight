#!/usr/bin/env python3
"""
添加 is_encrypted 字段到 admin_configs 表
"""
import sys
import os

# 添加项目根目录到路径
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from admin.database import engine
from sqlalchemy import text

def migrate():
    """执行迁移"""
    print("开始迁移: 添加缺失的字段...")
    
    with engine.connect() as conn:
        try:
            # 添加 is_encrypted 字段
            result = conn.execute(text("""
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name='admin_configs' AND column_name='is_encrypted'
            """))
            
            if not result.fetchone():
                conn.execute(text("""
                    ALTER TABLE admin_configs 
                    ADD COLUMN is_encrypted BOOLEAN DEFAULT FALSE
                """))
                conn.commit()
                print("  成功添加 is_encrypted 字段")
            else:
                print("  字段 is_encrypted 已存在")
            
            # 添加 version 字段
            result = conn.execute(text("""
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name='admin_configs' AND column_name='version'
            """))
            
            if not result.fetchone():
                conn.execute(text("""
                    ALTER TABLE admin_configs 
                    ADD COLUMN version INTEGER DEFAULT 1
                """))
                conn.commit()
                print("  成功添加 version 字段")
            else:
                print("  字段 version 已存在")
            
        except Exception as e:
            print(f"  迁移失败: {e}")
            conn.rollback()
            raise

if __name__ == "__main__":
    migrate()
    print("\n迁移完成!")
