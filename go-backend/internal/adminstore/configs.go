package adminstore

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"
)

var ErrConfigNotFound = errors.New("admin config not found")
var ErrConfigAlreadyExists = errors.New("admin config already exists")

type ConfigItem struct {
	ID          int        `json:"id"`
	Category    string     `json:"category"`
	Key         string     `json:"key"`
	Value       string     `json:"value"`
	Description *string    `json:"description,omitempty"`
	IsSensitive bool       `json:"is_sensitive"`
	IsEncrypted bool       `json:"is_encrypted"`
	UpdatedBy   *int       `json:"updated_by,omitempty"`
	UpdatedAt   *time.Time `json:"updated_at"`
	Version     int        `json:"version"`
}

type ConfigListQuery struct {
	Category    string
	Key         string
	IsSensitive *bool
	Page        int
	PageSize    int
}

type ConfigListResult struct {
	Items []ConfigItem
	Total int
}

type ConfigMutationRequest struct {
	Category    string
	Key         string
	Value       string
	Description *string
	IsSensitive *bool
	OperatorID  *int
	TenantID    *string
	TraceID     *string
	IPAddress   *string
	UserAgent   *string
}

type ConfigBatchItem struct {
	Category string
	Key      string
	Value    string
}

type ConfigBatchUpdateRequest struct {
	Items      []ConfigBatchItem
	OperatorID *int
	TenantID   *string
	TraceID    *string
	IPAddress  *string
	UserAgent  *string
}

type ConfigInitRequest struct {
	OperatorID *int
	TenantID   *string
	TraceID    *string
	IPAddress  *string
	UserAgent  *string
}

func (c *Client) ListConfigs(ctx context.Context, query ConfigListQuery) (ConfigListResult, error) {
	if c == nil || c.db == nil {
		return ConfigListResult{}, errors.New("admin store is not initialized")
	}
	page, pageSize := normalizeConfigPagination(query.Page, query.PageSize)
	query.Page = page
	query.PageSize = pageSize
	where, args := buildConfigWhere(query)

	var total int
	if err := c.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM admin_configs c"+where, args...).Scan(&total); err != nil {
		return ConfigListResult{}, fmt.Errorf("count admin configs failed: %w", err)
	}

	listArgs := append([]interface{}{}, args...)
	limitIndex := len(listArgs) + 1
	offsetIndex := len(listArgs) + 2
	listArgs = append(listArgs, pageSize, (page-1)*pageSize)
	rows, err := c.db.QueryContext(ctx, fmt.Sprintf(`
		SELECT
			id,
			category,
			key,
			value,
			description,
			is_sensitive,
			is_encrypted,
			updated_by,
			updated_at,
			COALESCE(version, 1)
		FROM admin_configs c
		%s
		ORDER BY category ASC, key ASC
		LIMIT $%d OFFSET $%d
	`, where, limitIndex, offsetIndex), listArgs...)
	if err != nil {
		return ConfigListResult{}, fmt.Errorf("query admin configs failed: %w", err)
	}
	defer rows.Close()

	items := []ConfigItem{}
	for rows.Next() {
		item, err := scanConfigItem(rows)
		if err != nil {
			return ConfigListResult{}, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return ConfigListResult{}, fmt.Errorf("iterate admin configs failed: %w", err)
	}
	return ConfigListResult{Items: items, Total: total}, nil
}

func (c *Client) GetConfigItem(ctx context.Context, category string, key string) (ConfigItem, error) {
	if c == nil || c.db == nil {
		return ConfigItem{}, errors.New("admin store is not initialized")
	}
	category = strings.TrimSpace(category)
	key = strings.TrimSpace(key)
	if category == "" || key == "" {
		return ConfigItem{}, ErrConfigNotFound
	}
	row := c.db.QueryRowContext(ctx, `
		SELECT
			id,
			category,
			key,
			value,
			description,
			is_sensitive,
			is_encrypted,
			updated_by,
			updated_at,
			COALESCE(version, 1)
		FROM admin_configs
		WHERE category = $1 AND key = $2
		LIMIT 1
	`, category, key)
	item, err := scanConfigItem(row)
	if errors.Is(err, sql.ErrNoRows) {
		return ConfigItem{}, ErrConfigNotFound
	}
	if err != nil {
		return ConfigItem{}, err
	}
	return item, nil
}

