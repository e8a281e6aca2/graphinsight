package httpserver

import (
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"graphinsight/go-backend/internal/authz"
	"graphinsight/go-backend/internal/config"
)

type businessPermissionGuard struct {
	cfg          config.Config
	logger       *slog.Logger
	authzClient  *authz.Client
	authzInitErr error
}

func newBusinessPermissionGuard(cfg config.Config, logger *slog.Logger, authzClient *authz.Client, authzInitErr error) businessPermissionGuard {
	return businessPermissionGuard{
		cfg:          cfg,
		logger:       logger,
		authzClient:  authzClient,
		authzInitErr: authzInitErr,
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

	if g.authzClient == nil {
		if g.cfg.RBACEnforceBusinessAPI {
			g.logger.Error("authz check unavailable in enforce mode", "permission", permission, "error", g.authzInitErr)
			WriteJSON(w, http.StatusServiceUnavailable, "授权服务不可用", map[string]interface{}{
				"error_code": "AUTHZ_UNAVAILABLE",
			})
			return false
		}
		g.logger.Warn("authz client unavailable, soft allow", "permission", permission, "error", g.authzInitErr)
		return true
	}

	scopeHeaders := resolveScopeHeaders(r)
	result, err := g.authzClient.CheckPermission(r.Context(), token, permission, scopeHeaders)
	if err != nil {
		if errors.Is(err, authz.ErrUnauthorized) {
			w.Header().Set("WWW-Authenticate", "Bearer")
			WriteJSON(w, http.StatusUnauthorized, "Token 已过期或无效", map[string]interface{}{
				"error_code": "INVALID_TOKEN",
			})
			return false
		}
		if errors.Is(err, authz.ErrForbidden) {
			if g.cfg.RBACEnforceBusinessAPI {
				WriteJSON(w, http.StatusForbidden, "权限不足", map[string]interface{}{
					"error_code": "PERMISSION_DENIED",
				})
				return false
			}
			g.logger.Warn("authz denied, soft allow", "permission", permission)
			return true
		}

		if g.cfg.RBACEnforceBusinessAPI {
			g.logger.Error("authz check failed", "permission", permission, "error", err.Error())
			WriteJSON(w, http.StatusServiceUnavailable, "授权服务不可用", map[string]interface{}{
				"error_code": "AUTHZ_UNAVAILABLE",
			})
			return false
		}

		g.logger.Warn("authz check failed, soft allow", "permission", permission, "error", err.Error())
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
		g.logger.Warn("authz result denied, soft allow", "permission", permission, "reason", result.Reason)
	}

	// Propagate resolved auth context to upstream orchestrated handlers for auditing.
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
	return true
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
