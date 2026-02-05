"""
数据库迁移脚本：添加 login_count 字段
"""
import os
import sys
from pathlib import Path

# 添加项目根目录到 Python 路径
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

from sqlalchemy import text
from admin.database import engine, SessionLocal
from dotenv import load_dotenv, find_dotenv

# 加载环境变量
load_dotenv(find_dotenv(), override=True)


def check_column_exists(table_name: str, column_name: str) -> bool:
    """检查列是否存在"""
    with engine.connect() as conn:
        # PostgreSQL 查询
        query = text("""
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = :table_name 
            AND column_name = :column_name
        """)
        result = conn.execute(query, {"table_name": table_name, "column_name": column_name})
        return result.fetchone() is not None


def add_login_count_column():
    """添加 login_count 列"""
    print("开始数据库迁移...")
    
    try:
        # 检查列是否已存在
        if check_column_exists("admin_users", "login_count"):
            print("✓ login_count 列已存在，无需迁移")
            return True
        
        print("添加 login_count 列...")
        with engine.connect() as conn:
            # 添加列，默认值为 0
            conn.execute(text("""
                ALTER TABLE admin_users 
                ADD COLUMN login_count INTEGER DEFAULT 0
            """))
            conn.commit()
            print("✓ 成功添加 login_count 列")
        
        # 更新现有记录
        print("更新现有用户记录...")
        with engine.connect() as conn:
            conn.execute(text("""
                UPDATE admin_users 
                SET login_count = 0 
                WHERE login_count IS NULL
            """))
            conn.commit()
            print("✓ 成功更新现有记录")
        
        print("\n✓ 数据库迁移完成!")
        return True
        
    except Exception as e:
        print(f"\n✗ 迁移失败: {str(e)}")
        return False


def verify_migration():
    """验证迁移结果"""
    print("\n验证迁移结果...")
    
    try:
        with engine.connect() as conn:
            # 查询表结构
            result = conn.execute(text("""
                SELECT column_name, data_type, column_default
                FROM information_schema.columns
                WHERE table_name = 'admin_users'
                ORDER BY ordinal_position
            """))
            
            print("\nadmin_users 表结构:")
            print("-" * 60)
            for row in result:
                print(f"  {row[0]:<20} {row[1]:<15} {row[2] or ''}")
            print("-" * 60)
            
            # 查询用户数据
            result = conn.execute(text("""
                SELECT id, username, login_count
                FROM admin_users
                LIMIT 5
            """))
            
            print("\n用户数据示例:")
            print("-" * 60)
            rows = result.fetchall()
            if rows:
                for row in rows:
                    print(f"  ID: {row[0]}, 用户名: {row[1]}, 登录次数: {row[2]}")
            else:
                print("  (暂无用户数据)")
            print("-" * 60)
            
        return True
        
    except Exception as e:
        print(f"\n✗ 验证失败: {str(e)}")
        return False


if __name__ == "__main__":
    print("=" * 60)
    print("数据库迁移工具 - 添加 login_count 字段")
    print("=" * 60)
    print()
    
    # 显示数据库连接信息
    db_url = os.getenv("ADMIN_DATABASE_URL", "未配置")
    # 隐藏密码
    if "@" in db_url:
        parts = db_url.split("@")
        user_part = parts[0].split("://")[1].split(":")[0]
        db_url_display = f"postgresql://{user_part}:****@{parts[1]}"
    else:
        db_url_display = db_url
    
    print(f"数据库: {db_url_display}")
    print()
    
    # 执行迁移
    if add_login_count_column():
        verify_migration()
        print("\n✓ 所有操作完成!")
        sys.exit(0)
    else:
        print("\n✗ 迁移失败，请检查错误信息")
        sys.exit(1)