func (c *Client) ListConfigCategory(ctx context.Context, category string) (map[string]ConfigItem, error) {
	result, err := c.ListConfigs(ctx, ConfigListQuery{Category: category, Page: 1, PageSize: 100})
	if err != nil {
		return nil, err
	}
	items := map[string]ConfigItem{}
	for _, item := range result.Items {
		items[item.Key] = item
	}
	return items, nil
}

func (c *Client) GetConfigValueMap(ctx context.Context, category string) (map[string]string, error) {
	items, err := c.ListConfigCategory(ctx, category)
	if err != nil {
		return nil, err
	}
	values := map[string]string{}
	for key, item := range items {
		values[key] = item.Value
	}
	return values, nil
}

func (c *Client) CreateConfig(ctx context.Context, req ConfigMutationRequest) (ConfigItem, error) {
	if c == nil || c.db == nil {
		return ConfigItem{}, errors.New("admin store is not initialized")
	}
	req.Category = strings.TrimSpace(req.Category)
	req.Key = strings.TrimSpace(req.Key)
	if req.Category == "" || req.Key == "" {
		return ConfigItem{}, fmt.Errorf("config category and key are required")
	}
	isSensitive := isSensitiveConfigKeyName(req.Key)
	if req.IsSensitive != nil {
		isSensitive = *req.IsSensitive
	}
	tx, err := c.db.BeginTx(ctx, nil)
	if err != nil {
		return ConfigItem{}, fmt.Errorf("begin config create transaction failed: %w", err)
	}
	defer rollbackUnlessCommitted(tx)

	var existingID int
	if err := tx.QueryRowContext(ctx, `
		SELECT id
		FROM admin_configs
		WHERE category = $1 AND key = $2
		LIMIT 1
	`, req.Category, req.Key).Scan(&existingID); err == nil {
		return ConfigItem{}, ErrConfigAlreadyExists
	} else if !errors.Is(err, sql.ErrNoRows) {
		return ConfigItem{}, fmt.Errorf("check existing admin config failed: %w", err)
	}

	row := tx.QueryRowContext(ctx, `
		INSERT INTO admin_configs (
			category,
			key,
			value,
			description,
			is_sensitive,
			is_encrypted,
			updated_by,
			version
		)
		VALUES ($1, $2, $3, $4, $5, false, $6, 1)
		RETURNING
			id,
			category,
			key,
			value,
			description,
			is_sensitive,
			is_encrypted,
			updated_by,
			updated_at,
			COALESCE(version, 1)
	`, req.Category, req.Key, req.Value, req.Description, isSensitive, req.OperatorID)
	item, err := scanConfigItem(row)
	if err != nil {
		return ConfigItem{}, fmt.Errorf("create admin config failed: %w", err)
	}
	if err := insertConfigAuditLog(ctx, tx, "create", item.ID, req, map[string]interface{}{
		"category":     req.Category,
		"key":          req.Key,
		"is_sensitive": isSensitive,
	}); err != nil {
		return ConfigItem{}, err
	}
	if err := tx.Commit(); err != nil {
		return ConfigItem{}, fmt.Errorf("commit config create transaction failed: %w", err)
	}
	return item, nil
}

func (c *Client) UpdateConfig(ctx context.Context, req ConfigMutationRequest) (ConfigItem, error) {
	if c == nil || c.db == nil {
		return ConfigItem{}, errors.New("admin store is not initialized")
	}
	req.Category = strings.TrimSpace(req.Category)
	req.Key = strings.TrimSpace(req.Key)
	if req.Category == "" || req.Key == "" {
		return ConfigItem{}, ErrConfigNotFound
	}
	tx, err := c.db.BeginTx(ctx, nil)
	if err != nil {
		return ConfigItem{}, fmt.Errorf("begin config update transaction failed: %w", err)
	}
	defer rollbackUnlessCommitted(tx)

	row := tx.QueryRowContext(ctx, `
		UPDATE admin_configs
		SET
			value = $3,
			description = COALESCE($4, description),
			updated_by = $5,
			updated_at = NOW(),
			version = COALESCE(version, 1) + 1
		WHERE category = $1 AND key = $2
		RETURNING
			id,
			category,
			key,
			value,
			description,
			is_sensitive,
			is_encrypted,
			updated_by,
			updated_at,
			COALESCE(version, 1)
	`, req.Category, req.Key, req.Value, req.Description, req.OperatorID)
	item, err := scanConfigItem(row)
	if errors.Is(err, sql.ErrNoRows) {
		isSensitive := isSensitiveConfigKeyName(req.Key)
		req.IsSensitive = &isSensitive
		item, err = createConfigInTransaction(ctx, tx, req)
		if err != nil {
			return ConfigItem{}, err
		}
		if err := insertConfigAuditLog(ctx, tx, "create", item.ID, req, map[string]interface{}{
			"category":     req.Category,
			"key":          req.Key,
			"is_sensitive": isSensitive,
			"auto_created": true,
		}); err != nil {
			return ConfigItem{}, err
		}
	} else if err != nil {
		return ConfigItem{}, fmt.Errorf("update admin config failed: %w", err)
	} else if err := insertConfigAuditLog(ctx, tx, "update", item.ID, req, map[string]interface{}{
		"category": req.Category,
		"key":      req.Key,
	}); err != nil {
		return ConfigItem{}, err
	}
	if err := tx.Commit(); err != nil {
		return ConfigItem{}, fmt.Errorf("commit config update transaction failed: %w", err)
	}
	return item, nil
}

