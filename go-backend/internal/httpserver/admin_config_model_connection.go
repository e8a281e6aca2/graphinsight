package httpserver

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"graphinsight/go-backend/internal/config"
	"github.com/neo4j/neo4j-go-driver/v5/neo4j"
)

type adminModelConnectionSnapshotStore struct {
	mu      sync.RWMutex
	payload interface{}
}

func (s *adminModelConnectionSnapshotStore) Get() interface{} {
	if s == nil {
		return nil
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.payload
}

func (s *adminModelConnectionSnapshotStore) Set(payload interface{}) {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.payload = payload
}

func buildAdminModelConnectionLatestNativeHandler(guard businessPermissionGuard, snapshots *adminModelConnectionSnapshotStore) http.HandlerFunc {
	return withRouteOwner("go-native", guard.wrap("config:read", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			WriteJSON(w, http.StatusMethodNotAllowed, "Method not allowed", nil)
			return
		}
		WriteJSON(w, http.StatusOK, "获取成功", snapshots.Get())
	}))
}

type adminConfigConnectionGraphService interface {
	CheckHealth(ctx context.Context) error
}

var adminNeo4jConnectionProbe = func(ctx context.Context, uri string, user string, password string, database string) error {
	driver, driverErr := neo4j.NewDriverWithContext(
		uri,
		neo4j.BasicAuth(user, password, ""),
		func(c *neo4j.Config) {
			c.MaxConnectionPoolSize = 2
			c.SocketConnectTimeout = 3 * time.Second
		},
	)
	if driverErr != nil {
		return driverErr
	}
	defer driver.Close(ctx)

	if verifyErr := driver.VerifyConnectivity(ctx); verifyErr != nil {
		return verifyErr
	}

	session := driver.NewSession(ctx, neo4j.SessionConfig{
		DatabaseName: firstNonEmptyString(database, "neo4j"),
	})
	defer session.Close(ctx)
	_, runErr := session.Run(ctx, "RETURN 1 AS ok", nil)
	return runErr
}

func buildAdminConfigConnectionTestHandler(
	cfg config.Config,
	logger *slog.Logger,
	guard businessPermissionGuard,
	configStore adminConfigStore,
	graphSvc adminConfigConnectionGraphService,
	graphInitErr error,
	snapshots *adminModelConnectionSnapshotStore,
) http.HandlerFunc {
	return withRouteOwner("go-native", func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/api/v1/admin/config/test/model" && r.Method == http.MethodPost:
			buildAdminModelConnectionTestNativeHandler(cfg, logger, guard, configStore, snapshots)(w, r)
			return
		case r.URL.Path == "/api/v1/admin/config/test/neo4j" && r.Method == http.MethodPost:
			buildAdminNeo4jConnectionTestNativeHandler(cfg, logger, guard, configStore, graphSvc, graphInitErr)(w, r)
			return
		case (r.URL.Path == "/api/v1/admin/config/test/ai_service" || r.URL.Path == "/api/v1/admin/config/test/openai") && r.Method == http.MethodPost:
			buildAdminAIServiceConnectionTestNativeHandler(cfg, logger, guard, configStore)(w, r)
			return
		case strings.HasPrefix(r.URL.Path, "/api/v1/admin/config/test/") && r.Method == http.MethodPost:
			buildAdminUnsupportedConnectionTestNativeHandler(guard)(w, r)
			return
		case strings.HasPrefix(r.URL.Path, "/api/v1/admin/config/test/"):
			WriteJSON(w, http.StatusMethodNotAllowed, "Method not allowed", nil)
			return
		default:
			WriteJSON(w, http.StatusNotFound, "资源不存在", map[string]string{"error_code": "NOT_FOUND"})
		}
	})
}

