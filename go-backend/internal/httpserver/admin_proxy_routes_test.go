package httpserver

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"graphinsight/go-backend/internal/authz"
	"graphinsight/go-backend/internal/config"
	"graphinsight/go-backend/internal/proxy"
)

func newProxyClientForTest(t *testing.T, handler http.HandlerFunc) *proxy.Client {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)

	client, err := proxy.New(config.Config{
		PythonBackendBaseURL:        srv.URL,
		PythonBackendTimeoutSeconds: 2,
		PythonBackendForwardAuth:    true,
	})
	if err != nil {
		t.Fatalf("new proxy client: %v", err)
	}
	return client
}

func TestAdminMonitorProxyRouteMarksOwnerAndForwards(t *testing.T) {
	t.Parallel()

	var gotPath string
	proxyClient := newProxyClientForTest(t, func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"code":200,"message":"ok"}`))
	})

	mux := http.NewServeMux()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	guard := newBusinessPermissionGuard(config.Config{RBACEnforceBusinessAPI: false}, logger, nil, nil)
	registerAdminOwnedProxyRoutes(mux, logger, proxyClient, nil, guard)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/monitor/stats", nil)
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	if gotPath != "/api/v1/admin/monitor/stats" {
		t.Fatalf("unexpected upstream path: %s", gotPath)
	}
	if rec.Header().Get(routeOwnerHeader) != "go-admin-proxy" {
		t.Fatalf("unexpected route owner: %s", rec.Header().Get(routeOwnerHeader))
	}
}

func TestUnknownAdminRouteIsOwnedByGoAdminProxy(t *testing.T) {
	t.Parallel()

	proxyClient := newProxyClientForTest(t, func(w http.ResponseWriter, r *http.Request) {
		t.Fatalf("proxy should not be called for unknown admin route")
	})

	mux := http.NewServeMux()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	guard := newBusinessPermissionGuard(config.Config{RBACEnforceBusinessAPI: false}, logger, nil, nil)
	registerAdminOwnedProxyRoutes(mux, logger, proxyClient, nil, guard)
	registerLegacyPythonProxyRoutes(mux, logger, proxyClient, nil)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/unknown-module", nil)
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
	if rec.Header().Get(routeOwnerHeader) != "go-admin-proxy" {
		t.Fatalf("unexpected route owner: %s", rec.Header().Get(routeOwnerHeader))
	}
}

func TestAdminMonitorAlertsCheckProxyRouteUsesReadPermission(t *testing.T) {
	t.Parallel()

	authzClient := newAuthzClientForTest(
		t,
		http.StatusOK,
		`{"code":200,"data":{"allowed":true,"reason":"ok","user":{"id":4,"username":"ops","email":"ops@example.com"},"scope":{}}}`,
	)
	proxyClient := newProxyClientForTest(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-authz-permission") != "monitor:read" {
			t.Fatalf("expected monitor:read permission, got %s", r.Header.Get("x-authz-permission"))
		}
		if r.Method != http.MethodPost {
			t.Fatalf("expected POST method, got %s", r.Method)
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"code":200,"message":"ok"}`))
	})

	mux := http.NewServeMux()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	guard := newBusinessPermissionGuard(config.Config{RBACEnforceBusinessAPI: true}, logger, authzClient, nil)
	registerAdminOwnedProxyRoutes(mux, logger, proxyClient, nil, guard)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/monitor/alerts/check", nil)
	req.Header.Set("Authorization", "Bearer token")
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
}

