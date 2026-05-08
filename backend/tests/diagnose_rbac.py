"""
RBAC 诊断脚本

运行方式：
    python backend/tests/diagnose_rbac.py
"""
import sys
from pathlib import Path

# 添加 backend 到导入路径
backend_dir = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(backend_dir))

from admin.database import SessionLocal  # noqa: E402
from admin.models import (  # noqa: E402
    AdminPermission,
    AdminRole,
    AdminRolePermission,
    AdminUser,
    AdminUserRoleBinding,
)
from admin.services.authz_service import authz_service  # noqa: E402


def main() -> int:
    db = SessionLocal()
    try:
        authz_service.ensure_seed_data(db)

        role_count = db.query(AdminRole).count()
        permission_count = db.query(AdminPermission).count()
        role_permission_count = db.query(AdminRolePermission).count()
        binding_count = db.query(AdminUserRoleBinding).count()

        print("RBAC summary:")
        print(f"- roles: {role_count}")
        print(f"- permissions: {permission_count}")
        print(f"- role_permissions: {role_permission_count}")
        print(f"- bindings: {binding_count}")

        first_user = db.query(AdminUser).order_by(AdminUser.id.asc()).first()
        if not first_user:
            print("- first_user: none")
            return 0

        print(f"- first_user: id={first_user.id}, username={first_user.username}, email={first_user.email}")
        bindings = authz_service.get_user_permission_bindings(db, first_user.id)
        print(f"- first_user_permission_bindings: {len(bindings)}")
        for item in bindings[:20]:
            scope = item.get("scope_type")
            print(
                f"  * {item.get('permission_code')} "
                f"(role={item.get('role_name')}, scope={scope}, "
                f"tenant={item.get('tenant_id')}, project={item.get('project_id')}, kb={item.get('kb_id')})"
            )
        if len(bindings) > 20:
            print(f"  ... ({len(bindings) - 20} more)")
        return 0
    except Exception as exc:  # noqa: BLE001
        print(f"RBAC diagnose failed: {exc}")
        import traceback

        traceback.print_exc()
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
