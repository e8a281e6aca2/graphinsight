package config

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestResolveNeo4jConfigEnvMode(t *testing.T) {
	t.Parallel()

	cfg, err := ResolveNeo4jConfig(context.Background(), Config{
		Neo4jURI:          "bolt://env:7687",
		Neo4jUser:         "env-user",
		Neo4jPassword:     "env-password",
		Neo4jDatabase:     "env-db",
		Neo4jConfigSource: "env",
	})
	if err != nil {
		t.Fatalf("resolve env config: %v", err)
	}
	if cfg.Neo4jURI != "bolt://env:7687" || cfg.Neo4jUser != "env-user" || cfg.Neo4jDatabase != "env-db" {
		t.Fatalf("unexpected env config: %+v", cfg)
	}
	if cfg.Neo4jConfigResolvedSource != "env" {
		t.Fatalf("unexpected resolved source: %q", cfg.Neo4jConfigResolvedSource)
	}
}

func TestResolveNeo4jConfigAdminMode(t *testing.T) {
	t.Parallel()

	var gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		if r.URL.Path != "/api/v1/admin/config/neo4j/all" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if r.URL.Query().Get("include_sensitive") != "true" {
			t.Fatalf("expected sensitive config opt-in, got query: %s", r.URL.RawQuery)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":200,"data":{"uri":"bolt://admin:7687","user":"admin-user","password":"admin-password","database":"admin-db","source":"admin_config","mode":"admin"}}`))
	}))
	defer srv.Close()

	cfg, err := ResolveNeo4jConfig(context.Background(), Config{
		Neo4jURI:                    "bolt://env:7687",
		Neo4jUser:                   "env-user",
		Neo4jPassword:               "env-password",
		Neo4jDatabase:               "env-db",
		Neo4jConfigSource:           "admin",
		PythonBackendBaseURL:        srv.URL,
		PythonBackendTimeoutSeconds: 2,
		AdminConfigToken:            "token-123",
	})
	if err != nil {
		t.Fatalf("resolve admin config: %v", err)
	}
	if gotAuth != "Bearer token-123" {
		t.Fatalf("unexpected auth header: %q", gotAuth)
	}
	if cfg.Neo4jURI != "bolt://admin:7687" || cfg.Neo4jUser != "admin-user" || cfg.Neo4jPassword != "admin-password" || cfg.Neo4jDatabase != "admin-db" {
		t.Fatalf("unexpected admin config: %+v", cfg)
	}
	if cfg.Neo4jConfigSource != "admin" || cfg.Neo4jConfigResolvedSource != "admin_config" {
		t.Fatalf("unexpected source metadata: mode=%q source=%q", cfg.Neo4jConfigSource, cfg.Neo4jConfigResolvedSource)
	}
}

func TestResolveNeo4jConfigAutoFallsBackToEnv(t *testing.T) {
	t.Parallel()

	cfg, err := ResolveNeo4jConfig(context.Background(), Config{
		Neo4jURI:                    "bolt://env:7687",
		Neo4jUser:                   "env-user",
		Neo4jPassword:               "env-password",
		Neo4jDatabase:               "env-db",
		Neo4jConfigSource:           "auto",
		PythonBackendBaseURL:        "http://127.0.0.1:1",
		PythonBackendTimeoutSeconds: 1,
	})
	if err != nil {
		t.Fatalf("auto mode should not return error on fallback: %v", err)
	}
	if cfg.Neo4jURI != "bolt://env:7687" || cfg.Neo4jUser != "env-user" || cfg.Neo4jDatabase != "env-db" {
		t.Fatalf("unexpected fallback config: %+v", cfg)
	}
	if cfg.Neo4jConfigResolvedSource != "env_fallback" {
		t.Fatalf("unexpected fallback source: %q", cfg.Neo4jConfigResolvedSource)
	}
	if cfg.Neo4jConfigResolutionErr == "" {
		t.Fatal("expected fallback resolution error to be recorded")
	}
}

func TestResolveNeo4jConfigAdminRequiresToken(t *testing.T) {
	t.Parallel()

	cfg, err := ResolveNeo4jConfig(context.Background(), Config{
		Neo4jURI:          "bolt://env:7687",
		Neo4jUser:         "env-user",
		Neo4jPassword:     "env-password",
		Neo4jDatabase:     "env-db",
		Neo4jConfigSource: "admin",
	})
	if err == nil {
		t.Fatal("expected admin mode without token to fail")
	}
	if !strings.Contains(err.Error(), "GO_ADMIN_CONFIG_TOKEN") {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Neo4jConfigResolvedSource != "admin_error" || cfg.Neo4jConfigResolutionErr == "" {
		t.Fatalf("expected admin error metadata, got source=%q err=%q", cfg.Neo4jConfigResolvedSource, cfg.Neo4jConfigResolutionErr)
	}
}
