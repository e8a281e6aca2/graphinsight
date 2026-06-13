package httpserver

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"graphinsight/go-backend/internal/authz"
	"graphinsight/go-backend/internal/config"
)

type businessPermissionGuard struct {
	cfg        config.Config
	logger     *slog.Logger
	adminStore adminPermissionStore
}

type adminPermissionStore interface {
	CheckPermission(ctx context.Context, subject string, permission string, scope map[string]string) (authz.CheckResult, error)
}

type adminNativeStore interface {
	adminPermissionStore
	adminConfigStore
	adminRbacBindingStore
	adminUserStore
	adminProfileStore
	adminProfileStatsStore
}

func newBusinessPermissionGuard(cfg config.Config, logger *slog.Logger, adminStoreOpt ...adminPermissionStore) businessPermissionGuard {
	var adminStore adminPermissionStore
	if len(adminStoreOpt) > 0 {
		adminStore = adminStoreOpt[0]
	}
	return businessPermissionGuard{
		cfg:        cfg,
		logger:     logger,
		adminStore: adminStore,
	}
}

func (g businessPermissionGuard) wrap(permission string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !g.allowRequest(w, r, permission) {
			return
		}
		next.ServeHTTP(w, r)
	}
}

func (g businessPermissionGuard) allowRequest(w http.ResponseWriter, r *http.Request, permission string) bool {
	token, hasToken := extractBearerToken(r.Header.Get("Authorization"))
	if !hasToken {
		if g.cfg.RBACEnforceBusinessAPI {
			w.Header().Set("WWW-Authenticate", "Bearer")
			WriteJSON(w, http.StatusUnauthorized, "缺少认证凭证", map[string]interface{}{
				"error_code": "UNAUTHORIZED",
			})
			return false
		}
		return true
	}

	if isLocalJWTSoftMode(g.cfg.RBACAuthzMode) {
		return g.allowLocalJWTSoftRequest(w, r, token, permission)
	}
	if strings.EqualFold(strings.TrimSpace(g.cfg.RBACAuthzMode), "go_db") {
		return g.allowGoDBRequest(w, r, token, permission)
	}
	return g.allowGoDBRequest(w, r, token, permission)
}

func (g businessPermissionGuard) propagateAuthzResult(r *http.Request, permission string, result authz.CheckResult) {
	r.Header.Set("x-authz-permission", permission)
	r.Header.Set("x-authz-reason", result.Reason)
	if result.UserID > 0 {
		r.Header.Set("x-auth-user-id", strconv.Itoa(result.UserID))
	}
	if result.User != "" {
		r.Header.Set("x-auth-user-name", result.User)
	}
	if result.Email != "" {
		r.Header.Set("x-auth-user-email", result.Email)
	}
}

func isLocalJWTSoftMode(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "local_jwt_soft", "local_jwt":
		return true
	default:
		return false
	}
}