func buildAdminNeo4jConnectionTestNativeHandler(
	cfg config.Config,
	logger *slog.Logger,
	guard businessPermissionGuard,
	configStore adminConfigStore,
	graphSvc adminConfigConnectionGraphService,
	graphInitErr error,
) http.HandlerFunc {
	return withRouteOwner("go-native", guard.wrap("config:write", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			WriteJSON(w, http.StatusMethodNotAllowed, "Method not allowed", nil)
			return
		}

		uri := cfg.Neo4jURI
		user := cfg.Neo4jUser
		password := cfg.Neo4jPassword
		database := cfg.Neo4jDatabase
		if configStore != nil {
			values, err := safeConfigValues(r.Context(), configStore, "neo4j")
			if err != nil {
				logger.Warn("resolve neo4j config values for test failed", "error", err.Error())
			} else {
				snapshot := buildAdminNeo4jConfigSnapshot(cfg, values)
				if value, ok := snapshot["uri"].(string); ok && value != "" {
					uri = value
				}
				if value, ok := snapshot["user"].(string); ok && value != "" {
					user = value
				}
				if value, ok := values["password"]; ok && strings.TrimSpace(value) != "" {
					password = strings.TrimSpace(value)
				}
				if value, ok := snapshot["database"].(string); ok && value != "" {
					database = value
				}
			}
		}

		probeCtx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
		defer cancel()

		var err error
		switch {
		case strings.TrimSpace(uri) == "":
			err = fmt.Errorf("neo4j uri is empty")
		case strings.TrimSpace(user) == "":
			err = fmt.Errorf("neo4j user is empty")
		case strings.TrimSpace(password) == "":
			err = fmt.Errorf("neo4j password is empty")
		default:
			err = adminNeo4jConnectionProbe(probeCtx, uri, user, password, database)
		}

		if err != nil {
			WriteJSON(w, http.StatusOK, "测试完成", map[string]interface{}{
				"success": false,
				"message": fmt.Sprintf("Neo4j 连接失败: %s", err.Error()),
			})
			return
		}

		WriteJSON(w, http.StatusOK, "测试完成", map[string]interface{}{
			"success": true,
			"message": fmt.Sprintf("Neo4j 连接成功 (%s)", uri),
		})
	}))
}

func buildAdminAIServiceConnectionTestNativeHandler(
	cfg config.Config,
	logger *slog.Logger,
	guard businessPermissionGuard,
	configStore adminConfigStore,
) http.HandlerFunc {
	return withRouteOwner("go-native", guard.wrap("config:write", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			WriteJSON(w, http.StatusMethodNotAllowed, "Method not allowed", nil)
			return
		}

		values := map[string]string{}
		if configStore != nil {
			resolved, err := safeConfigValues(r.Context(), configStore, "ai_service")
			if err != nil {
				logger.Warn("resolve ai service config values for test failed", "error", err.Error())
			} else {
				values = resolved
			}
		}
		snapshot := buildAdminAIServiceConfigSnapshot(cfg, values)
		provider, _ := snapshot["provider"].(string)
		enabled, _ := snapshot["enabled"].(bool)
		apiKeyConfigured, _ := snapshot["api_key_configured"].(bool)
		baseURL, _ := snapshot["base_url"].(string)

		if !enabled {
			WriteJSON(w, http.StatusOK, "测试完成", map[string]interface{}{
				"success": false,
				"message": "AI服务未启用",
			})
			return
		}
		if !apiKeyConfigured {
			WriteJSON(w, http.StatusOK, "测试完成", map[string]interface{}{
				"success": false,
				"message": fmt.Sprintf("%s API Key 未配置", strings.ToUpper(provider)),
			})
			return
		}

		switch provider {
		case "openai":
			apiKey := strings.TrimSpace(values["api_key"])
			if apiKey == "" {
				apiKey = strings.TrimSpace(cfg.AIAPIKey)
			}
			if !strings.HasPrefix(apiKey, "sk-") {
				WriteJSON(w, http.StatusOK, "测试完成", map[string]interface{}{
					"success": false,
					"message": "OpenAI API Key 格式不正确（应以 sk- 开头）",
				})
				return
			}
			WriteJSON(w, http.StatusOK, "测试完成", map[string]interface{}{
				"success": true,
				"message": "OpenAI API Key 格式正确",
			})
			return
		case "claude":
			apiKey := strings.TrimSpace(values["api_key"])
			if apiKey == "" {
				apiKey = strings.TrimSpace(cfg.AIAPIKey)
			}
			if !strings.HasPrefix(apiKey, "sk-ant-") {
				WriteJSON(w, http.StatusOK, "测试完成", map[string]interface{}{
					"success": false,
					"message": "Claude API Key 格式不正确（应以 sk-ant- 开头）",
				})
				return
			}
			WriteJSON(w, http.StatusOK, "测试完成", map[string]interface{}{
				"success": true,
				"message": "Claude API Key 格式正确",
			})
			return
		case "openai_compatible":
			if strings.TrimSpace(baseURL) == "" {
				WriteJSON(w, http.StatusOK, "测试完成", map[string]interface{}{
					"success": false,
					"message": "OpenAI 兼容接口需要配置 API 地址",
				})
				return
			}
			WriteJSON(w, http.StatusOK, "测试完成", map[string]interface{}{
				"success": true,
				"message": fmt.Sprintf("OpenAI 兼容接口已配置 (API: %s)", baseURL),
			})
			return
		default:
			WriteJSON(w, http.StatusOK, "测试完成", map[string]interface{}{
				"success": true,
				"message": fmt.Sprintf("%s API Key 已配置", strings.ToUpper(provider)),
			})
			return
		}
	}))
}