func TestAdminMonitorLogSeverityProxyRouteUsesReadPermission(t *testing.T) {
	t.Parallel()

	authzClient := newAuthzClientForTest(
		t,
		http.StatusOK,
		`{"code":200,"data":{"allowed":true,"reason":"ok","user":{"id":14,"username":"opslog","email":"opslog@example.com"},"scope":{}}}`,
	)
	proxyClient := newProxyClientForTest(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-authz-permission") != "monitor:read" {
			t.Fatalf("expected monitor:read permission, got %s", r.Header.Get("x-authz-permission"))
		}
		if r.Method != http.MethodGet {
			t.Fatalf("expected GET method, got %s", r.Method)
		}
		if r.URL.Path != "/api/v1/admin/monitor/log-severity" {
			t.Fatalf("unexpected upstream path: %s", r.URL.Path)
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"code":200,"message":"ok"}`))
	})

	mux := http.NewServeMux()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	guard := newBusinessPermissionGuard(config.Config{RBACEnforceBusinessAPI: true}, logger, authzClient, nil)
	registerAdminOwnedProxyRoutes(mux, logger, proxyClient, nil, guard)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/monitor/log-severity", nil)
	req.Header.Set("Authorization", "Bearer token")
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	if rec.Header().Get(routeOwnerHeader) != "go-admin-proxy" {
		t.Fatalf("unexpected route owner: %s", rec.Header().Get(routeOwnerHeader))
	}
}

func TestAdminMonitorSimpleHealthSkipsPermission(t *testing.T) {
	t.Parallel()

	proxyClient := newProxyClientForTest(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-authz-permission") != "" {
			t.Fatalf("expected no permission header, got %s", r.Header.Get("x-authz-permission"))
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"code":200,"message":"ok"}`))
	})

	mux := http.NewServeMux()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	guard := newBusinessPermissionGuard(config.Config{RBACEnforceBusinessAPI: false}, logger, nil, nil)
	registerAdminOwnedProxyRoutes(mux, logger, proxyClient, nil, guard)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/monitor/health/simple", nil)
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
}

func TestAdminJobsListProxyRouteUsesReadPermission(t *testing.T) {
	t.Parallel()

	authzClient := newAuthzClientForTest(
		t,
		http.StatusOK,
		`{"code":200,"data":{"allowed":true,"reason":"ok","user":{"id":3,"username":"alice","email":"alice@example.com"},"scope":{}}}`,
	)
	proxyClient := newProxyClientForTest(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-authz-permission") != "job:read" {
			t.Fatalf("expected job:read permission, got %s", r.Header.Get("x-authz-permission"))
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"code":200,"message":"ok"}`))
	})

	mux := http.NewServeMux()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	guard := newBusinessPermissionGuard(config.Config{RBACEnforceBusinessAPI: true}, logger, authzClient, nil)
	registerAdminOwnedProxyRoutes(mux, logger, proxyClient, nil, guard)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/jobs", nil)
	req.Header.Set("Authorization", "Bearer test-token")
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
}

func TestAdminJobsRetryProxyRouteUsesManagePermission(t *testing.T) {
	t.Parallel()

	authzClient := newAuthzClientForTest(
		t,
		http.StatusOK,
		`{"code":200,"data":{"allowed":true,"reason":"ok","user":{"id":7,"username":"bob","email":"bob@example.com"},"scope":{}}}`,
	)
	proxyClient := newProxyClientForTest(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-authz-permission") != "job:manage" {
			t.Fatalf("expected job:manage permission, got %s", r.Header.Get("x-authz-permission"))
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"code":200,"message":"ok"}`))
	})

	mux := http.NewServeMux()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	guard := newBusinessPermissionGuard(config.Config{RBACEnforceBusinessAPI: true}, logger, authzClient, nil)
	registerAdminOwnedProxyRoutes(mux, logger, proxyClient, nil, guard)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/jobs/12:retry", nil)
	req.Header.Set("Authorization", "Bearer test-token")
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
}