func (c *Client) DeleteConfig(ctx context.Context, req ConfigMutationRequest) error {
	if c == nil || c.db == nil {
		return errors.New("admin store is not initialized")
	}
	req.Category = strings.TrimSpace(req.Category)
	req.Key = strings.TrimSpace(req.Key)
	if req.Category == "" || req.Key == "" {
		return ErrConfigNotFound
	}
	tx, err := c.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin config delete transaction failed: %w", err)
	}
	defer rollbackUnlessCommitted(tx)

	var configID int
	if err := tx.QueryRowContext(ctx, `
		DELETE FROM admin_configs
		WHERE category = $1 AND key = $2
		RETURNING id
	`, req.Category, req.Key).Scan(&configID); errors.Is(err, sql.ErrNoRows) {
		return ErrConfigNotFound
	} else if err != nil {
		return fmt.Errorf("delete admin config failed: %w", err)
	}
	if err := insertConfigAuditLog(ctx, tx, "delete", configID, req, map[string]interface{}{
		"category": req.Category,
		"key":      req.Key,
	}); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit config delete transaction failed: %w", err)
	}
	return nil
}

func (c *Client) BatchUpdateConfigs(ctx context.Context, req ConfigBatchUpdateRequest) (int, error) {
	if c == nil || c.db == nil {
		return 0, errors.New("admin store is not initialized")
	}
	tx, err := c.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("begin config batch transaction failed: %w", err)
	}
	defer rollbackUnlessCommitted(tx)

	updatedCount := 0
	for _, item := range req.Items {
		category := strings.TrimSpace(item.Category)
		key := strings.TrimSpace(item.Key)
		if category == "" || key == "" {
			continue
		}
		result, err := tx.ExecContext(ctx, `
			UPDATE admin_configs
			SET
				value = $3,
				updated_by = $4,
				updated_at = NOW(),
				version = COALESCE(version, 1) + 1
			WHERE category = $1 AND key = $2
		`, category, key, item.Value, req.OperatorID)
		if err != nil {
			return 0, fmt.Errorf("batch update admin config failed: %w", err)
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return 0, fmt.Errorf("read batch config rows affected failed: %w", err)
		}
		if affected > 0 {
			updatedCount++
		}
	}
	if err := insertConfigAuditLog(ctx, tx, "batch_update", 0, ConfigMutationRequest{
		OperatorID: req.OperatorID,
		TenantID:   req.TenantID,
		TraceID:    req.TraceID,
		IPAddress:  req.IPAddress,
		UserAgent:  req.UserAgent,
	}, map[string]interface{}{
		"count": updatedCount,
		"total": len(req.Items),
	}); err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("commit config batch transaction failed: %w", err)
	}
	return updatedCount, nil
}

