package config

import (
	"context"
	"errors"
	"testing"
)

type fakeAdminConfigReader struct {
	values map[string]string
	err    error
}

func (r fakeAdminConfigReader) GetValue(_ context.Context, category string, key string) (string, error) {
	if r.err != nil {
		return "", r.err
	}
	return r.values[category+":"+key], nil
}

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

func TestFetchAdminNeo4jConfigFromReader(t *testing.T) {
	t.Parallel()

	payload, err := fetchAdminNeo4jConfigFromReader(context.Background(), fakeAdminConfigReader{
		values: map[string]string{
			"neo4j:uri":      "bolt://admin-db:7687",
			"neo4j:user":     "admin-user",
			"neo4j:password": "admin-password",
			"neo4j:database": "admin-graph",
		},
	}, Config{
		Neo4jConfigSource: "admin",
	})
	if err != nil {
		t.Fatalf("fetch admin config from reader: %v", err)
	}
	if payload.URI != "bolt://admin-db:7687" || payload.User != "admin-user" || payload.Password != "admin-password" || payload.Database != "admin-graph" {
		t.Fatalf("unexpected payload: %+v", payload)
	}
	if payload.Source != "admin_db" || payload.Mode != "admin" {
		t.Fatalf("unexpected payload metadata: %+v", payload)
	}
}

func TestFetchAdminNeo4jConfigFromReaderFallsBackToEnvValues(t *testing.T) {
	t.Parallel()

	payload, err := fetchAdminNeo4jConfigFromReader(context.Background(), fakeAdminConfigReader{
		values: map[string]string{
			"neo4j:uri": "bolt://admin-db:7687",
		},
	}, Config{
		Neo4jUser:         "env-user",
		Neo4jPassword:     "env-password",
		Neo4jDatabase:     "env-db",
		Neo4jConfigSource: "auto",
	})
	if err != nil {
		t.Fatalf("expected env fallback values to complete payload, got err=%v", err)
	}
	if payload.User != "env-user" || payload.Password != "env-password" || payload.Database != "env-db" {
		t.Fatalf("unexpected fallback payload: %+v", payload)
	}
}

func TestFetchAdminNeo4jConfigFromReaderRejectsIncompleteConfig(t *testing.T) {
	t.Parallel()

	_, err := fetchAdminNeo4jConfigFromReader(context.Background(), fakeAdminConfigReader{
		values: map[string]string{
			"neo4j:uri": "bolt://admin-db:7687",
		},
	}, Config{Neo4jConfigSource: "admin"})
	if err == nil {
		t.Fatal("expected incomplete admin config to fail")
	}
}

func TestReadAdminConfigValueReturnsReaderError(t *testing.T) {
	t.Parallel()

	value, err := readAdminConfigValue(context.Background(), fakeAdminConfigReader{err: errors.New("boom")}, "neo4j", "uri")
	if err == nil {
		t.Fatal("expected reader error to be returned")
	}
	if value != "" {
		t.Fatalf("expected empty value on reader error, got %q", value)
	}
}

func TestResolveNeo4jConfigAutoFallsBackToEnvOnAdminDBError(t *testing.T) {
	t.Parallel()

	cfg, err := ResolveNeo4jConfig(context.Background(), Config{
		Neo4jURI:          "bolt://env:7687",
		Neo4jUser:         "env-user",
		Neo4jPassword:     "env-password",
		Neo4jDatabase:     "env-db",
		Neo4jConfigSource: "auto",
		AdminDatabaseURL:  "postgresql://invalid:://",
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

func TestResolveNeo4jConfigAdminRequiresDatabaseURL(t *testing.T) {
	t.Parallel()

	cfg, err := ResolveNeo4jConfig(context.Background(), Config{
		Neo4jURI:          "bolt://env:7687",
		Neo4jUser:         "env-user",
		Neo4jPassword:     "env-password",
		Neo4jDatabase:     "env-db",
		Neo4jConfigSource: "admin",
	})
	if err == nil {
		t.Fatal("expected admin mode without database url to fail")
	}
	if cfg.Neo4jConfigResolvedSource != "admin_error" || cfg.Neo4jConfigResolutionErr == "" {
		t.Fatalf("expected admin error metadata, got source=%q err=%q", cfg.Neo4jConfigResolvedSource, cfg.Neo4jConfigResolutionErr)
	}
}