func TestAdminJobsBuildGraphProxyRouteUsesManagePermission(t *testing.T) {
	t.Parallel()

	authzClient := newAuthzClientForTest(
		t,
		http.StatusOK,
		`{"code":200,"data":{"allowed":true,"reason":"ok","user":{"id":10,"username":"builder","email":"builder@example.com"},"scope":{}}}`,
	)
	proxyClient := newProxyClientForTest(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-authz-permission") != "job:manage" {
			t.Fatalf("expected job:manage permission, got %s", r.Header.Get("x-authz-permission"))
		}
		if r.URL.Path != "/api/v1/admin/jobs/build-graph" {
			t.Fatalf("unexpected upstream path: %s", r.URL.Path)
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"code":200,"message":"ok"}`))
	})

	mux := http.NewServeMux()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	guard := newBusinessPermissionGuard(config.Config{RBACEnforceBusinessAPI: true}, logger, authzClient, nil)
	registerAdminOwnedProxyRoutes(mux, logger, proxyClient, nil, guard)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/jobs/build-graph", nil)
	req.Header.Set("Authorization", "Bearer token")
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
}

func TestAdminJobsRejectsUnknownSubpath(t *testing.T) {
	t.Parallel()

	proxyClient := newProxyClientForTest(t, func(w http.ResponseWriter, r *http.Request) {
		t.Fatalf("proxy should not be called for unknown jobs subpath")
	})

	mux := http.NewServeMux()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	guard := newBusinessPermissionGuard(config.Config{RBACEnforceBusinessAPI: false}, logger, nil, nil)
	registerAdminOwnedProxyRoutes(mux, logger, proxyClient, nil, guard)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/admin/jobs/build-graph", nil)
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405, got %d", rec.Code)
	}
}

func TestAdminQATracesProxyRouteRejectsWrongMethod(t *testing.T) {
	t.Parallel()

	proxyClient := newProxyClientForTest(t, func(w http.ResponseWriter, r *http.Request) {
		t.Fatalf("proxy should not be called for wrong method")
	})

	mux := http.NewServeMux()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	guard := newBusinessPermissionGuard(config.Config{RBACEnforceBusinessAPI: false}, logger, (*authz.Client)(nil), nil)
	registerAdminOwnedProxyRoutes(mux, logger, proxyClient, nil, guard)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/qa-traces", nil)
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405, got %d", rec.Code)
	}
}

func TestAdminQATracesDetailProxyRouteUsesReadPermission(t *testing.T) {
	t.Parallel()

	authzClient := newAuthzClientForTest(
		t,
		http.StatusOK,
		`{"code":200,"data":{"allowed":true,"reason":"ok","user":{"id":9,"username":"qa","email":"qa@example.com"},"scope":{}}}`,
	)
	proxyClient := newProxyClientForTest(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-authz-permission") != "monitor:read" {
			t.Fatalf("expected monitor:read permission, got %s", r.Header.Get("x-authz-permission"))
		}
		if r.URL.Path != "/api/v1/admin/qa-traces/trace-1" {
			t.Fatalf("unexpected upstream path: %s", r.URL.Path)
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"code":200,"message":"ok"}`))
	})

	mux := http.NewServeMux()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	guard := newBusinessPermissionGuard(config.Config{RBACEnforceBusinessAPI: true}, logger, authzClient, nil)
	registerAdminOwnedProxyRoutes(mux, logger, proxyClient, nil, guard)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/qa-traces/trace-1", nil)
	req.Header.Set("Authorization", "Bearer token")
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
}

func TestAdminQATracesCostSummaryProxyRouteUsesReadPermission(t *testing.T) {
	t.Parallel()

	authzClient := newAuthzClientForTest(
		t,
		http.StatusOK,
		`{"code":200,"data":{"allowed":true,"reason":"ok","user":{"id":15,"username":"qacost","email":"qacost@example.com"},"scope":{}}}`,
	)
	proxyClient := newProxyClientForTest(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-authz-permission") != "monitor:read" {
			t.Fatalf("expected monitor:read permission, got %s", r.Header.Get("x-authz-permission"))
		}
		if r.Method != http.MethodGet {
			t.Fatalf("expected GET method, got %s", r.Method)
		}
		if r.URL.Path != "/api/v1/admin/qa-traces/cost-summary" {
			t.Fatalf("unexpected upstream path: %s", r.URL.Path)
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"code":200,"message":"ok"}`))
	})

	mux := http.NewServeMux()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	guard := newBusinessPermissionGuard(config.Config{RBACEnforceBusinessAPI: true}, logger, authzClient, nil)
	registerAdminOwnedProxyRoutes(mux, logger, proxyClient, nil, guard)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/qa-traces/cost-summary?window_hours=24", nil)
	req.Header.Set("Authorization", "Bearer token")
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	if rec.Header().Get(routeOwnerHeader) != "go-admin-proxy" {
		t.Fatalf("unexpected route owner: %s", rec.Header().Get(routeOwnerHeader))
	}
}

func TestAdminConfigWriteProxyRouteUsesWritePermission(t *testing.T) {
	t.Parallel()

	authzClient := newAuthzClientForTest(
		t,
		http.StatusOK,
		`{"code":200,"data":{"allowed":true,"reason":"ok","user":{"id":5,"username":"cfg","email":"cfg@example.com"},"scope":{}}}`,
	)
	proxyClient := newProxyClientForTest(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-authz-permission") != "config:write" {
			t.Fatalf("expected config:write permission, got %s", r.Header.Get("x-authz-permission"))
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"code":200,"message":"ok"}`))
	})

	mux := http.NewServeMux()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	guard := newBusinessPermissionGuard(config.Config{RBACEnforceBusinessAPI: true}, logger, authzClient, nil)
	registerAdminOwnedProxyRoutes(mux, logger, proxyClient, nil, guard)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/config", nil)
	req.Header.Set("Authorization", "Bearer token")
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
}

