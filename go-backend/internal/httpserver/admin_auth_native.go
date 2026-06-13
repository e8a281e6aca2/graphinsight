package httpserver

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"graphinsight/go-backend/internal/adminstore"
	"graphinsight/go-backend/internal/authz"
	"graphinsight/go-backend/internal/config"
)

const adminAccessTokenTTL = 24 * time.Hour

type adminAuthStore interface {
	LoginAdminUser(ctx context.Context, req adminstore.UserLoginRequest) (adminstore.UserItem, error)
	RegisterAdminUser(ctx context.Context, req adminstore.UserRegisterRequest) (adminstore.UserItem, error)
	LogoutAdminUser(ctx context.Context, req adminstore.UserLogoutRequest) error
	ChangeProfilePasswordBySubject(ctx context.Context, req adminstore.ProfilePasswordChangeRequest) error
	CheckPermission(ctx context.Context, subject string, permission string, scope map[string]string) (authz.CheckResult, error)
}

func asAdminAuthStore(store interface{}) adminAuthStore {
	typed, _ := store.(adminAuthStore)
	return typed
}

type adminLoginPayload struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type adminLoginResponse struct {
	Token     string              `json:"token"`
	ExpiresIn int                 `json:"expires_in"`
	User      adminstore.UserItem `json:"user"`
}

type adminRegisterPayload struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type adminRegisterResponse struct {
	User    adminstore.UserItem `json:"user"`
	Message string              `json:"message"`
}

type adminAuthorizeResponse struct {
	Allowed    bool              `json:"allowed"`
	Reason     string            `json:"reason"`
	Permission string            `json:"permission"`
	Scope      map[string]string `json:"scope"`
	Binding    interface{}       `json:"binding"`
	User       struct {
		ID       int    `json:"id"`
		Username string `json:"username"`
		Email    string `json:"email"`
	} `json:"user"`
}

func buildAdminAuthLoginNativeHandler(logger *slog.Logger, cfg config.Config, authStore adminAuthStore) http.HandlerFunc {
	return withRouteOwner("go-native", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			WriteJSON(w, http.StatusMethodNotAllowed, "Method not allowed", nil)
			return
		}
		if authStore == nil {
			logger.Error("admin auth store unavailable")
			WriteJSON(w, http.StatusServiceUnavailable, "认证服务不可用", map[string]string{"error_code": "ADMIN_STORE_UNAVAILABLE"})
			return
		}
		var payload adminLoginPayload
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			WriteJSON(w, http.StatusBadRequest, "请求体错误", map[string]string{"error_code": "INVALID_BODY"})
			return
		}
		email := strings.ToLower(strings.TrimSpace(payload.Username))
		if !isValidAdminUserEmail(email) || len(payload.Password) < 6 || len(payload.Password) > 100 {
			WriteJSON(w, http.StatusBadRequest, "请输入有效的邮箱和密码", map[string]string{"error_code": "INVALID_BODY"})
			return
		}
		user, err := authStore.LoginAdminUser(r.Context(), adminstore.UserLoginRequest{
			Email:     email,
			Password:  payload.Password,
			TenantID:  optionalStringHeader(r, "x-scope-tenant-id"),
			TraceID:   optionalStringHeader(r, traceHeader),
			IPAddress: optionalString(firstRemoteAddr(r)),
			UserAgent: optionalString(r.UserAgent()),
		})
		if errors.Is(err, adminstore.ErrUserInvalidCredentials) {
			WriteJSON(w, http.StatusUnauthorized, "邮箱或密码错误", map[string]string{"error_code": "INVALID_CREDENTIALS"})
			return
		}
		if errors.Is(err, adminstore.ErrUserDisabled) {
			WriteJSON(w, http.StatusUnauthorized, "用户已被禁用", map[string]string{"error_code": "USER_DISABLED"})
			return
		}
		if err != nil {
			logger.Error("admin login failed", "error", err.Error())
			WriteJSON(w, http.StatusServiceUnavailable, "登录失败，请稍后重试", map[string]string{"error_code": "ADMIN_STORE_UNAVAILABLE"})
			return
		}
		token, err := issueAdminJWT(user.Email, cfg.AdminSecretKey, time.Now().UTC().Add(adminAccessTokenTTL))
		if err != nil {
			logger.Error("issue admin jwt failed", "error", err.Error())
			WriteJSON(w, http.StatusServiceUnavailable, "Token 创建失败", map[string]string{"error_code": "TOKEN_ISSUE_FAILED"})
			return
		}
		WriteJSON(w, http.StatusOK, "登录成功", adminLoginResponse{
			Token:     token,
			ExpiresIn: int(adminAccessTokenTTL.Seconds()),
			User:      user,
		})
	})
}