func (c *Client) InitConfigsFromEnv(ctx context.Context, req ConfigInitRequest) (int, error) {
	if c == nil || c.db == nil {
		return 0, errors.New("admin store is not initialized")
	}
	tx, err := c.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("begin config init transaction failed: %w", err)
	}
	defer rollbackUnlessCommitted(tx)

	items := defaultEnvConfigItems()
	count := 0
	for _, item := range items {
		mutation := ConfigMutationRequest{
			Category:    item.Category,
			Key:         item.Key,
			Value:       item.Value,
			IsSensitive: boolPtr(isSensitiveConfigKeyName(item.Key)),
			OperatorID:  req.OperatorID,
			TenantID:    req.TenantID,
			TraceID:     req.TraceID,
			IPAddress:   req.IPAddress,
			UserAgent:   req.UserAgent,
		}
		if _, err := upsertConfigInTransaction(ctx, tx, mutation); err != nil {
			return 0, err
		}
		count++
	}
	if err := insertConfigAuditLog(ctx, tx, "init_config", 0, ConfigMutationRequest{
		OperatorID: req.OperatorID,
		TenantID:   req.TenantID,
		TraceID:    req.TraceID,
		IPAddress:  req.IPAddress,
		UserAgent:  req.UserAgent,
	}, map[string]interface{}{
		"count": count,
	}); err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("commit config init transaction failed: %w", err)
	}
	return count, nil
}

type configRowScanner interface {
	Scan(dest ...interface{}) error
}

func scanConfigItem(scanner configRowScanner) (ConfigItem, error) {
	var item ConfigItem
	var description sql.NullString
	var updatedBy sql.NullInt64
	var updatedAt sql.NullTime
	if err := scanner.Scan(
		&item.ID,
		&item.Category,
		&item.Key,
		&item.Value,
		&description,
		&item.IsSensitive,
		&item.IsEncrypted,
		&updatedBy,
		&updatedAt,
		&item.Version,
	); err != nil {
		return ConfigItem{}, err
	}
	item.Description = stringPtrFromNull(description)
	item.UpdatedBy = intPtrFromNull(updatedBy)
	if updatedAt.Valid {
		value := updatedAt.Time
		item.UpdatedAt = &value
	}
	if item.IsSensitive || isSensitiveConfigKeyName(item.Key) {
		item.Value = ""
		item.IsSensitive = true
	}
	return item, nil
}

func buildConfigWhere(query ConfigListQuery) (string, []interface{}) {
	clauses := []string{}
	args := []interface{}{}
	if category := strings.TrimSpace(query.Category); category != "" {
		args = append(args, category)
		clauses = append(clauses, fmt.Sprintf("c.category = $%d", len(args)))
	}
	if key := strings.TrimSpace(query.Key); key != "" {
		args = append(args, "%"+key+"%")
		clauses = append(clauses, fmt.Sprintf("c.key LIKE $%d", len(args)))
	}
	if query.IsSensitive != nil {
		args = append(args, *query.IsSensitive)
		clauses = append(clauses, fmt.Sprintf("c.is_sensitive = $%d", len(args)))
	}
	if len(clauses) == 0 {
		return "", args
	}
	return " WHERE " + strings.Join(clauses, " AND "), args
}

func normalizeConfigPagination(page int, pageSize int) (int, int) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 10
	}
	if pageSize > 100 {
		pageSize = 100
	}
	return page, pageSize
}

func isSensitiveConfigKeyName(key string) bool {
	normalized := strings.ToLower(strings.TrimSpace(key))
	if strings.HasSuffix(normalized, "_configured") {
		return false
	}
	return strings.Contains(normalized, "password") ||
		strings.Contains(normalized, "secret") ||
		strings.Contains(normalized, "token") ||
		strings.Contains(normalized, "key")
}

func createConfigInTransaction(ctx context.Context, tx *sql.Tx, req ConfigMutationRequest) (ConfigItem, error) {
	isSensitive := isSensitiveConfigKeyName(req.Key)
	if req.IsSensitive != nil {
		isSensitive = *req.IsSensitive
	}
	row := tx.QueryRowContext(ctx, `
		INSERT INTO admin_configs (
			category,
			key,
			value,
			description,
			is_sensitive,
			is_encrypted,
			updated_by,
			version
		)
		VALUES ($1, $2, $3, $4, $5, false, $6, 1)
		RETURNING
			id,
			category,
			key,
			value,
			description,
			is_sensitive,
			is_encrypted,
			updated_by,
			updated_at,
			COALESCE(version, 1)
	`, req.Category, req.Key, req.Value, req.Description, isSensitive, req.OperatorID)
	item, err := scanConfigItem(row)
	if err != nil {
		return ConfigItem{}, fmt.Errorf("create admin config failed: %w", err)
	}
	return item, nil
}

