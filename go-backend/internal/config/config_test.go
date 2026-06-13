package config

import (
	"path/filepath"
	"slices"
	"testing"
)

func TestLoadDefaultsToGoDBAuthzMode(t *testing.T) {
	t.Setenv("RBAC_AUTHZ_MODE", "")

	cfg := Load()

	if cfg.RBACAuthzMode != "go_db" {
		t.Fatalf("expected default RBAC authz mode go_db, got %q", cfg.RBACAuthzMode)
	}
}

func TestLoadNormalizesLegacyLocalJWTAlias(t *testing.T) {
	t.Setenv("RBAC_AUTHZ_MODE", "local_jwt")

	cfg := Load()

	if cfg.RBACAuthzMode != "local_jwt_soft" {
		t.Fatalf("expected legacy local_jwt alias to normalize to local_jwt_soft, got %q", cfg.RBACAuthzMode)
	}
}

func TestLoadFallsBackUnknownAuthzModeToGoDB(t *testing.T) {
	t.Setenv("RBAC_AUTHZ_MODE", "python")

	cfg := Load()

	if cfg.RBACAuthzMode != "go_db" {
		t.Fatalf("expected unsupported authz mode to normalize to go_db, got %q", cfg.RBACAuthzMode)
	}
}

func TestLoadDefaultCORSOriginsIncludeLocalE2EPreview(t *testing.T) {
	t.Setenv("CORS_ALLOWED_ORIGINS", "")

	cfg := Load()

	for _, origin := range []string{
		"http://127.0.0.1:1234",
		"http://localhost:1234",
		"http://127.0.0.1:4173",
		"http://localhost:4173",
	} {
		if !slices.Contains(cfg.AllowedOrigins, origin) {
			t.Fatalf("expected default CORS origins to include %q, got %#v", origin, cfg.AllowedOrigins)
		}
	}
}

func TestLoadResolvesMediaStoragePath(t *testing.T) {
	t.Setenv("MEDIA_STORAGE_PATH", "../backend/media")

	cfg := Load()

	if !filepath.IsAbs(cfg.MediaStoragePath) {
		t.Fatalf("expected absolute media storage path, got %q", cfg.MediaStoragePath)
	}
}

func TestLoadResolvesDocumentStoragePath(t *testing.T) {
	t.Setenv("DOCUMENT_STORAGE_PATH", "../backend/documents")

	cfg := Load()

	if !filepath.IsAbs(cfg.DocumentStoragePath) {
		t.Fatalf("expected absolute document storage path, got %q", cfg.DocumentStoragePath)
	}
	if !filepath.IsAbs(cfg.DocumentStorageFallbackPath) {
		t.Fatalf("expected absolute document fallback path, got %q", cfg.DocumentStorageFallbackPath)
	}
}
