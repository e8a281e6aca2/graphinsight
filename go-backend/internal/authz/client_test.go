package authz

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"graphinsight/go-backend/internal/config"
)

func TestClientCheckPermissionSuccess(t *testing.T) {
	t.Parallel()

	var gotAuth string
	var gotPermission string
	var gotTenant string

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		gotPermission = r.URL.Query().Get("permission")
		gotTenant = r.Header.Get("x-tenant-id")
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"code":200,"data":{"allowed":true,"reason":"allowed","user":{"id":7,"username":"alice","email":"alice@example.com"},"scope":{"tenant_id":"tenant-a","project_id":""}}}`))
	}))
	defer srv.Close()

	client, err := New(config.Config{PythonBackendBaseURL: srv.URL, PythonBackendTimeoutSeconds: 2})
	if err != nil {
		t.Fatalf("new client: %v", err)
	}

	result, err := client.CheckPermission(context.Background(), "token-123", "graph:read", map[string]string{
		"x-tenant-id": "tenant-a",
	})
	if err != nil {
		t.Fatalf("check permission failed: %v", err)
	}
	if !result.Allowed || result.Reason != "allowed" {
		t.Fatalf("unexpected result: %+v", result)
	}
	if result.UserID != 7 || result.User != "alice" || result.Email != "alice@example.com" {
		t.Fatalf("unexpected user info: %+v", result)
	}
	if result.Scope["tenant_id"] != "tenant-a" {
		t.Fatalf("unexpected scope: %+v", result.Scope)
	}
	if gotAuth != "Bearer token-123" {
		t.Fatalf("unexpected auth header: %s", gotAuth)
	}
	if gotPermission != "graph:read" {
		t.Fatalf("unexpected permission query: %s", gotPermission)
	}
	if gotTenant != "tenant-a" {
		t.Fatalf("unexpected tenant header: %s", gotTenant)
	}
}

func TestClientCheckPermissionUnauthorized(t *testing.T) {
	t.Parallel()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer srv.Close()

	client, err := New(config.Config{PythonBackendBaseURL: srv.URL, PythonBackendTimeoutSeconds: 2})
	if err != nil {
		t.Fatalf("new client: %v", err)
	}

	_, err = client.CheckPermission(context.Background(), "bad-token", "graph:read", nil)
	if !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("expected ErrUnauthorized, got: %v", err)
	}
}

func TestClientCheckPermissionForbidden(t *testing.T) {
	t.Parallel()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
	}))
	defer srv.Close()

	client, err := New(config.Config{PythonBackendBaseURL: srv.URL, PythonBackendTimeoutSeconds: 2})
	if err != nil {
		t.Fatalf("new client: %v", err)
	}

	_, err = client.CheckPermission(context.Background(), "token", "graph:read", nil)
	if !errors.Is(err, ErrForbidden) {
		t.Fatalf("expected ErrForbidden, got: %v", err)
	}
}