func upsertConfigInTransaction(ctx context.Context, tx *sql.Tx, req ConfigMutationRequest) (ConfigItem, error) {
	row := tx.QueryRowContext(ctx, `
		INSERT INTO admin_configs (
			category,
			key,
			value,
			description,
			is_sensitive,
			is_encrypted,
			updated_by,
			version
		)
		VALUES ($1, $2, $3, $4, $5, false, $6, 1)
		ON CONFLICT (category, key)
		DO UPDATE SET
			value = EXCLUDED.value,
			description = COALESCE(EXCLUDED.description, admin_configs.description),
			is_sensitive = EXCLUDED.is_sensitive,
			updated_by = EXCLUDED.updated_by,
			updated_at = NOW(),
			version = COALESCE(admin_configs.version, 1) + 1
		RETURNING
			id,
			category,
			key,
			value,
			description,
			is_sensitive,
			is_encrypted,
			updated_by,
			updated_at,
			COALESCE(version, 1)
	`, req.Category, req.Key, req.Value, req.Description, derefBool(req.IsSensitive), req.OperatorID)
	item, err := scanConfigItem(row)
	if err != nil {
		return ConfigItem{}, fmt.Errorf("upsert admin config failed: %w", err)
	}
	return item, nil
}

func insertConfigAuditLog(ctx context.Context, tx *sql.Tx, action string, configID int, req ConfigMutationRequest, details map[string]interface{}) error {
	encodedDetails, err := json.Marshal(details)
	if err != nil {
		return fmt.Errorf("encode config audit details failed: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO admin_logs (
			user_id,
			operator_id,
			tenant_id,
			trace_id,
			action,
			resource,
			resource_id,
			details,
			ip_address,
			user_agent,
			status
		)
		VALUES ($1, $1, $2, $3, $4, 'config', $5, $6, $7, $8, 'success')
	`, req.OperatorID, req.TenantID, req.TraceID, action, fmt.Sprintf("%d", configID), string(encodedDetails), req.IPAddress, req.UserAgent); err != nil {
		return fmt.Errorf("insert config audit log failed: %w", err)
	}
	return nil
}

func defaultEnvConfigItems() []ConfigBatchItem {
	return []ConfigBatchItem{
		{Category: "neo4j", Key: "uri", Value: envString("NEO4J_URI", "bolt://localhost:7687")},
		{Category: "neo4j", Key: "user", Value: envString("NEO4J_USER", envString("NEO4J_USERNAME", "neo4j"))},
		{Category: "neo4j", Key: "password", Value: envString("NEO4J_PASSWORD", "password")},
		{Category: "neo4j", Key: "database", Value: envString("NEO4J_DATABASE", "neo4j")},
		{Category: "ai_service", Key: "provider", Value: envString("AI_SERVICE_PROVIDER", envString("OPENAI_PROVIDER", "openai"))},
		{Category: "ai_service", Key: "enabled", Value: envString("AI_SERVICE_ENABLED", "true")},
		{Category: "ai_service", Key: "api_key", Value: envString("AI_SERVICE_API_KEY", envString("OPENAI_API_KEY", ""))},
		{Category: "ai_service", Key: "base_url", Value: envString("AI_SERVICE_BASE_URL", envString("OPENAI_BASE_URL", ""))},
		{Category: "ai_service", Key: "model", Value: envString("AI_SERVICE_MODEL", envString("OPENAI_MODEL", "gpt-3.5-turbo"))},
		{Category: "ai_service", Key: "docqa_reasoning_profile", Value: envString("AI_SERVICE_DOCQA_REASONING_PROFILE", "balanced")},
		{Category: "ai_service", Key: "deep_research_reasoning_profile", Value: envString("AI_SERVICE_DEEP_RESEARCH_REASONING_PROFILE", "deep")},
		{Category: "ai_service", Key: "model_probe_reasoning_profile", Value: envString("AI_SERVICE_MODEL_PROBE_REASONING_PROFILE", "fast")},
		{Category: "ai_service", Key: "max_tokens", Value: envString("AI_SERVICE_MAX_TOKENS", envString("OPENAI_MAX_TOKENS", "2000"))},
		{Category: "ai_service", Key: "temperature", Value: envString("AI_SERVICE_TEMPERATURE", envString("OPENAI_TEMPERATURE", "0.7"))},
	}
}

func envString(key string, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}

func boolPtr(value bool) *bool {
	return &value
}

func derefBool(value *bool) bool {
	if value == nil {
		return false
	}
	return *value
}

func rollbackUnlessCommitted(tx *sql.Tx) {
	if tx != nil {
		_ = tx.Rollback()
	}
}