func buildAdminModelConnectionTestNativeHandler(
	cfg config.Config,
	logger *slog.Logger,
	guard businessPermissionGuard,
	configStore adminConfigStore,
	snapshots *adminModelConnectionSnapshotStore,
) http.HandlerFunc {
	return withRouteOwner("go-native", guard.wrap("config:write", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			WriteJSON(w, http.StatusMethodNotAllowed, "Method not allowed", nil)
			return
		}

		values := map[string]string{}
		if configStore != nil {
			resolved, err := safeConfigValues(r.Context(), configStore, "ai_service")
			if err != nil {
				logger.Warn("resolve ai service config values for model test failed", "error", err.Error())
			} else {
				values = resolved
			}
		}
		snapshot := buildAdminAIServiceConfigSnapshot(cfg, values)
		provider, _ := snapshot["provider"].(string)
		enabled, _ := snapshot["enabled"].(bool)
		baseURL, _ := snapshot["base_url"].(string)
		model, _ := snapshot["model"].(string)
		apiKey := strings.TrimSpace(values["api_key"])
		if apiKey == "" {
			apiKey = strings.TrimSpace(cfg.AIAPIKey)
		}
		reasoningProfile := firstNonEmptyString(values["model_probe_reasoning_profile"], os.Getenv("AI_SERVICE_MODEL_PROBE_REASONING_PROFILE"), "fast")

		checkedAt := time.Now().UTC().Format(time.RFC3339)
		startedAt := time.Now()
		checks := make([]map[string]interface{}, 0, 4)
		finish := func(result map[string]interface{}) {
			result["checked_at"] = checkedAt
			result["latency_ms"] = float64(time.Since(startedAt).Microseconds()) / 1000
			result["checks"] = checks
			snapshots.Set(result)
			WriteJSON(w, http.StatusOK, "测试完成", result)
		}

		if !enabled {
			checks = append(checks, map[string]interface{}{"name": "enabled", "success": false, "message": "AI 服务未启用"})
			finish(map[string]interface{}{
				"success":  false,
				"message":  "AI 服务未启用",
				"provider": provider,
				"model":    model,
				"reasoning_profile": reasoningProfile,
				"base_url": baseURL,
				"endpoint": nil,
			})
			return
		}
		checks = append(checks, map[string]interface{}{"name": "enabled", "success": true, "message": "AI 服务已启用"})

		if apiKey == "" || apiKey == "your-api-key-here" {
			checks = append(checks, map[string]interface{}{"name": "api_key", "success": false, "message": "API Key 未配置"})
			finish(map[string]interface{}{
				"success":  false,
				"message":  "API Key 未配置",
				"provider": provider,
				"model":    model,
				"reasoning_profile": reasoningProfile,
				"base_url": baseURL,
				"endpoint": nil,
			})
			return
		}
		checks = append(checks, map[string]interface{}{"name": "api_key", "success": true, "message": "API Key 已配置"})

		if strings.TrimSpace(model) == "" {
			checks = append(checks, map[string]interface{}{"name": "model", "success": false, "message": "模型未配置"})
			finish(map[string]interface{}{
				"success":  false,
				"message":  "模型未配置",
				"provider": provider,
				"model":    model,
				"reasoning_profile": reasoningProfile,
				"base_url": baseURL,
				"endpoint": nil,
			})
			return
		}
		checks = append(checks, map[string]interface{}{"name": "model", "success": true, "message": fmt.Sprintf("当前模型: %s", model)})

		endpoint := buildChatCompletionURL(baseURL)
		headers := map[string]string{
			"Authorization": fmt.Sprintf("Bearer %s", apiKey),
			"Content-Type":  "application/json",
		}
		payload := map[string]interface{}{
			"model": model,
			"messages": []map[string]string{
				{"role": "user", "content": "Reply with ok."},
			},
			"max_tokens":  8,
			"temperature": 0,
		}
		if provider == "claude" {
			endpoint = buildClaudeMessagesURL(baseURL)
			headers = map[string]string{
				"x-api-key":         apiKey,
				"anthropic-version": "2023-06-01",
				"Content-Type":      "application/json",
			}
			payload = map[string]interface{}{
				"model":      model,
				"max_tokens": 8,
				"messages": []map[string]string{
					{"role": "user", "content": "Reply with ok."},
				},
			}
		}

		body, err := json.Marshal(payload)
		if err != nil {
			checks = append(checks, map[string]interface{}{"name": "probe", "success": false, "message": err.Error()})
			finish(map[string]interface{}{
				"success":  false,
				"message":  fmt.Sprintf("模型连通性测试失败: %s", err.Error()),
				"provider": provider,
				"model":    model,
				"reasoning_profile": reasoningProfile,
				"base_url": defaultModelBaseURL(provider, baseURL),
				"endpoint": endpoint,
			})
			return
		}

		probeStarted := time.Now()
		req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, endpoint, bytes.NewReader(body))
		if err != nil {
			checks = append(checks, map[string]interface{}{"name": "probe", "success": false, "message": err.Error()})
			finish(map[string]interface{}{
				"success":  false,
				"message":  fmt.Sprintf("模型连通性测试失败: %s", err.Error()),
				"provider": provider,
				"model":    model,
				"reasoning_profile": reasoningProfile,
				"base_url": defaultModelBaseURL(provider, baseURL),
				"endpoint": endpoint,
			})
			return
		}
		for key, value := range headers {
			req.Header.Set(key, value)
		}

		client := &http.Client{Timeout: 20 * time.Second}
		resp, err := client.Do(req)
		if err != nil {
			checks = append(checks, map[string]interface{}{"name": "probe", "success": false, "message": err.Error()})
			finish(map[string]interface{}{
				"success":  false,
				"message":  fmt.Sprintf("模型连通性测试失败: %s", err.Error()),
				"provider": provider,
				"model":    model,
				"reasoning_profile": reasoningProfile,
				"base_url": defaultModelBaseURL(provider, baseURL),
				"endpoint": endpoint,
			})
			return
		}
		defer resp.Body.Close()

		requestMS := float64(time.Since(probeStarted).Microseconds()) / 1000
		if resp.StatusCode < http.StatusBadRequest {
			checks = append(checks, map[string]interface{}{
				"name":       "probe",
				"success":    true,
				"message":    fmt.Sprintf("模型探测成功，HTTP %d", resp.StatusCode),
				"latency_ms": requestMS,
			})
			finish(map[string]interface{}{
				"success":  true,
				"message":  "模型连通性测试成功",
				"provider": provider,
				"model":    model,
				"reasoning_profile": reasoningProfile,
				"base_url": defaultModelBaseURL(provider, baseURL),
				"endpoint": endpoint,
			})
			return
		}

		checks = append(checks, map[string]interface{}{
			"name":       "probe",
			"success":    false,
			"message":    fmt.Sprintf("模型探测失败，HTTP %d", resp.StatusCode),
			"latency_ms": requestMS,
		})
		finish(map[string]interface{}{
			"success":  false,
			"message":  fmt.Sprintf("模型探测失败，HTTP %d", resp.StatusCode),
			"provider": provider,
			"model":    model,
			"reasoning_profile": reasoningProfile,
			"base_url": defaultModelBaseURL(provider, baseURL),
			"endpoint": endpoint,
		})
	}))
}

