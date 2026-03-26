"""
检查 admin_logs 表
"""
import sys
from pathlib import Path

backend_dir = Path(__file__).parent
sys.path.insert(0, str(backend_dir))

from sqlalchemy import text
from admin.database import engine

def check_logs_table():
    """检查日志表"""
    print("=" * 60)
    print("检查 admin_logs 表")
    print("=" * 60)
    
    try:
        with engine.connect() as conn:
            # 检查表是否存在
            result = conn.execute(text("""
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_name = 'admin_logs'
                )
            """))
            exists = result.fetchone()[0]
            
            if not exists:
                print("\n✗ admin_logs 表不存在!")
                return False
            
            print("\n✓ admin_logs 表存在")
            
            # 查看表结构
            result = conn.execute(text("""
                SELECT column_name, data_type, is_nullable, column_default
                FROM information_schema.columns
                WHERE table_name = 'admin_logs'
                ORDER BY ordinal_position
            """))
            
            print("\n表结构:")
            print("-" * 80)
            print(f"{'字段名':<20} {'类型':<25} {'可空':<10} {'默认值':<20}")
            print("-" * 80)
            
            for row in result:
                print(f"{row[0]:<20} {row[1]:<25} {row[2]:<10} {str(row[3] or ''):<20}")
            
            print("-" * 80)
            
            # 尝试插入测试数据
            print("\n测试插入数据...")
            try:
                conn.execute(text("""
                    INSERT INTO admin_logs (
                        action, resource, details, ip_address, status
                    ) VALUES (
                        'test', 'test', 'test', '127.0.0.1', 'success'
                    )
                """))
                conn.commit()
                print("✓ 插入测试数据成功")
                
                # 删除测试数据
                conn.execute(text("""
                    DELETE FROM admin_logs WHERE action = 'test'
                """))
                conn.commit()
                print("✓ 删除测试数据成功")
                
            except Exception as e:
                print(f"✗ 插入测试数据失败: {str(e)}")
                return False
            
            return True
            
    except Exception as e:
        print(f"\n✗ 检查失败: {str(e)}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == "__main__":
    success = check_logs_table()
    
    print("\n" + "=" * 60)
    if success:
        print("✓ admin_logs 表正常")
    else:
        print("✗ admin_logs 表有问题")
    print("=" * 60)
