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
