package httpserver

import (
	"context"
	"log/slog"
	"net/http"

	"graphinsight/go-backend/internal/adminstore"
)

type adminRbacCatalogStore interface {
	ListRbacRoles(ctx context.Context) ([]adminstore.RbacRole, error)
	ListRbacPermissions(ctx context.Context) ([]adminstore.RbacPermission, error)
}

func asRbacCatalogStore(store interface{}) adminRbacCatalogStore {
	typed, _ := store.(adminRbacCatalogStore)
	return typed
}

func buildAdminRbacCatalogNativeHandler(logger *slog.Logger, guard businessPermissionGuard, catalogStore adminRbacCatalogStore) http.HandlerFunc {
	return withRouteOwner("go-native", guard.wrap("user:manage", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			WriteJSON(w, http.StatusMethodNotAllowed, "Method not allowed", nil)
			return
		}
		if catalogStore == nil {
			logger.Error("admin rbac catalog store unavailable")
			WriteJSON(w, http.StatusServiceUnavailable, "RBAC 数据服务不可用", map[string]string{"error_code": "ADMIN_STORE_UNAVAILABLE"})
			return
		}

		switch r.URL.Path {
		case "/api/v1/admin/rbac/roles":
			roles, err := catalogStore.ListRbacRoles(r.Context())
			if err != nil {
				logger.Error("list rbac roles failed", "error", err.Error())
				WriteJSON(w, http.StatusServiceUnavailable, "获取角色列表失败", map[string]string{"error_code": "ADMIN_STORE_UNAVAILABLE"})
				return
			}
			WriteJSON(w, http.StatusOK, "ok", roles)
		case "/api/v1/admin/rbac/permissions":
			permissions, err := catalogStore.ListRbacPermissions(r.Context())
			if err != nil {
				logger.Error("list rbac permissions failed", "error", err.Error())
				WriteJSON(w, http.StatusServiceUnavailable, "获取权限列表失败", map[string]string{"error_code": "ADMIN_STORE_UNAVAILABLE"})
				return
			}
			WriteJSON(w, http.StatusOK, "ok", permissions)
		default:
			WriteJSON(w, http.StatusNotFound, "资源不存在", map[string]string{"error_code": "NOT_FOUND"})
		}
	}))
}