func TestAdminConfigSubpathReadUsesReadPermission(t *testing.T) {
	t.Parallel()

	authzClient := newAuthzClientForTest(
		t,
		http.StatusOK,
		`{"code":200,"data":{"allowed":true,"reason":"ok","user":{"id":11,"username":"cfgread","email":"cfgread@example.com"},"scope":{}}}`,
	)
	proxyClient := newProxyClientForTest(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-authz-permission") != "config:read" {
			t.Fatalf("expected config:read permission, got %s", r.Header.Get("x-authz-permission"))
		}
		if r.URL.Path != "/api/v1/admin/config/openai/models" {
			t.Fatalf("unexpected upstream path: %s", r.URL.Path)
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"code":200,"message":"ok"}`))
	})

	mux := http.NewServeMux()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	guard := newBusinessPermissionGuard(config.Config{RBACEnforceBusinessAPI: true}, logger, authzClient, nil)
	registerAdminOwnedProxyRoutes(mux, logger, proxyClient, nil, guard)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/config/openai/models", nil)
	req.Header.Set("Authorization", "Bearer token")
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
}

func TestAdminLogsCleanProxyRouteUsesCleanPermission(t *testing.T) {
	t.Parallel()

	authzClient := newAuthzClientForTest(
		t,
		http.StatusOK,
		`{"code":200,"data":{"allowed":true,"reason":"ok","user":{"id":6,"username":"log","email":"log@example.com"},"scope":{}}}`,
	)
	proxyClient := newProxyClientForTest(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-authz-permission") != "logs:clean" {
			t.Fatalf("expected logs:clean permission, got %s", r.Header.Get("x-authz-permission"))
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"code":200,"message":"ok"}`))
	})

	mux := http.NewServeMux()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	guard := newBusinessPermissionGuard(config.Config{RBACEnforceBusinessAPI: true}, logger, authzClient, nil)
	registerAdminOwnedProxyRoutes(mux, logger, proxyClient, nil, guard)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/admin/logs/clean", nil)
	req.Header.Set("Authorization", "Bearer token")
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
}

func TestAdminLogsDetailReadUsesReadPermission(t *testing.T) {
	t.Parallel()

	authzClient := newAuthzClientForTest(
		t,
		http.StatusOK,
		`{"code":200,"data":{"allowed":true,"reason":"ok","user":{"id":12,"username":"logread","email":"logread@example.com"},"scope":{}}}`,
	)
	proxyClient := newProxyClientForTest(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-authz-permission") != "logs:read" {
			t.Fatalf("expected logs:read permission, got %s", r.Header.Get("x-authz-permission"))
		}
		if r.URL.Path != "/api/v1/admin/logs/123" {
			t.Fatalf("unexpected upstream path: %s", r.URL.Path)
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"code":200,"message":"ok"}`))
	})

	mux := http.NewServeMux()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	guard := newBusinessPermissionGuard(config.Config{RBACEnforceBusinessAPI: true}, logger, authzClient, nil)
	registerAdminOwnedProxyRoutes(mux, logger, proxyClient, nil, guard)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/logs/123", nil)
	req.Header.Set("Authorization", "Bearer token")
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
}

func TestAdminRbacRolesUsesManagePermission(t *testing.T) {
	t.Parallel()

	authzClient := newAuthzClientForTest(
		t,
		http.StatusOK,
		`{"code":200,"data":{"allowed":true,"reason":"ok","user":{"id":13,"username":"rbac","email":"rbac@example.com"},"scope":{}}}`,
	)
	proxyClient := newProxyClientForTest(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-authz-permission") != "user:manage" {
			t.Fatalf("expected user:manage permission, got %s", r.Header.Get("x-authz-permission"))
		}
		if r.URL.Path != "/api/v1/admin/rbac/roles" {
			t.Fatalf("unexpected upstream path: %s", r.URL.Path)
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"code":200,"message":"ok"}`))
	})

	mux := http.NewServeMux()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	guard := newBusinessPermissionGuard(config.Config{RBACEnforceBusinessAPI: true}, logger, authzClient, nil)
	registerAdminOwnedProxyRoutes(mux, logger, proxyClient, nil, guard)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/rbac/roles", nil)
	req.Header.Set("Authorization", "Bearer token")
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
}