func buildAdminAuthRegisterNativeHandler(logger *slog.Logger, authStore adminAuthStore) http.HandlerFunc {
	return withRouteOwner("go-native", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			WriteJSON(w, http.StatusMethodNotAllowed, "Method not allowed", nil)
			return
		}
		if authStore == nil {
			logger.Error("admin auth store unavailable")
			WriteJSON(w, http.StatusServiceUnavailable, "认证服务不可用", map[string]string{"error_code": "ADMIN_STORE_UNAVAILABLE"})
			return
		}
		var payload adminRegisterPayload
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			WriteJSON(w, http.StatusBadRequest, "请求体错误", map[string]string{"error_code": "INVALID_BODY"})
			return
		}
		email := strings.ToLower(strings.TrimSpace(payload.Email))
		if !isValidAdminUserEmail(email) {
			WriteJSON(w, http.StatusBadRequest, "请输入有效的邮箱地址", map[string]string{"error_code": "INVALID_BODY"})
			return
		}
		if !isValidAdminUserPassword(payload.Password) {
			WriteJSON(w, http.StatusBadRequest, "密码必须包含字母和数字，长度 8-100 位", map[string]string{"error_code": "INVALID_BODY"})
			return
		}
		user, err := authStore.RegisterAdminUser(r.Context(), adminstore.UserRegisterRequest{
			Email:     email,
			Password:  payload.Password,
			TenantID:  optionalStringHeader(r, "x-scope-tenant-id"),
			TraceID:   optionalStringHeader(r, traceHeader),
			IPAddress: optionalString(firstRemoteAddr(r)),
			UserAgent: optionalString(r.UserAgent()),
		})
		if errors.Is(err, adminstore.ErrUserConflict) {
			WriteJSON(w, http.StatusBadRequest, "系统已有管理员账户，不允许再次注册", map[string]string{"error_code": "USER_CONFLICT"})
			return
		}
		if err != nil {
			logger.Error("admin register failed", "error", err.Error())
			WriteJSON(w, http.StatusServiceUnavailable, "注册失败，请稍后重试", map[string]string{"error_code": "ADMIN_STORE_UNAVAILABLE"})
			return
		}
		WriteJSON(w, http.StatusOK, "注册成功，请登录", adminRegisterResponse{
			User:    user,
			Message: "注册成功，请登录",
		})
	})
}

func buildAdminAuthLogoutNativeHandler(logger *slog.Logger, cfg config.Config, authStore adminAuthStore) http.HandlerFunc {
	return withRouteOwner("go-native", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			WriteJSON(w, http.StatusMethodNotAllowed, "Method not allowed", nil)
			return
		}
		if authStore == nil {
			logger.Error("admin auth store unavailable")
			WriteJSON(w, http.StatusServiceUnavailable, "认证服务不可用", map[string]string{"error_code": "ADMIN_STORE_UNAVAILABLE"})
			return
		}
		subject, ok := adminJWTSubjectFromRequest(w, r, cfg.AdminSecretKey)
		if !ok {
			return
		}
		err := authStore.LogoutAdminUser(r.Context(), adminstore.UserLogoutRequest{
			Subject:   subject,
			TenantID:  optionalStringHeader(r, "x-scope-tenant-id"),
			TraceID:   optionalStringHeader(r, traceHeader),
			IPAddress: optionalString(firstRemoteAddr(r)),
			UserAgent: optionalString(r.UserAgent()),
		})
		if errors.Is(err, authz.ErrUnauthorized) {
			WriteJSON(w, http.StatusUnauthorized, "Token 已过期或无效", map[string]string{"error_code": "INVALID_TOKEN"})
			return
		}
		if err != nil {
			logger.Error("admin logout failed", "error", err.Error())
			WriteJSON(w, http.StatusServiceUnavailable, "登出失败", map[string]string{"error_code": "ADMIN_STORE_UNAVAILABLE"})
			return
		}
		WriteJSON(w, http.StatusOK, "登出成功", nil)
	})
}

