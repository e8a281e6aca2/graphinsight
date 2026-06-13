package httpserver

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"graphinsight/go-backend/internal/authz"
	"graphinsight/go-backend/internal/config"
)

func newDiscardLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func TestBusinessGuardSoftModeNoTokenAllows(t *testing.T) {
	t.Parallel()

	guard := newBusinessPermissionGuard(config.Config{RBACEnforceBusinessAPI: false}, newDiscardLogger())

	nextCalled := false
	h := guard.wrap("graph:read", func(w http.ResponseWriter, r *http.Request) {
		nextCalled = true
		w.WriteHeader(http.StatusNoContent)
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/query", strings.NewReader(`{"cypher":"RETURN 1"}`))
	h.ServeHTTP(rec, req)

	if !nextCalled {
		t.Fatalf("next handler should be called in soft mode without token")
	}
	if rec.Code != http.StatusNoContent {
		t.Fatalf("unexpected status: %d", rec.Code)
	}
}

func TestBusinessGuardEnforceModeNoTokenRejects(t *testing.T) {
	t.Parallel()

	guard := newBusinessPermissionGuard(config.Config{RBACEnforceBusinessAPI: true}, newDiscardLogger())

	nextCalled := false
	h := guard.wrap("graph:read", func(w http.ResponseWriter, r *http.Request) {
		nextCalled = true
		w.WriteHeader(http.StatusNoContent)
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/query", strings.NewReader(`{"cypher":"RETURN 1"}`))
	h.ServeHTTP(rec, req)

	if nextCalled {
		t.Fatalf("next handler should not be called in enforce mode without token")
	}
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("unexpected status: %d", rec.Code)
	}
}

func TestBusinessGuardInvalidTokenRejects(t *testing.T) {
	t.Parallel()

	guard := newBusinessPermissionGuard(config.Config{
		RBACEnforceBusinessAPI: false,
		RBACAuthzMode:          "go_db",
		AdminSecretKey:         "test-secret",
	}, newDiscardLogger(), &fakeAdminPermissionStore{})

	h := guard.wrap("graph:read", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/query", strings.NewReader(`{"cypher":"RETURN 1"}`))
	req.Header.Set("Authorization", "Bearer invalid-token")
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("unexpected status: %d", rec.Code)
	}
}

func TestBusinessGuardForbiddenSoftAllow(t *testing.T) {
	t.Parallel()

	store := &fakeAdminPermissionStore{result: authz.CheckResult{Allowed: false, Reason: "permission_missing"}}
	guard := newBusinessPermissionGuard(config.Config{
		RBACEnforceBusinessAPI: false,
		RBACAuthzMode:          "go_db",
		AdminSecretKey:         "test-secret",
	}, newDiscardLogger(), store)

	nextCalled := false
	h := guard.wrap("graph:read", func(w http.ResponseWriter, r *http.Request) {
		nextCalled = true
		w.WriteHeader(http.StatusNoContent)
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/query", strings.NewReader(`{"cypher":"RETURN 1"}`))
	req.Header.Set("Authorization", "Bearer "+issueTestAdminJWT(t, "admin@example.com", "test-secret", time.Now().Add(time.Hour)))
	h.ServeHTTP(rec, req)

	if !nextCalled {
		t.Fatalf("next handler should be called in soft mode when forbidden")
	}
	if rec.Code != http.StatusNoContent {
		t.Fatalf("unexpected status: %d", rec.Code)
	}
}

func TestBusinessGuardForbiddenEnforceReject(t *testing.T) {
	t.Parallel()

	store := &fakeAdminPermissionStore{result: authz.CheckResult{Allowed: false, Reason: "permission_missing"}}
	guard := newBusinessPermissionGuard(config.Config{
		RBACEnforceBusinessAPI: true,
		RBACAuthzMode:          "go_db",
		AdminSecretKey:         "test-secret",
	}, newDiscardLogger(), store)

	nextCalled := false
	h := guard.wrap("graph:read", func(w http.ResponseWriter, r *http.Request) {
		nextCalled = true
		w.WriteHeader(http.StatusNoContent)
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/query", strings.NewReader(`{"cypher":"RETURN 1"}`))
	req.Header.Set("Authorization", "Bearer "+issueTestAdminJWT(t, "admin@example.com", "test-secret", time.Now().Add(time.Hour)))
	h.ServeHTTP(rec, req)

	if nextCalled {
		t.Fatalf("next handler should not be called in enforce mode when forbidden")
	}
	if rec.Code != http.StatusForbidden {
		t.Fatalf("unexpected status: %d", rec.Code)
	}
}

func TestBusinessGuardUpstreamErrorSoftAllow(t *testing.T) {
	t.Parallel()

	store := &fakeAdminPermissionStore{err: errors.New("db down")}
	guard := newBusinessPermissionGuard(config.Config{
		RBACEnforceBusinessAPI: false,
		RBACAuthzMode:          "go_db",
		AdminSecretKey:         "test-secret",
	}, newDiscardLogger(), store)

	nextCalled := false
	h := guard.wrap("graph:read", func(w http.ResponseWriter, r *http.Request) {
		nextCalled = true
		w.WriteHeader(http.StatusNoContent)
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/query", strings.NewReader(`{"cypher":"RETURN 1"}`))
	req.Header.Set("Authorization", "Bearer "+issueTestAdminJWT(t, "admin@example.com", "test-secret", time.Now().Add(time.Hour)))
	h.ServeHTTP(rec, req)

	if !nextCalled {
		t.Fatalf("next handler should be called in soft mode when upstream errors")
	}
	if rec.Code != http.StatusNoContent {
		t.Fatalf("unexpected status: %d", rec.Code)
	}
}

func TestBusinessGuardUpstreamErrorEnforceReject(t *testing.T) {
	t.Parallel()

	store := &fakeAdminPermissionStore{err: errors.New("db down")}
	guard := newBusinessPermissionGuard(config.Config{
		RBACEnforceBusinessAPI: true,
		RBACAuthzMode:          "go_db",
		AdminSecretKey:         "test-secret",
	}, newDiscardLogger(), store)

	nextCalled := false
	h := guard.wrap("graph:read", func(w http.ResponseWriter, r *http.Request) {
		nextCalled = true
		w.WriteHeader(http.StatusNoContent)
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/query", strings.NewReader(`{"cypher":"RETURN 1"}`))
	req.Header.Set("Authorization", "Bearer "+issueTestAdminJWT(t, "admin@example.com", "test-secret", time.Now().Add(time.Hour)))
	h.ServeHTTP(rec, req)

	if nextCalled {
		t.Fatalf("next handler should not be called in enforce mode when upstream errors")
	}
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("unexpected status: %d", rec.Code)
	}
}

func TestBusinessGuardAllowedSetsAuthContextHeaders(t *testing.T) {
	t.Parallel()

	store := &fakeAdminPermissionStore{result: authz.CheckResult{
		Allowed: true,
		Reason:  "allowed",
		UserID:  9,
		User:    "bob",
		Email:   "bob@example.com",
		Scope:   map[string]string{"tenant_id": "tenant-1"},
	}}
	guard := newBusinessPermissionGuard(config.Config{
		RBACEnforceBusinessAPI: true,
		RBACAuthzMode:          "go_db",
		AdminSecretKey:         "test-secret",
	}, newDiscardLogger(), store)

	var gotPermission, gotReason, gotUserID, gotUserName, gotUserEmail string
	h := guard.wrap("graph:read", func(w http.ResponseWriter, r *http.Request) {
		gotPermission = r.Header.Get("x-authz-permission")
		gotReason = r.Header.Get("x-authz-reason")
		gotUserID = r.Header.Get("x-auth-user-id")
		gotUserName = r.Header.Get("x-auth-user-name")
		gotUserEmail = r.Header.Get("x-auth-user-email")
		w.WriteHeader(http.StatusNoContent)
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/query", strings.NewReader(`{"cypher":"RETURN 1"}`))
	req.Header.Set("Authorization", "Bearer "+issueTestAdminJWT(t, "bob@example.com", "test-secret", time.Now().Add(time.Hour)))
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("unexpected status: %d", rec.Code)
	}
	if gotPermission != "graph:read" || gotReason != "allowed" {
		t.Fatalf("unexpected authz headers: permission=%s reason=%s", gotPermission, gotReason)
	}
	if gotUserID != "9" || gotUserName != "bob" || gotUserEmail != "bob@example.com" {
		t.Fatalf("unexpected user headers: id=%s user=%s email=%s", gotUserID, gotUserName, gotUserEmail)
	}
}

func TestBusinessGuardLocalJWTSoftModeAllowsValidAdminTokenWithoutPythonAuthz(t *testing.T) {
	t.Parallel()

	guard := newBusinessPermissionGuard(config.Config{
		RBACEnforceBusinessAPI: true,
		RBACAuthzMode:          "local_jwt_soft",
		AdminSecretKey:         "test-secret",
	}, newDiscardLogger())

	var gotPermission, gotReason, gotUserName, gotUserEmail string
	h := guard.wrap("config:read", func(w http.ResponseWriter, r *http.Request) {
		gotPermission = r.Header.Get("x-authz-permission")
		gotReason = r.Header.Get("x-authz-reason")
		gotUserName = r.Header.Get("x-auth-user-name")
		gotUserEmail = r.Header.Get("x-auth-user-email")
		w.WriteHeader(http.StatusNoContent)
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/config/openai/models", nil)
	req.Header.Set("Authorization", "Bearer "+issueTestAdminJWT(t, "admin@example.com", "test-secret", time.Now().Add(time.Hour)))
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("unexpected status: %d", rec.Code)
	}
	if gotPermission != "config:read" || gotReason != "local_jwt_soft_allow" {
		t.Fatalf("unexpected authz headers: permission=%s reason=%s", gotPermission, gotReason)
	}
	if gotUserName != "admin@example.com" || gotUserEmail != "admin@example.com" {
		t.Fatalf("unexpected user headers: user=%s email=%s", gotUserName, gotUserEmail)
	}
}

func TestBusinessGuardLocalJWTSoftModeRejectsExpiredToken(t *testing.T) {
	t.Parallel()

	guard := newBusinessPermissionGuard(config.Config{
		RBACEnforceBusinessAPI: true,
		RBACAuthzMode:          "local_jwt_soft",
		AdminSecretKey:         "test-secret",
	}, newDiscardLogger())

	nextCalled := false
	h := guard.wrap("config:read", func(w http.ResponseWriter, r *http.Request) {
		nextCalled = true
		w.WriteHeader(http.StatusNoContent)
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/config/openai/models", nil)
	req.Header.Set("Authorization", "Bearer "+issueTestAdminJWT(t, "admin@example.com", "test-secret", time.Now().Add(-time.Minute)))
	h.ServeHTTP(rec, req)

	if nextCalled {
		t.Fatalf("next handler should not be called for expired local jwt")
	}
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("unexpected status: %d", rec.Code)
	}
}

func TestBusinessGuardLocalJWTLegacyModeAliasStillWorks(t *testing.T) {
	t.Parallel()

	guard := newBusinessPermissionGuard(config.Config{
		RBACEnforceBusinessAPI: true,
		RBACAuthzMode:          "local_jwt",
		AdminSecretKey:         "test-secret",
	}, newDiscardLogger())

	nextCalled := false
	h := guard.wrap("config:read", func(w http.ResponseWriter, r *http.Request) {
		nextCalled = true
		if r.Header.Get("x-authz-reason") != "local_jwt_soft_allow" {
			t.Fatalf("unexpected authz reason: %s", r.Header.Get("x-authz-reason"))
		}
		w.WriteHeader(http.StatusNoContent)
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/config/openai/models", nil)
	req.Header.Set("Authorization", "Bearer "+issueTestAdminJWT(t, "admin@example.com", "test-secret", time.Now().Add(time.Hour)))
	h.ServeHTTP(rec, req)

	if !nextCalled {
		t.Fatalf("next handler should be called for legacy local_jwt alias")
	}
	if rec.Code != http.StatusNoContent {
		t.Fatalf("unexpected status: %d", rec.Code)
	}
}

func TestBusinessGuardGoDBModeAllowsWithAdminStoreResult(t *testing.T) {
	t.Parallel()

	store := &fakeAdminPermissionStore{result: authz.CheckResult{
		Allowed: true,
		Reason:  "allowed",
		UserID:  42,
		User:    "admin",
		Email:   "admin@example.com",
	}}
	guard := newBusinessPermissionGuard(config.Config{
		RBACEnforceBusinessAPI: true,
		RBACAuthzMode:          "go_db",
		AdminSecretKey:         "test-secret",
	}, newDiscardLogger(), store)

	var gotPermission, gotReason, gotUserID, gotUserName, gotUserEmail string
	h := guard.wrap("user:manage", func(w http.ResponseWriter, r *http.Request) {
		gotPermission = r.Header.Get("x-authz-permission")
		gotReason = r.Header.Get("x-authz-reason")
		gotUserID = r.Header.Get("x-auth-user-id")
		gotUserName = r.Header.Get("x-auth-user-name")
		gotUserEmail = r.Header.Get("x-auth-user-email")
		w.WriteHeader(http.StatusNoContent)
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/rbac/roles?tenant_id=tenant-1", nil)
	req.Header.Set("Authorization", "Bearer "+issueTestAdminJWT(t, "admin@example.com", "test-secret", time.Now().Add(time.Hour)))
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("unexpected status: %d", rec.Code)
	}
	if store.subject != "admin@example.com" || store.permission != "user:manage" || store.scope["x-tenant-id"] != "tenant-1" {
		t.Fatalf("unexpected store request: subject=%s permission=%s scope=%#v", store.subject, store.permission, store.scope)
	}
	if gotPermission != "user:manage" || gotReason != "allowed" {
		t.Fatalf("unexpected authz headers: permission=%s reason=%s", gotPermission, gotReason)
	}
	if gotUserID != "42" || gotUserName != "admin" || gotUserEmail != "admin@example.com" {
		t.Fatalf("unexpected user headers: id=%s user=%s email=%s", gotUserID, gotUserName, gotUserEmail)
	}
}

func TestBusinessGuardGoDBModeRejectsDeniedPermission(t *testing.T) {
	t.Parallel()

	store := &fakeAdminPermissionStore{result: authz.CheckResult{Allowed: false, Reason: "permission_missing"}}
	guard := newBusinessPermissionGuard(config.Config{
		RBACEnforceBusinessAPI: true,
		RBACAuthzMode:          "go_db",
		AdminSecretKey:         "test-secret",
	}, newDiscardLogger(), store)

	nextCalled := false
	h := guard.wrap("user:manage", func(w http.ResponseWriter, r *http.Request) {
		nextCalled = true
		w.WriteHeader(http.StatusNoContent)
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/rbac/roles", nil)
	req.Header.Set("Authorization", "Bearer "+issueTestAdminJWT(t, "admin@example.com", "test-secret", time.Now().Add(time.Hour)))
	h.ServeHTTP(rec, req)

	if nextCalled {
		t.Fatalf("next handler should not be called for denied go_db permission")
	}
	if rec.Code != http.StatusForbidden {
		t.Fatalf("unexpected status: %d", rec.Code)
	}
}

func TestBusinessGuardGoDBModeRejectsUnknownUser(t *testing.T) {
	t.Parallel()

	store := &fakeAdminPermissionStore{err: authz.ErrUnauthorized}
	guard := newBusinessPermissionGuard(config.Config{
		RBACEnforceBusinessAPI: true,
		RBACAuthzMode:          "go_db",
		AdminSecretKey:         "test-secret",
	}, newDiscardLogger(), store)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/rbac/roles", nil)
	req.Header.Set("Authorization", "Bearer "+issueTestAdminJWT(t, "missing@example.com", "test-secret", time.Now().Add(time.Hour)))
	guard.wrap("user:manage", func(w http.ResponseWriter, r *http.Request) {
		t.Fatalf("next handler should not be called for unknown user")
	}).ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("unexpected status: %d", rec.Code)
	}
}

func TestBusinessGuardGoDBModeSoftAllowsStoreErrorWhenNotEnforced(t *testing.T) {
	t.Parallel()

	store := &fakeAdminPermissionStore{err: errors.New("db down")}
	guard := newBusinessPermissionGuard(config.Config{
		RBACEnforceBusinessAPI: false,
		RBACAuthzMode:          "go_db",
		AdminSecretKey:         "test-secret",
	}, newDiscardLogger(), store)

	nextCalled := false
	h := guard.wrap("user:manage", func(w http.ResponseWriter, r *http.Request) {
		nextCalled = true
		if r.Header.Get("x-authz-reason") != "go_db_error_soft_allow" {
			t.Fatalf("unexpected authz reason: %s", r.Header.Get("x-authz-reason"))
		}
		w.WriteHeader(http.StatusNoContent)
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/rbac/roles", nil)
	req.Header.Set("Authorization", "Bearer "+issueTestAdminJWT(t, "admin@example.com", "test-secret", time.Now().Add(time.Hour)))
	h.ServeHTTP(rec, req)

	if !nextCalled {
		t.Fatalf("next handler should be called for soft go_db authz error")
	}
	if rec.Code != http.StatusNoContent {
		t.Fatalf("unexpected status: %d", rec.Code)
	}
}

type fakeAdminPermissionStore struct {
	result     authz.CheckResult
	err        error
	subject    string
	permission string
	scope      map[string]string
}

func (s *fakeAdminPermissionStore) CheckPermission(_ context.Context, subject string, permission string, scope map[string]string) (authz.CheckResult, error) {
	s.subject = subject
	s.permission = permission
	s.scope = scope
	return s.result, s.err
}

func issueTestAdminJWT(t *testing.T, subject string, secret string, expiresAt time.Time) string {
	t.Helper()
	header := map[string]string{"alg": "HS256", "typ": "JWT"}
	payload := map[string]interface{}{"sub": subject, "exp": expiresAt.Unix()}
	headerBytes, err := json.Marshal(header)
	if err != nil {
		t.Fatalf("marshal jwt header: %v", err)
	}
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal jwt payload: %v", err)
	}
	encodedHeader := base64.RawURLEncoding.EncodeToString(headerBytes)
	encodedPayload := base64.RawURLEncoding.EncodeToString(payloadBytes)
	signingInput := encodedHeader + "." + encodedPayload
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(signingInput))
	signature := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return signingInput + "." + signature
}