func TestAdminRbacBindingsRejectUnknownPath(t *testing.T) {
	t.Parallel()

	proxyClient := newProxyClientForTest(t, func(w http.ResponseWriter, r *http.Request) {
		t.Fatalf("proxy should not be called for unknown rbac path")
	})

	mux := http.NewServeMux()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	guard := newBusinessPermissionGuard(config.Config{RBACEnforceBusinessAPI: false}, logger, nil, nil)
	registerAdminOwnedProxyRoutes(mux, logger, proxyClient, nil, guard)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/rbac/bindings-extra", nil)
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
}

func TestAdminUsersTreeProxyRouteUsesManagePermission(t *testing.T) {
	t.Parallel()

	authzClient := newAuthzClientForTest(
		t,
		http.StatusOK,
		`{"code":200,"data":{"allowed":true,"reason":"ok","user":{"id":8,"username":"usr","email":"usr@example.com"},"scope":{}}}`,
	)
	proxyClient := newProxyClientForTest(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-authz-permission") != "user:manage" {
			t.Fatalf("expected user:manage permission, got %s", r.Header.Get("x-authz-permission"))
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"code":200,"message":"ok"}`))
	})

	mux := http.NewServeMux()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	guard := newBusinessPermissionGuard(config.Config{RBACEnforceBusinessAPI: true}, logger, authzClient, nil)
	registerAdminOwnedProxyRoutes(mux, logger, proxyClient, nil, guard)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/api/v1/admin/users/15", nil)
	req.Header.Set("Authorization", "Bearer token")
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
}

func TestAdminUsersRootRejectsUnknownPath(t *testing.T) {
	t.Parallel()

	proxyClient := newProxyClientForTest(t, func(w http.ResponseWriter, r *http.Request) {
		t.Fatalf("proxy should not be called for unknown users root path")
	})

	mux := http.NewServeMux()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	guard := newBusinessPermissionGuard(config.Config{RBACEnforceBusinessAPI: false}, logger, nil, nil)
	registerAdminOwnedProxyRoutes(mux, logger, proxyClient, nil, guard)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/users-extra", nil)
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
}

func TestAdminProfileProxyRouteMarksAdminOwner(t *testing.T) {
	t.Parallel()

	proxyClient := newProxyClientForTest(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"code":200,"message":"ok"}`))
	})

	mux := http.NewServeMux()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	guard := newBusinessPermissionGuard(config.Config{RBACEnforceBusinessAPI: false}, logger, nil, nil)
	registerAdminOwnedProxyRoutes(mux, logger, proxyClient, nil, guard)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/profile", nil)
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	if rec.Header().Get(routeOwnerHeader) != "go-admin-proxy" {
		t.Fatalf("unexpected route owner: %s", rec.Header().Get(routeOwnerHeader))
	}
}

func TestAdminProfileRejectsUnknownSubpath(t *testing.T) {
	t.Parallel()

	proxyClient := newProxyClientForTest(t, func(w http.ResponseWriter, r *http.Request) {
		t.Fatalf("proxy should not be called for unknown profile subpath")
	})

	mux := http.NewServeMux()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	guard := newBusinessPermissionGuard(config.Config{RBACEnforceBusinessAPI: false}, logger, nil, nil)
	registerAdminOwnedProxyRoutes(mux, logger, proxyClient, nil, guard)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/profile/details", nil)
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
}