func buildAdminAuthChangePasswordNativeHandler(logger *slog.Logger, cfg config.Config, authStore adminAuthStore) http.HandlerFunc {
	return withRouteOwner("go-native", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			WriteJSON(w, http.StatusMethodNotAllowed, "Method not allowed", nil)
			return
		}
		if authStore == nil {
			logger.Error("admin auth store unavailable")
			WriteJSON(w, http.StatusServiceUnavailable, "认证服务不可用", map[string]string{"error_code": "ADMIN_STORE_UNAVAILABLE"})
			return
		}
		subject, ok := adminJWTSubjectFromRequest(w, r, cfg.AdminSecretKey)
		if !ok {
			return
		}
		var payload adminProfilePasswordPayload
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			WriteJSON(w, http.StatusBadRequest, "请求体错误", map[string]string{"error_code": "INVALID_BODY"})
			return
		}
		if !isValidAdminUserPassword(payload.NewPassword) {
			WriteJSON(w, http.StatusBadRequest, "密码必须包含字母和数字，长度 8-100 位", map[string]string{"error_code": "INVALID_BODY"})
			return
		}
		err := authStore.ChangeProfilePasswordBySubject(r.Context(), adminstore.ProfilePasswordChangeRequest{
			Subject:     subject,
			OldPassword: payload.OldPassword,
			NewPassword: payload.NewPassword,
			OperatorID:  optionalIntHeader(r, "x-auth-user-id"),
			TenantID:    optionalStringHeader(r, "x-scope-tenant-id"),
			TraceID:     optionalStringHeader(r, traceHeader),
			IPAddress:   optionalString(firstRemoteAddr(r)),
			UserAgent:   optionalString(r.UserAgent()),
		})
		writeAdminProfilePasswordResult(w, logger, err)
	})
}

func buildAdminAuthAuthorizeNativeHandler(logger *slog.Logger, cfg config.Config, authStore adminAuthStore) http.HandlerFunc {
	return withRouteOwner("go-native", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			WriteJSON(w, http.StatusMethodNotAllowed, "Method not allowed", nil)
			return
		}
		if authStore == nil {
			logger.Error("admin auth store unavailable")
			WriteJSON(w, http.StatusServiceUnavailable, "授权服务不可用", map[string]string{"error_code": "AUTHZ_UNAVAILABLE"})
			return
		}
		permission := strings.TrimSpace(r.URL.Query().Get("permission"))
		if permission == "" {
			WriteJSON(w, http.StatusBadRequest, "缺少 permission 参数", map[string]string{"error_code": "INVALID_QUERY"})
			return
		}
		subject, ok := adminJWTSubjectFromRequest(w, r, cfg.AdminSecretKey)
		if !ok {
			return
		}
		result, err := authStore.CheckPermission(r.Context(), subject, permission, resolveScopeHeaders(r))
		if errors.Is(err, authz.ErrUnauthorized) {
			w.Header().Set("WWW-Authenticate", "Bearer")
			WriteJSON(w, http.StatusUnauthorized, "Token 已过期或无效", map[string]string{"error_code": "INVALID_TOKEN"})
			return
		}
		if err != nil {
			logger.Error("admin authorize failed", "error", err.Error())
			WriteJSON(w, http.StatusServiceUnavailable, "授权服务不可用", map[string]string{"error_code": "AUTHZ_UNAVAILABLE"})
			return
		}
		data := adminAuthorizeResponse{
			Allowed:    result.Allowed,
			Reason:     result.Reason,
			Permission: permission,
			Scope:      result.Scope,
			Binding:    nil,
		}
		data.User.ID = result.UserID
		data.User.Username = result.User
		data.User.Email = result.Email
		WriteJSON(w, http.StatusOK, "ok", data)
	})
}