func buildAdminUnsupportedConnectionTestNativeHandler(guard businessPermissionGuard) http.HandlerFunc {
	return withRouteOwner("go-native", guard.wrap("config:write", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			WriteJSON(w, http.StatusMethodNotAllowed, "Method not allowed", nil)
			return
		}
		serviceType := strings.TrimPrefix(r.URL.Path, "/api/v1/admin/config/test/")
		WriteJSON(w, http.StatusBadRequest, fmt.Sprintf("不支持的服务类型: %s", serviceType), nil)
	}))
}

func buildChatCompletionURL(baseURL string) string {
	normalized := strings.TrimSpace(strings.TrimRight(baseURL, "/"))
	if normalized == "" {
		return "https://api.openai.com/v1/chat/completions"
	}
	if strings.HasSuffix(normalized, "/chat/completions") {
		return normalized
	}
	if strings.HasSuffix(normalized, "/v1") || strings.Contains(normalized, "/v1/") {
		return normalized + "/chat/completions"
	}
	return normalized + "/v1/chat/completions"
}

func buildClaudeMessagesURL(baseURL string) string {
	normalized := strings.TrimSpace(strings.TrimRight(baseURL, "/"))
	if normalized == "" {
		return "https://api.anthropic.com/v1/messages"
	}
	if strings.HasSuffix(normalized, "/messages") {
		return normalized
	}
	if strings.HasSuffix(normalized, "/v1") || strings.Contains(normalized, "/v1/") {
		return normalized + "/messages"
	}
	return normalized + "/v1/messages"
}

func defaultModelBaseURL(provider string, baseURL string) string {
	trimmed := strings.TrimSpace(baseURL)
	if trimmed != "" {
		return trimmed
	}
	if provider == "claude" {
		return "https://api.anthropic.com/v1"
	}
	return "https://api.openai.com/v1"
}

func extractAdminModelConnectionSnapshot(body []byte) (map[string]interface{}, bool) {
	var decoded map[string]interface{}
	if err := json.Unmarshal(body, &decoded); err != nil {
		return nil, false
	}
	data, ok := decoded["data"].(map[string]interface{})
	if !ok {
		return nil, false
	}
	if _, exists := data["checked_at"]; !exists {
		data["checked_at"] = time.Now().UTC().Format(time.RFC3339)
	}
	return data, true
}
