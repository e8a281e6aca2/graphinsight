package config

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
)

type neo4jConfigPayload struct {
	URI      string
	User     string
	Password string
	Database string
	Source   string
	Mode     string
}

type adminConfigValueReader interface {
	GetValue(ctx context.Context, category string, key string) (string, error)
}

// ResolveNeo4jConfig returns a copy of cfg with Neo4j fields resolved from
// env, admin database config, or admin-with-env-fallback depending on NEO4J_CONFIG_SOURCE.
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
	rawURL := strings.TrimSpace(cfg.AdminDatabaseURL)
	if rawURL == "" {
		return neo4jConfigPayload{}, fmt.Errorf("ADMIN_DATABASE_URL is required when reading admin Neo4j config")
	}

	db, err := sql.Open("pgx", rawURL)
	if err != nil {
		return neo4jConfigPayload{}, fmt.Errorf("open admin database failed: %w", err)
	}
	defer db.Close()

	db.SetMaxOpenConns(2)
	db.SetMaxIdleConns(1)
	db.SetConnMaxLifetime(5 * time.Minute)

	return fetchAdminNeo4jConfigFromReader(ctx, sqlAdminConfigReader{db: db}, cfg)
}

func fetchAdminNeo4jConfigFromReader(ctx context.Context, reader adminConfigValueReader, cfg Config) (neo4jConfigPayload, error) {
	uri, err := readAdminConfigValue(ctx, reader, "neo4j", "uri")
	if err != nil {
		return neo4jConfigPayload{}, err
	}
	user, err := readAdminConfigValue(ctx, reader, "neo4j", "user")
	if err != nil {
		return neo4jConfigPayload{}, err
	}
	username, err := readAdminConfigValue(ctx, reader, "neo4j", "username")
	if err != nil {
		return neo4jConfigPayload{}, err
	}
	password, err := readAdminConfigValue(ctx, reader, "neo4j", "password")
	if err != nil {
		return neo4jConfigPayload{}, err
	}
	database, err := readAdminConfigValue(ctx, reader, "neo4j", "database")
	if err != nil {
		return neo4jConfigPayload{}, err
	}

	payload := neo4jConfigPayload{
		URI:      firstNonEmpty(uri, cfg.Neo4jURI),
		User:     firstNonEmpty(user, username, cfg.Neo4jUser),
		Password: firstNonEmpty(password, cfg.Neo4jPassword),
		Database: firstNonEmpty(database, cfg.Neo4jDatabase, "neo4j"),
		Source:   "admin_db",
		Mode:     cfg.Neo4jConfigSource,
	}
	if payload.URI == "" || payload.User == "" || payload.Password == "" {
		return neo4jConfigPayload{}, fmt.Errorf("admin Neo4j config is incomplete")
	}
	return payload, nil
}

type sqlAdminConfigReader struct {
	db *sql.DB
}

func (r sqlAdminConfigReader) GetValue(ctx context.Context, category string, key string) (string, error) {
	if r.db == nil {
		return "", nil
	}
	var value sql.NullString
	err := r.db.QueryRowContext(ctx, `
		SELECT value
		FROM admin_configs
		WHERE category = $1 AND key = $2
		ORDER BY id DESC
		LIMIT 1
	`, category, key).Scan(&value)
	if err != nil {
		if err == sql.ErrNoRows {
			return "", nil
		}
		return "", err
	}
	if !value.Valid {
		return "", nil
	}
	return strings.TrimSpace(value.String), nil
}

func readAdminConfigValue(ctx context.Context, reader adminConfigValueReader, category string, key string) (string, error) {
	if reader == nil {
		return "", nil
	}
	value, err := reader.GetValue(ctx, category, key)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(value), nil
}

func applyNeo4jPayload(cfg *Config, payload neo4jConfigPayload) {
	cfg.Neo4jURI = firstNonEmpty(payload.URI, cfg.Neo4jURI, "bolt://localhost:7687")
	cfg.Neo4jUser = firstNonEmpty(payload.User, cfg.Neo4jUser, "neo4j")
	cfg.Neo4jPassword = firstNonEmpty(payload.Password, cfg.Neo4jPassword, "password")
	cfg.Neo4jDatabase = firstNonEmpty(payload.Database, cfg.Neo4jDatabase, "neo4j")
	cfg.Neo4jConfigResolvedSource = firstNonEmpty(payload.Source, "env")
	cfg.Neo4jConfigResolutionErr = ""
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}
