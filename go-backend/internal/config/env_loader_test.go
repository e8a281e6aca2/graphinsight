package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadEnvFileSkipsPythonListenerKeysForBackendFallback(t *testing.T) {
	t.Setenv("API_PORT", "")
	t.Setenv("API_HOST", "")
	t.Setenv("NEO4J_URI", "")
	t.Setenv("PYTHON_BACKEND_BASE_URL", "")
	os.Unsetenv("API_PORT")
	os.Unsetenv("API_HOST")
	os.Unsetenv("NEO4J_URI")
	os.Unsetenv("PYTHON_BACKEND_BASE_URL")

	envPath := filepath.Join(t.TempDir(), ".env")
	content := "API_HOST=0.0.0.0\nAPI_PORT=8001\nNEO4J_URI=bolt://127.0.0.1:7687\nPYTHON_BACKEND_BASE_URL=http://127.0.0.1:8001\n"
	if err := os.WriteFile(envPath, []byte(content), 0o600); err != nil {
		t.Fatalf("write env file: %v", err)
	}

	if !loadEnvFile(envPath, true) {
		t.Fatal("expected backend fallback env file to load shared keys")
	}

	if value, exists := os.LookupEnv("API_PORT"); exists {
		t.Fatalf("API_PORT should not be inherited from backend fallback, got %q", value)
	}
	if value, exists := os.LookupEnv("API_HOST"); exists {
		t.Fatalf("API_HOST should not be inherited from backend fallback, got %q", value)
	}
	if got := os.Getenv("NEO4J_URI"); got != "bolt://127.0.0.1:7687" {
		t.Fatalf("NEO4J_URI should be inherited from backend fallback, got %q", got)
	}
	if got := os.Getenv("PYTHON_BACKEND_BASE_URL"); got != "http://127.0.0.1:8001" {
		t.Fatalf("PYTHON_BACKEND_BASE_URL should be inherited from backend fallback, got %q", got)
	}
}

func TestLoadEnvFileAllowsListenerKeysForGoEnv(t *testing.T) {
	t.Setenv("API_PORT", "")
	t.Setenv("API_HOST", "")
	os.Unsetenv("API_PORT")
	os.Unsetenv("API_HOST")

	envPath := filepath.Join(t.TempDir(), ".env")
	content := "API_HOST=127.0.0.1\nAPI_PORT=18081\n"
	if err := os.WriteFile(envPath, []byte(content), 0o600); err != nil {
		t.Fatalf("write env file: %v", err)
	}

	if !loadEnvFile(envPath, false) {
		t.Fatal("expected Go env file to load")
	}

	if got := os.Getenv("API_PORT"); got != "18081" {
		t.Fatalf("API_PORT should be loaded from Go env, got %q", got)
	}
	if got := os.Getenv("API_HOST"); got != "127.0.0.1" {
		t.Fatalf("API_HOST should be loaded from Go env, got %q", got)
	}
}

func TestLoadEnvFileResolvesRelativeStoragePathsAgainstEnvFile(t *testing.T) {
	t.Setenv("DOCUMENT_STORAGE_PATH", "")
	t.Setenv("MEDIA_STORAGE_PATH", "")
	os.Unsetenv("DOCUMENT_STORAGE_PATH")
	os.Unsetenv("MEDIA_STORAGE_PATH")

	envDir := filepath.Join(t.TempDir(), "backend")
	if err := os.MkdirAll(envDir, 0o755); err != nil {
		t.Fatalf("mkdir env dir: %v", err)
	}

	envPath := filepath.Join(envDir, ".env")
	content := "DOCUMENT_STORAGE_PATH=./documents\nMEDIA_STORAGE_PATH=./media\n"
	if err := os.WriteFile(envPath, []byte(content), 0o600); err != nil {
		t.Fatalf("write env file: %v", err)
	}

	if !loadEnvFile(envPath, true) {
		t.Fatal("expected backend fallback env file to load")
	}

	expectedDocuments := filepath.Join(envDir, "documents")
	expectedMedia := filepath.Join(envDir, "media")
	if got := os.Getenv("DOCUMENT_STORAGE_PATH"); got != expectedDocuments {
		t.Fatalf("DOCUMENT_STORAGE_PATH should resolve against env file, got %q want %q", got, expectedDocuments)
	}
	if got := os.Getenv("MEDIA_STORAGE_PATH"); got != expectedMedia {
		t.Fatalf("MEDIA_STORAGE_PATH should resolve against env file, got %q want %q", got, expectedMedia)
	}
}
