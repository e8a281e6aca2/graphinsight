package config

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type neo4jConfigPayload struct {
	URI      string
	User     string
	Password string
	Database string
	Source   string
	Mode     string
}

type adminNeo4jEnvelope struct {
	Code int                    `json:"code"`
	Data map[string]interface{} `json:"data"`
}

// ResolveNeo4jConfig returns a copy of cfg with Neo4j fields resolved from
// env, admin config, or admin-with-env-fallback depending on NEO4J_CONFIG_SOURCE.
func ResolveNeo4jConfig(ctx context.Context, cfg Config) (Config, error) {
	mode := normalizeNeo4jConfigSource(cfg.Neo4jConfigSource)
	cfg.Neo4jConfigSource = mode

	envPayload := neo4jConfigPayload{
		URI:      cfg.Neo4jURI,
		User:     cfg.Neo4jUser,
		Password: cfg.Neo4jPassword,
		Database: cfg.Neo4jDatabase,
		Source:   "env",
		Mode:     mode,
	}
	applyNeo4jPayload(&cfg, envPayload)

	switch mode {
	case "env":
		cfg.Neo4jConfigResolvedSource = "env"
		cfg.Neo4jConfigResolutionErr = ""
		return cfg, nil
	case "admin":
		adminPayload, err := fetchAdminNeo4jConfig(ctx, cfg)
		if err != nil {
			cfg.Neo4jConfigResolvedSource = "admin_error"
			cfg.Neo4jConfigResolutionErr = err.Error()
			return cfg, err
		}
		applyNeo4jPayload(&cfg, adminPayload)
		return cfg, nil
	case "auto":
		adminPayload, err := fetchAdminNeo4jConfig(ctx, cfg)
		if err != nil {
			cfg.Neo4jConfigResolvedSource = "env_fallback"
			cfg.Neo4jConfigResolutionErr = err.Error()
			return cfg, nil
		}
		applyNeo4jPayload(&cfg, adminPayload)
		return cfg, nil
	default:
		cfg.Neo4jConfigSource = "env"
		cfg.Neo4jConfigResolvedSource = "env"
		cfg.Neo4jConfigResolutionErr = fmt.Sprintf("unsupported NEO4J_CONFIG_SOURCE %q, using env", mode)
		return cfg, nil
	}
}

func normalizeNeo4jConfigSource(value string) string {
	mode := strings.ToLower(strings.TrimSpace(value))
	if mode == "" {
		return "env"
	}
	return mode
}

func fetchAdminNeo4jConfig(ctx context.Context, cfg Config) (neo4jConfigPayload, error) {
	token := strings.TrimSpace(cfg.AdminConfigToken)
	if token == "" {
		return neo4jConfigPayload{}, fmt.Errorf("GO_ADMIN_CONFIG_TOKEN or ADMIN_TOKEN is required when reading admin Neo4j config")
	}

	target, err := adminConfigURL(cfg.PythonBackendBaseURL)
	if err != nil {
		return neo4jConfigPayload{}, err
	}

	timeout := time.Duration(cfg.PythonBackendTimeoutSeconds) * time.Second
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	client := &http.Client{Timeout: timeout}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return neo4jConfigPayload{}, fmt.Errorf("create admin config request failed: %w", err)
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("X-Go-Config-Resolver", "graphinsight-go")

	resp, err := client.Do(req)
	if err != nil {
		return neo4jConfigPayload{}, fmt.Errorf("request admin config failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return neo4jConfigPayload{}, fmt.Errorf("admin config returned %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var envelope adminNeo4jEnvelope
	if err := json.NewDecoder(resp.Body).Decode(&envelope); err != nil {
		return neo4jConfigPayload{}, fmt.Errorf("decode admin config response failed: %w", err)
	}
	if envelope.Code != 0 && envelope.Code != http.StatusOK {
		return neo4jConfigPayload{}, fmt.Errorf("admin config envelope code is %d", envelope.Code)
	}

	payload := neo4jConfigPayload{
		URI:      stringFromMap(envelope.Data, "uri"),
		User:     firstNonEmpty(stringFromMap(envelope.Data, "user"), stringFromMap(envelope.Data, "username")),
		Password: stringFromMap(envelope.Data, "password"),
		Database: stringFromMap(envelope.Data, "database"),
		Source:   firstNonEmpty(stringFromMap(envelope.Data, "source"), "admin_config"),
		Mode:     firstNonEmpty(stringFromMap(envelope.Data, "mode"), cfg.Neo4jConfigSource),
	}
	if payload.URI == "" || payload.User == "" || payload.Password == "" {
		return neo4jConfigPayload{}, fmt.Errorf("admin Neo4j config is incomplete")
	}
	if payload.Database == "" {
		payload.Database = "neo4j"
	}
	return payload, nil
}

func adminConfigURL(baseURL string) (string, error) {
	raw := strings.TrimSpace(baseURL)
	if raw == "" {
		return "", fmt.Errorf("python backend base url is empty")
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return "", fmt.Errorf("invalid python backend base url: %w", err)
	}
	if parsed.Scheme == "" || parsed.Host == "" {
		return "", fmt.Errorf("python backend base url must contain scheme and host")
	}
	parsed.Path = joinURLPath(parsed.Path, "/api/v1/admin/config/neo4j/all")
	parsed.RawQuery = ""
	return parsed.String(), nil
}

func joinURLPath(basePath, routePath string) string {
	bp := strings.TrimSuffix(basePath, "/")
	rp := routePath
	if !strings.HasPrefix(rp, "/") {
		rp = "/" + rp
	}
	if bp == "" {
		return rp
	}
	return bp + rp
}

func applyNeo4jPayload(cfg *Config, payload neo4jConfigPayload) {
	cfg.Neo4jURI = firstNonEmpty(payload.URI, cfg.Neo4jURI, "bolt://localhost:7687")
	cfg.Neo4jUser = firstNonEmpty(payload.User, cfg.Neo4jUser, "neo4j")
	cfg.Neo4jPassword = firstNonEmpty(payload.Password, cfg.Neo4jPassword, "password")
	cfg.Neo4jDatabase = firstNonEmpty(payload.Database, cfg.Neo4jDatabase, "neo4j")
	cfg.Neo4jConfigResolvedSource = firstNonEmpty(payload.Source, "env")
	cfg.Neo4jConfigResolutionErr = ""
}

func stringFromMap(values map[string]interface{}, key string) string {
	if values == nil {
		return ""
	}
	value, ok := values[key]
	if !ok || value == nil {
		return ""
	}
	switch v := value.(type) {
	case string:
		return strings.TrimSpace(v)
	default:
		return strings.TrimSpace(fmt.Sprint(v))
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}
