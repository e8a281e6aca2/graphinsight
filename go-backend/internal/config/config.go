package config

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type Config struct {
	AppName        string
	Version        string
	Host           string
	Port           int
	LogLevel       string
	AllowedOrigins []string

	Neo4jURI      string
	Neo4jUser     string
	Neo4jPassword string
	Neo4jDatabase string
	// Neo4jConfigSource controls where the Go gateway loads Neo4j settings from:
	// env, admin, or auto.
	Neo4jConfigSource         string
	Neo4jConfigResolvedSource string
	Neo4jConfigResolutionErr  string

	PythonBackendBaseURL        string
	PythonBackendTimeoutSeconds int
	GraphBuildTimeoutSeconds    int
	PythonBackendForwardAuth    bool
	MediaStoragePath            string
	DocumentStoragePath         string
	DocumentStorageFallbackPath string
	AdminDatabaseURL            string

	AIProvider string
	AIModel    string
	AIAPIKey   string

	HTTPWriteTimeoutSeconds int

	OrchestratorRetryMax          int
	OrchestratorRetryBackoffMS    int
	OrchestratorRetryMaxBackoffMS int
	OrchestratorSafeRetryDocQA    bool
	IdempotencyCacheTTLSeconds    int

	RBACEnforceBusinessAPI  bool
	RBACAuthzMode           string
	RBACEnable              bool
	RBACFailOpenWhenUnbound bool
	AdminSecretKey          string
}

func Load() Config {
	loadLocalEnv()

	return Config{
		AppName:  envOrDefault("APP_NAME", "GraphInsight Go API"),
		Version:  envOrDefault("APP_VERSION", "0.1.0"),
		Host:     envOrDefault("API_HOST", "0.0.0.0"),
		Port:     envIntOrDefault("API_PORT", 8081),
		LogLevel: strings.ToLower(envOrDefault("LOG_LEVEL", "info")),
		AllowedOrigins: csvOrDefault("CORS_ALLOWED_ORIGINS", []string{
			"http://localhost:3000",
			"http://localhost:1234",
			"http://localhost:4173",
			"http://localhost:5173",
			"http://localhost:5174",
			"http://127.0.0.1:3000",
			"http://127.0.0.1:1234",
			"http://127.0.0.1:4173",
			"http://127.0.0.1:5173",
			"http://127.0.0.1:5174",
		}),

		Neo4jURI:      envOrDefault("NEO4J_URI", "bolt://localhost:7687"),
		Neo4jUser:     envOrDefault("NEO4J_USER", envOrDefault("NEO4J_USERNAME", "neo4j")),
		Neo4jPassword: envOrDefault("NEO4J_PASSWORD", "password"),
		Neo4jDatabase: envOrDefault("NEO4J_DATABASE", "neo4j"),
		Neo4jConfigSource: strings.ToLower(
			envOrDefault("NEO4J_CONFIG_SOURCE", "env"),
		),
		Neo4jConfigResolvedSource: "env",

		PythonBackendBaseURL:          envOrDefault("PYTHON_BACKEND_BASE_URL", "http://127.0.0.1:8001"),
		PythonBackendTimeoutSeconds:   envIntOrDefault("PYTHON_BACKEND_TIMEOUT_SECONDS", 60),
		GraphBuildTimeoutSeconds:      envIntOrDefault("GRAPH_BUILD_TIMEOUT_SECONDS", 300),
		PythonBackendForwardAuth:      envBoolOrDefault("PYTHON_BACKEND_FORWARD_AUTH", true),
		MediaStoragePath:              resolvePath(envOrDefault("MEDIA_STORAGE_PATH", "../backend/media")),
		DocumentStoragePath:           resolvePath(envOrDefault("DOCUMENT_STORAGE_PATH", "../backend/documents")),
		DocumentStorageFallbackPath:   resolvePath("../backend/documents"),
		AdminDatabaseURL:              envOrDefault("ADMIN_DATABASE_URL", "postgresql://graphinsight:graphinsight-dev-password@127.0.0.1:5434/graphinsight_admin"),
		AIProvider:                    envOrDefault("AI_PROVIDER", "openai"),
		AIModel:                       envOrDefault("LLM_QA_MODEL", envOrDefault("LLM_MODEL", envOrDefault("OPENAI_MODEL", ""))),
		AIAPIKey:                      envOrDefault("LLM_API_KEY", envOrDefault("OPENAI_API_KEY", "")),
		HTTPWriteTimeoutSeconds:       envIntOrDefault("HTTP_WRITE_TIMEOUT_SECONDS", 300),
		OrchestratorRetryMax:          envIntOrDefault("ORCHESTRATOR_RETRY_MAX", 2),
		OrchestratorRetryBackoffMS:    envIntOrDefault("ORCHESTRATOR_RETRY_BACKOFF_MS", 200),
		OrchestratorRetryMaxBackoffMS: envIntOrDefault("ORCHESTRATOR_RETRY_MAX_BACKOFF_MS", 1500),
		OrchestratorSafeRetryDocQA:    envBoolOrDefault("ORCHESTRATOR_SAFE_RETRY_DOCQA", false),
		IdempotencyCacheTTLSeconds:    envIntOrDefault("IDEMPOTENCY_CACHE_TTL_SECONDS", 600),

		RBACEnforceBusinessAPI:  envBoolOrDefault("RBAC_ENFORCE_BUSINESS_API", true),
		RBACAuthzMode:           normalizeRBACAuthzMode(envOrDefault("RBAC_AUTHZ_MODE", "go_db")),
		RBACEnable:              envBoolOrDefault("RBAC_ENABLE", true),
		RBACFailOpenWhenUnbound: envBoolOrDefault("RBAC_FAIL_OPEN_WHEN_UNBOUND", false),
		AdminSecretKey:          envOrDefault("ADMIN_SECRET_KEY", "your-secret-key-change-in-production"),
	}
}

func normalizeRBACAuthzMode(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", "go_db":
		return "go_db"
	case "local_jwt", "local_jwt_soft":
		return "local_jwt_soft"
	default:
		return "go_db"
	}
}

func (c Config) Addr() string {
	return c.Host + ":" + strconv.Itoa(c.Port)
}

func envOrDefault(key, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}

func envIntOrDefault(key string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func envBoolOrDefault(key string, fallback bool) bool {
	value := strings.TrimSpace(strings.ToLower(os.Getenv(key)))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func csvOrDefault(key string, fallback []string) []string {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}
	parts := strings.Split(raw, ",")
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		item := strings.TrimSpace(part)
		if item == "" {
			continue
		}
		result = append(result, item)
	}
	if len(result) == 0 {
		return fallback
	}
	return result
}

func resolvePath(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return trimmed
	}
	if filepath.IsAbs(trimmed) {
		return filepath.Clean(trimmed)
	}
	abs, err := filepath.Abs(trimmed)
	if err != nil {
		return filepath.Clean(trimmed)
	}
	return abs
}