func (g businessPermissionGuard) allowGoDBRequest(w http.ResponseWriter, r *http.Request, token string, permission string) bool {
	claims, err := newAdminJWTVerifier(g.cfg.AdminSecretKey).verify(token)
	if err != nil {
		w.Header().Set("WWW-Authenticate", "Bearer")
		errorCode := "INVALID_TOKEN"
		if errors.Is(err, errAdminJWTExpired) {
			errorCode = "TOKEN_EXPIRED"
		}
		WriteJSON(w, http.StatusUnauthorized, "Token 已过期或无效", map[string]interface{}{
			"error_code": errorCode,
		})
		return false
	}
	if g.adminStore == nil {
		if g.cfg.RBACEnforceBusinessAPI {
			g.logger.Error("admin store unavailable in go_db authz mode", "permission", permission)
			WriteJSON(w, http.StatusServiceUnavailable, "授权服务不可用", map[string]interface{}{
				"error_code": "AUTHZ_UNAVAILABLE",
			})
			return false
		}
		g.logger.Warn("admin store unavailable, soft allow", "permission", permission)
		g.propagateLocalJWTContext(r, claims, permission, "go_db_store_unavailable_soft_allow")
		return true
	}

	result, err := g.adminStore.CheckPermission(r.Context(), claims.Subject, permission, resolveScopeHeaders(r))
	if err != nil {
		if errors.Is(err, authz.ErrUnauthorized) {
			w.Header().Set("WWW-Authenticate", "Bearer")
			WriteJSON(w, http.StatusUnauthorized, "Token 已过期或无效", map[string]interface{}{
				"error_code": "INVALID_TOKEN",
			})
			return false
		}
		if g.cfg.RBACEnforceBusinessAPI {
			g.logger.Error("go_db authz check failed", "permission", permission, "error", err.Error())
			WriteJSON(w, http.StatusServiceUnavailable, "授权服务不可用", map[string]interface{}{
				"error_code": "AUTHZ_UNAVAILABLE",
			})
			return false
		}
		g.logger.Warn("go_db authz check failed, soft allow", "permission", permission, "error", err.Error())
		g.propagateLocalJWTContext(r, claims, permission, "go_db_error_soft_allow")
		return true
	}
	if !result.Allowed {
		if g.cfg.RBACEnforceBusinessAPI {
			WriteJSON(w, http.StatusForbidden, "权限不足", map[string]interface{}{
				"error_code": "PERMISSION_DENIED",
				"reason":     result.Reason,
			})
			return false
		}
		g.logger.Warn("go_db authz denied, soft allow", "permission", permission, "reason", result.Reason)
	}

	g.propagateAuthzResult(r, permission, result)
	return true
}

func (g businessPermissionGuard) allowLocalJWTSoftRequest(w http.ResponseWriter, r *http.Request, token string, permission string) bool {
	claims, err := newAdminJWTVerifier(g.cfg.AdminSecretKey).verify(token)
	if err != nil {
		w.Header().Set("WWW-Authenticate", "Bearer")
		message := "Token 已过期或无效"
		errorCode := "INVALID_TOKEN"
		if errors.Is(err, errAdminJWTExpired) {
			errorCode = "TOKEN_EXPIRED"
		}
		WriteJSON(w, http.StatusUnauthorized, message, map[string]interface{}{
			"error_code": errorCode,
		})
		return false
	}

	g.propagateLocalJWTContext(r, claims, permission, "local_jwt_soft_allow")
	return true
}

func (g businessPermissionGuard) propagateLocalJWTContext(r *http.Request, claims adminJWTClaims, permission string, reason string) {
	r.Header.Set("x-authz-permission", permission)
	r.Header.Set("x-authz-reason", reason)
	r.Header.Set("x-auth-user-name", claims.Subject)
	if strings.Contains(claims.Subject, "@") {
		r.Header.Set("x-auth-user-email", claims.Subject)
	}
}

func extractBearerToken(value string) (string, bool) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "", false
	}
	parts := strings.SplitN(trimmed, " ", 2)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
		return "", false
	}
	token := strings.TrimSpace(parts[1])
	if token == "" {
		return "", false
	}
	return token, true
}

func resolveScopeHeaders(r *http.Request) map[string]string {
	tenantID := strings.TrimSpace(r.Header.Get("x-tenant-id"))
	if tenantID == "" {
		tenantID = strings.TrimSpace(r.URL.Query().Get("tenant_id"))
	}
	projectID := strings.TrimSpace(r.Header.Get("x-project-id"))
	if projectID == "" {
		projectID = strings.TrimSpace(r.URL.Query().Get("project_id"))
	}
	kbID := strings.TrimSpace(r.Header.Get("x-kb-id"))
	if kbID == "" {
		kbID = strings.TrimSpace(r.URL.Query().Get("kb_id"))
	}
	return map[string]string{
		"x-tenant-id":  tenantID,
		"x-project-id": projectID,
		"x-kb-id":      kbID,
	}
}
