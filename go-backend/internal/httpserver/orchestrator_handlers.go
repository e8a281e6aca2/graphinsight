package httpserver

import (
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"graphinsight/go-backend/internal/orchestrator"
)

func buildOrchestratorHandler(
	logger *slog.Logger,
	client *orchestrator.Client,
	clientErr error,
	metrics *orchestratorMetrics,
	safeRetry bool,
	method string,
	path string,
) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		markRouteOwner(w, "go-orchestrator")
		start := time.Now()
		recorded := false
		record := func(status int, err error) {
			if recorded {
				return
			}
			recorded = true
			metrics.Observe(path, method, status, err, time.Since(start))
		}

		if r.Method != method {
			record(http.StatusMethodNotAllowed, nil)
			WriteJSON(w, http.StatusMethodNotAllowed, "Method not allowed", nil)
			return
		}
		if client == nil {
			record(http.StatusServiceUnavailable, clientErr)
			logger.Error("orchestrator unavailable", "path", r.URL.Path, "init_error", clientErr)
			WriteJSON(w, http.StatusServiceUnavailable, "上游服务不可用", map[string]interface{}{
				"error_code": "UPSTREAM_UNAVAILABLE",
				"upstream":   "python-backend",
			})
			return
		}

		body, err := io.ReadAll(r.Body)
		if err != nil {
			record(http.StatusBadRequest, err)
			WriteJSON(w, http.StatusBadRequest, "无效请求体", map[string]interface{}{"error_code": "INVALID_REQUEST"})
			return
		}

		status, forwardErr := forwardOrchestratorJSON(w, r, logger, client, path, body, safeRetry)
		record(status, forwardErr)
	}
}

func buildOrchestratorIdempotentJSONHandler(
	logger *slog.Logger,
	client *orchestrator.Client,
	clientErr error,
	store *idempotencyStore,
	metrics *orchestratorMetrics,
	upstreamTimeout time.Duration,
	method string,
	path string,
) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		markRouteOwner(w, "go-orchestrator")
		start := time.Now()
		recorded := false
		record := func(status int, err error) {
			if recorded {
				return
			}
			recorded = true
			metrics.Observe(path, method, status, err, time.Since(start))
		}

		if r.Method != method {
			record(http.StatusMethodNotAllowed, nil)
			WriteJSON(w, http.StatusMethodNotAllowed, "Method not allowed", nil)
			return
		}
		if client == nil {
			record(http.StatusServiceUnavailable, clientErr)
			logger.Error("orchestrator unavailable", "path", r.URL.Path, "init_error", clientErr)
			WriteJSON(w, http.StatusServiceUnavailable, "上游服务不可用", map[string]interface{}{
				"error_code": "UPSTREAM_UNAVAILABLE",
				"upstream":   "python-backend",
			})
			return
		}

		body, err := io.ReadAll(r.Body)
		if err != nil {
			record(http.StatusBadRequest, err)
			WriteJSON(w, http.StatusBadRequest, "无效请求体", map[string]interface{}{"error_code": "INVALID_REQUEST"})
			return
		}

		idempotencyKey := getIdempotencyKey(r)
		status, respBody, execErr := store.execute(r.Context(), idempotencyKey, body, func() (int, []byte, error) {
			headers := buildForwardHeaders(r)
			if strings.TrimSpace(idempotencyKey) != "" {
				headers["x-idempotency-key"] = idempotencyKey
			}
			return client.DoJSONWithOptions(
				r.Context(),
				r.Method,
				path,
				r.URL.RawQuery,
				body,
				headers,
				orchestrator.RequestOptions{Timeout: upstreamTimeout},
			)
		})
		if execErr != nil {
			if errors.Is(execErr, ErrIdempotencyConflict) {
				record(http.StatusConflict, execErr)
				WriteJSON(w, http.StatusConflict, "幂等键与请求体不一致", map[string]interface{}{
					"error_code":      "IDEMPOTENCY_KEY_CONFLICT",
					"idempotency_key": idempotencyKey,
				})
				return
			}
			record(http.StatusBadGateway, execErr)
			logger.Error("idempotent orchestrator request failed", "path", path, "error", execErr.Error())
			WriteJSON(w, http.StatusBadGateway, "上游请求失败", map[string]interface{}{
				"error_code": "UPSTREAM_REQUEST_FAILED",
				"upstream":   "python-backend",
				"message":    execErr.Error(),
			})
			return
		}

		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		if idempotencyKey != "" {
			w.Header().Set("X-Idempotency-Key", idempotencyKey)
		}
		w.WriteHeader(status)
		_, _ = w.Write(respBody)
		record(status, nil)
	}
}

