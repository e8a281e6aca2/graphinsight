"""
AdminLog 审计字段迁移脚本

新增字段：
1. operator_id
2. tenant_id
3. trace_id
"""
from __future__ import annotations

from sqlalchemy import inspect, text

from admin.database import engine


def _column_exists(column_name: str) -> bool:
    inspector = inspect(engine)
    columns = inspector.get_columns("admin_logs")
    return any(col.get("name") == column_name for col in columns)


def migrate() -> None:
    statements: list[str] = []
    if not _column_exists("operator_id"):
        statements.append("ALTER TABLE admin_logs ADD COLUMN operator_id INTEGER")
    if not _column_exists("tenant_id"):
        statements.append("ALTER TABLE admin_logs ADD COLUMN tenant_id VARCHAR(100)")
    if not _column_exists("trace_id"):
        statements.append("ALTER TABLE admin_logs ADD COLUMN trace_id VARCHAR(100)")

    if not statements:
        print("✓ admin_logs 审计字段已存在，无需迁移")
        return

    with engine.begin() as conn:
        for stmt in statements:
            conn.execute(text(stmt))
            print(f"✓ 已执行: {stmt}")

        # 索引创建（幂等）
        try:
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_admin_logs_operator_id ON admin_logs (operator_id)"))
        except Exception:
            pass
        try:
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_admin_logs_tenant_id ON admin_logs (tenant_id)"))
        except Exception:
            pass
        try:
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_admin_logs_trace_id ON admin_logs (trace_id)"))
        except Exception:
            pass

    print("✓ AdminLog 审计字段迁移完成")


if __name__ == "__main__":
    migrate()
