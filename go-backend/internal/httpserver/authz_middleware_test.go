package httpserver

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"graphinsight/go-backend/internal/authz"
	"graphinsight/go-backend/internal/config"
)

func newDiscardLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func newAuthzClientForTest(t *testing.T, status int, body string) *authz.Client {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(status)
		if body != "" {
			_, _ = w.Write([]byte(body))
		}
	}))
	t.Cleanup(srv.Close)

	client, err := authz.New(config.Config{PythonBackendBaseURL: srv.URL, PythonBackendTimeoutSeconds: 2})
	if err != nil {
		t.Fatalf("new authz client: %v", err)
	}
	return client
}

func TestBusinessGuardSoftModeNoTokenAllows(t *testing.T) {
	t.Parallel()

	guard := newBusinessPermissionGuard(config.Config{RBACEnforceBusinessAPI: false}, newDiscardLogger(), nil, nil)

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

	guard := newBusinessPermissionGuard(config.Config{RBACEnforceBusinessAPI: true}, newDiscardLogger(), nil, nil)

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

	client := newAuthzClientForTest(t, http.StatusUnauthorized, "")
	guard := newBusinessPermissionGuard(config.Config{RBACEnforceBusinessAPI: false}, newDiscardLogger(), client, nil)

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

	client := newAuthzClientForTest(t, http.StatusForbidden, "")
	guard := newBusinessPermissionGuard(config.Config{RBACEnforceBusinessAPI: false}, newDiscardLogger(), client, nil)

	nextCalled := false
	h := guard.wrap("graph:read", func(w http.ResponseWriter, r *http.Request) {
		nextCalled = true
		w.WriteHeader(http.StatusNoContent)
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/query", strings.NewReader(`{"cypher":"RETURN 1"}`))
	req.Header.Set("Authorization", "Bearer token")
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

	client := newAuthzClientForTest(t, http.StatusForbidden, "")
	guard := newBusinessPermissionGuard(config.Config{RBACEnforceBusinessAPI: true}, newDiscardLogger(), client, nil)

	nextCalled := false
	h := guard.wrap("graph:read", func(w http.ResponseWriter, r *http.Request) {
		nextCalled = true
		w.WriteHeader(http.StatusNoContent)
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/query", strings.NewReader(`{"cypher":"RETURN 1"}`))
	req.Header.Set("Authorization", "Bearer token")
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

	client := newAuthzClientForTest(t, http.StatusInternalServerError, "boom")
	guard := newBusinessPermissionGuard(config.Config{RBACEnforceBusinessAPI: false}, newDiscardLogger(), client, nil)

	nextCalled := false
	h := guard.wrap("graph:read", func(w http.ResponseWriter, r *http.Request) {
		nextCalled = true
		w.WriteHeader(http.StatusNoContent)
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/query", strings.NewReader(`{"cypher":"RETURN 1"}`))
	req.Header.Set("Authorization", "Bearer token")
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

	client := newAuthzClientForTest(t, http.StatusInternalServerError, "boom")
	guard := newBusinessPermissionGuard(config.Config{RBACEnforceBusinessAPI: true}, newDiscardLogger(), client, nil)

	nextCalled := false
	h := guard.wrap("graph:read", func(w http.ResponseWriter, r *http.Request) {
		nextCalled = true
		w.WriteHeader(http.StatusNoContent)
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/query", strings.NewReader(`{"cypher":"RETURN 1"}`))
	req.Header.Set("Authorization", "Bearer token")
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

	client := newAuthzClientForTest(
		t,
		http.StatusOK,
		`{"code":200,"data":{"allowed":true,"reason":"allowed","user":{"id":9,"username":"bob","email":"bob@example.com"},"scope":{"tenant_id":"tenant-1"}}}`,
	)
	guard := newBusinessPermissionGuard(config.Config{RBACEnforceBusinessAPI: true}, newDiscardLogger(), client, nil)

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
	req.Header.Set("Authorization", "Bearer token")
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