func buildOrchestratorPassthroughPathHandler(
	logger *slog.Logger,
	client *orchestrator.Client,
	clientErr error,
	metrics *orchestratorMetrics,
	method string,
	pathPrefix string,
) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		markRouteOwner(w, "go-orchestrator")
		start := time.Now()
		recorded := false
		record := func(status int, err error) {
			if recorded {
				return
			}
			recorded = true
			metrics.Observe(pathPrefix, method, status, err, time.Since(start))
		}

		if r.Method != method {
			record(http.StatusMethodNotAllowed, nil)
			WriteJSON(w, http.StatusMethodNotAllowed, "Method not allowed", nil)
			return
		}
		if client == nil {
			record(http.StatusServiceUnavailable, clientErr)
			logger.Error("orchestrator unavailable", "path", r.URL.Path, "init_error", clientErr)
			WriteJSON(w, http.StatusServiceUnavailable, "上游服务不可用", map[string]interface{}{
				"error_code": "UPSTREAM_UNAVAILABLE",
				"upstream":   "python-backend",
			})
			return
		}
		if pathPrefix != "" && len(r.URL.Path) < len(pathPrefix) {
			record(http.StatusNotFound, nil)
			WriteJSON(w, http.StatusNotFound, "资源不存在", map[string]string{"error_code": "NOT_FOUND"})
			return
		}

		body, err := io.ReadAll(r.Body)
		if err != nil {
			record(http.StatusBadRequest, err)
			WriteJSON(w, http.StatusBadRequest, "无效请求体", map[string]interface{}{"error_code": "INVALID_REQUEST"})
			return
		}
		status, forwardErr := forwardOrchestratorJSON(w, r, logger, client, r.URL.Path, body, false)
		record(status, forwardErr)
	}
}

func buildOrchestratorUploadHandler(
	logger *slog.Logger,
	client *orchestrator.Client,
	clientErr error,
	metrics *orchestratorMetrics,
	method string,
	path string,
) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		markRouteOwner(w, "go-orchestrator")
		start := time.Now()
		recorded := false
		record := func(status int, err error) {
			if recorded {
				return
			}
			recorded = true
			metrics.Observe(path, method, status, err, time.Since(start))
		}

		if r.Method != method {
			record(http.StatusMethodNotAllowed, nil)
			WriteJSON(w, http.StatusMethodNotAllowed, "Method not allowed", nil)
			return
		}
		if client == nil {
			record(http.StatusServiceUnavailable, clientErr)
			logger.Error("orchestrator unavailable", "path", r.URL.Path, "init_error", clientErr)
			WriteJSON(w, http.StatusServiceUnavailable, "上游服务不可用", map[string]interface{}{
				"error_code": "UPSTREAM_UNAVAILABLE",
				"upstream":   "python-backend",
			})
			return
		}

		headers := buildForwardHeaders(r)
		status, respBody, err := client.DoStream(
			r.Context(),
			r.Method,
			path,
			r.URL.RawQuery,
			r.Body,
			r.Header.Get("Content-Type"),
			headers,
		)
		if err != nil {
			record(http.StatusBadGateway, err)
			logger.Error("orchestrator upload failed", "path", path, "error", err.Error())
			WriteJSON(w, http.StatusBadGateway, "上游请求失败", map[string]interface{}{
				"error_code": "UPSTREAM_REQUEST_FAILED",
				"upstream":   "python-backend",
				"message":    err.Error(),
			})
			return
		}

		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(status)
		_, _ = w.Write(respBody)
		record(status, nil)
	}
}

func forwardOrchestratorJSON(
	w http.ResponseWriter,
	r *http.Request,
	logger *slog.Logger,
	client *orchestrator.Client,
	path string,
	body []byte,
	safeRetry bool,
) (int, error) {
	headers := buildForwardHeaders(r)
	status, respBody, err := client.DoJSONWithOptions(
		r.Context(),
		r.Method,
		path,
		r.URL.RawQuery,
		body,
		headers,
		orchestrator.RequestOptions{Retryable: safeRetry},
	)
	if err != nil {
		logger.Error("orchestrator request failed", "path", path, "error", err.Error())
		WriteJSON(w, http.StatusBadGateway, "上游请求失败", map[string]interface{}{
			"error_code": "UPSTREAM_REQUEST_FAILED",
			"upstream":   "python-backend",
			"message":    err.Error(),
		})
		return http.StatusBadGateway, err
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_, _ = w.Write(respBody)
	return status, nil
}

func buildForwardHeaders(r *http.Request) map[string]string {
	return map[string]string{
		"Authorization":      r.Header.Get("Authorization"),
		"x-tenant-id":        r.Header.Get("x-tenant-id"),
		"x-project-id":       r.Header.Get("x-project-id"),
		"x-kb-id":            r.Header.Get("x-kb-id"),
		"X-Trace-Id":         r.Header.Get("X-Trace-Id"),
		"x-auth-user-id":     r.Header.Get("x-auth-user-id"),
		"x-auth-user-name":   r.Header.Get("x-auth-user-name"),
		"x-auth-user-email":  r.Header.Get("x-auth-user-email"),
		"x-authz-permission": r.Header.Get("x-authz-permission"),
		"x-authz-reason":     r.Header.Get("x-authz-reason"),
	}
}

func getIdempotencyKey(r *http.Request) string {
	v := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if v != "" {
		return v
	}
	return strings.TrimSpace(r.Header.Get("x-idempotency-key"))
}
