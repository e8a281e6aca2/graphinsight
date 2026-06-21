package httpserver

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"time"

	"graphinsight/go-backend/internal/adminstore"
	"graphinsight/go-backend/internal/proxy"
)

type adminJobStore interface {
	ListJobs(ctx context.Context, query adminstore.JobListQuery) (adminstore.JobListResult, error)
	GetJob(ctx context.Context, jobID int) (adminstore.JobItem, error)
	ListJobLogs(ctx context.Context, jobID int, page int, pageSize int) (adminstore.JobLogListResult, error)
	CreateJob(ctx context.Context, req adminstore.JobCreateRequest) (adminstore.JobItem, error)
	RetryJob(ctx context.Context, req adminstore.JobRetryRequest) (adminstore.JobItem, error)
	CancelJob(ctx context.Context, req adminstore.JobCancelRequest) (adminstore.JobItem, error)
}

func asAdminJobStore(store interface{}) adminJobStore {
	typed, _ := store.(adminJobStore)
	return typed
}

func buildAdminJobsReadNativeHandler(logger *slog.Logger, guard businessPermissionGuard, jobStore adminJobStore) http.HandlerFunc {
	return withRouteOwner("go-native", guard.wrap("job:read", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			WriteJSON(w, http.StatusMethodNotAllowed, "Method not allowed", nil)
			return
		}
		if jobStore == nil {
			logger.Error("admin job store unavailable")
			WriteJSON(w, http.StatusServiceUnavailable, "任务数据服务不可用", map[string]string{"error_code": "ADMIN_STORE_UNAVAILABLE"})
			return
		}

		switch {
		case r.URL.Path == "/api/v1/admin/jobs":
			page := boundedIntQuery(r, "page", 1, 1, 1_000_000)
			pageSize := boundedIntQuery(r, "page_size", 20, 1, 200)
			result, err := jobStore.ListJobs(r.Context(), adminstore.JobListQuery{
				JobType:   strings.TrimSpace(r.URL.Query().Get("job_type")),
				Status:    strings.TrimSpace(r.URL.Query().Get("status")),
				TenantID:  strings.TrimSpace(r.URL.Query().Get("tenant_id")),
				ProjectID: strings.TrimSpace(r.URL.Query().Get("project_id")),
				KBID:      strings.TrimSpace(r.URL.Query().Get("kb_id")),
				Page:      page,
				PageSize:  pageSize,
			})
			if err != nil {
				logger.Error("list admin jobs failed", "error", err.Error())
				WriteJSON(w, http.StatusServiceUnavailable, "查询任务列表失败", map[string]string{"error_code": "ADMIN_STORE_UNAVAILABLE"})
				return
			}
			totalPages := 0
			if pageSize > 0 && result.Total > 0 {
				totalPages = (result.Total + pageSize - 1) / pageSize
			}
			WriteJSON(w, http.StatusOK, "获取成功", adminPaginatedData{
				Items:      result.Items,
				Total:      result.Total,
				Page:       page,
				PageSize:   pageSize,
				TotalPages: totalPages,
			})
		case strings.HasPrefix(r.URL.Path, "/api/v1/admin/jobs/"):
			jobID, isLogsRoute, ok := parseAdminJobReadPath(r.URL.Path)
			if !ok || jobID <= 0 {
				WriteJSON(w, http.StatusNotFound, "资源不存在", map[string]string{"error_code": "NOT_FOUND"})
				return
			}
			if isLogsRoute {
				page := boundedIntQuery(r, "page", 1, 1, 1_000_000)
				pageSize := boundedIntQuery(r, "page_size", 50, 1, 200)
				result, err := jobStore.ListJobLogs(r.Context(), jobID, page, pageSize)
				if errors.Is(err, adminstore.ErrJobNotFound) {
					WriteJSON(w, http.StatusNotFound, "任务不存在", map[string]string{"error_code": "NOT_FOUND"})
					return
				}
				if err != nil {
					logger.Error("list admin job logs failed", "error", err.Error())
					WriteJSON(w, http.StatusServiceUnavailable, "查询任务日志失败", map[string]string{"error_code": "ADMIN_STORE_UNAVAILABLE"})
					return
				}
				totalPages := 0
				if pageSize > 0 && result.Total > 0 {
					totalPages = (result.Total + pageSize - 1) / pageSize
				}
				WriteJSON(w, http.StatusOK, "获取成功", adminPaginatedData{
					Items:      result.Items,
					Total:      result.Total,
					Page:       page,
					PageSize:   pageSize,
					TotalPages: totalPages,
				})
				return
			}
			job, err := jobStore.GetJob(r.Context(), jobID)
			if errors.Is(err, adminstore.ErrJobNotFound) {
				WriteJSON(w, http.StatusNotFound, "任务不存在", map[string]string{"error_code": "NOT_FOUND"})
				return
			}
			if err != nil {
				logger.Error("get admin job failed", "error", err.Error())
				WriteJSON(w, http.StatusServiceUnavailable, "查询任务详情失败", map[string]string{"error_code": "ADMIN_STORE_UNAVAILABLE"})
				return
			}
			WriteJSON(w, http.StatusOK, "获取成功", job)
		default:
			WriteJSON(w, http.StatusNotFound, "资源不存在", map[string]string{"error_code": "NOT_FOUND"})
		}
	}))
}

func buildAdminJobsWriteNativeHandler(
	logger *slog.Logger,
	guard businessPermissionGuard,
	jobStore adminJobStore,
	configStore adminConfigStore,
	pythonWakeClient *proxy.Client,
) http.HandlerFunc {
	return withRouteOwner("go-native", guard.wrap("job:manage", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			WriteJSON(w, http.StatusMethodNotAllowed, "Method not allowed", nil)
			return
		}
		if jobStore == nil {
			logger.Error("admin job store unavailable")
			WriteJSON(w, http.StatusServiceUnavailable, "任务数据服务不可用", map[string]string{"error_code": "ADMIN_STORE_UNAVAILABLE"})
			return
		}

		switch r.URL.Path {
		case "/api/v1/admin/jobs/build-graph", "/api/v1/admin/jobs/clear-kb", "/api/v1/admin/jobs/reindex":
			var payload adminJobCreatePayload
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				WriteJSON(w, http.StatusBadRequest, "请求体错误", map[string]string{"error_code": "INVALID_BODY"})
				return
			}
			payload.Payload = enrichAdminJobPayloadWithScenarioDefaults(r.Context(), configStore, adminJobTypeFromPath(r.URL.Path), payload.Payload)
			req := buildAdminJobCreateRequest(r, adminJobTypeFromPath(r.URL.Path), payload)
			job, err := jobStore.CreateJob(r.Context(), req)
			if !writeAdminJobMutationResult(w, logger, err, http.StatusCreated, "任务已创建", job) {
				return
			}
			nudgePythonJobWorker(r, logger, pythonWakeClient)
		default:
			if jobID, ok := parseAdminJobActionPath(r.URL.Path, "retry"); ok {
				job, err := jobStore.RetryJob(r.Context(), adminstore.JobRetryRequest{
					JobID:      jobID,
					OperatorID: optionalIntHeader(r, "x-auth-user-id"),
					TraceID:    optionalStringHeader(r, traceHeader),
					IPAddress:  optionalString(firstRemoteAddr(r)),
					UserAgent:  optionalString(r.UserAgent()),
				})
				if !writeAdminJobMutationResult(w, logger, err, http.StatusOK, "重试已提交", job) {
					return
				}
				nudgePythonJobWorker(r, logger, pythonWakeClient)
				return
			}
			if jobID, ok := parseAdminJobActionPath(r.URL.Path, "cancel"); ok {
				job, err := jobStore.CancelJob(r.Context(), adminstore.JobCancelRequest{
					JobID:      jobID,
					OperatorID: optionalIntHeader(r, "x-auth-user-id"),
					TraceID:    optionalStringHeader(r, traceHeader),
					IPAddress:  optionalString(firstRemoteAddr(r)),
					UserAgent:  optionalString(r.UserAgent()),
				})
				writeAdminJobMutationResult(w, logger, err, http.StatusOK, "任务已取消", job)
				return
			}
			WriteJSON(w, http.StatusNotFound, "资源不存在", map[string]string{"error_code": "NOT_FOUND"})
		}
	}))
}

func enrichAdminJobPayloadWithScenarioDefaults(
	ctx context.Context,
	configStore adminConfigStore,
	jobType string,
	payload map[string]interface{},
) map[string]interface{} {
	if jobType != "build_graph" {
		return payload
	}
	normalized := map[string]interface{}{}
	for key, value := range payload {
		normalized[key] = value
	}
	if strings.TrimSpace(stringValue(normalized["reasoning_profile"])) != "" {
		return normalized
	}
	complexExtraction := false
	if value, ok := normalized["complex_extraction"]; ok {
		switch typed := value.(type) {
		case bool:
			complexExtraction = typed
		case string:
			complexExtraction = strings.EqualFold(strings.TrimSpace(typed), "true")
		}
	}
	scenario := "graph_extract"
	fallback := "fast"
	if complexExtraction {
		scenario = "graph_extract_complex"
		fallback = "balanced"
	}
	normalized["reasoning_profile"] = resolveScenarioReasoningProfile(ctx, configStore, scenario, fallback)
	return normalized
}

func stringValue(value interface{}) string {
	if value == nil {
		return ""
	}
	switch typed := value.(type) {
	case string:
		return typed
	default:
		return ""
	}
}

type adminJobCreatePayload struct {
	TenantID   *string                `json:"tenant_id"`
	ProjectID  *string                `json:"project_id"`
	KBID       *string                `json:"kb_id"`
	Payload    map[string]interface{} `json:"payload"`
	MaxRetries *int                   `json:"max_retries"`
}

type publicGraphBuildPayload struct {
	Source            string   `json:"source"`
	Force             bool     `json:"force"`
	Note              *string  `json:"note"`
	DocIDs            []string `json:"doc_ids"`
	ComplexExtraction bool     `json:"complex_extraction,omitempty"`
	ReasoningProfile  string   `json:"reasoning_profile,omitempty"`
	ParserProvider    string   `json:"parser_provider,omitempty"`
}

func buildAdminJobCreateRequest(r *http.Request, jobType string, payload adminJobCreatePayload) adminstore.JobCreateRequest {
	maxRetries := 3
	if payload.MaxRetries != nil {
		maxRetries = *payload.MaxRetries
	}
	return adminstore.JobCreateRequest{
		JobType:     jobType,
		TenantID:    trimOptionalString(payload.TenantID),
		ProjectID:   trimOptionalString(payload.ProjectID),
		KBID:        trimOptionalString(payload.KBID),
		Payload:     payload.Payload,
		MaxRetries:  maxRetries,
		RequestedBy: optionalIntHeader(r, "x-auth-user-id"),
		TraceID:     optionalStringHeader(r, traceHeader),
		IPAddress:   optionalString(firstRemoteAddr(r)),
		UserAgent:   optionalString(r.UserAgent()),
	}
}

func buildNativeGraphBuildJobHandler(
	logger *slog.Logger,
	jobStore adminJobStore,
	configStore adminConfigStore,
	pythonWakeClient *proxy.Client,
	store *idempotencyStore,
) http.HandlerFunc {
	return withRouteOwner("go-native", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			WriteJSON(w, http.StatusMethodNotAllowed, "Method not allowed", nil)
			return
		}
		if jobStore == nil {
			logger.Error("admin job store unavailable")
			WriteJSON(w, http.StatusServiceUnavailable, "任务数据服务不可用", map[string]string{"error_code": "ADMIN_STORE_UNAVAILABLE"})
			return
		}

		body, err := io.ReadAll(r.Body)
		if err != nil {
			WriteJSON(w, http.StatusBadRequest, "无效请求体", map[string]string{"error_code": "INVALID_REQUEST"})
			return
		}

		idempotencyKey := getIdempotencyKey(r)
		executor := func() (int, []byte, error) {
			var payload publicGraphBuildPayload
			if strings.TrimSpace(string(body)) != "" {
				if err := json.NewDecoder(bytes.NewReader(body)).Decode(&payload); err != nil {
					return marshalAPIResponse(
						http.StatusBadRequest,
						"请求体错误",
						map[string]string{"error_code": "INVALID_BODY"},
						r.Header.Get(traceHeader),
					)
				}
			}
			if strings.TrimSpace(payload.ReasoningProfile) == "" {
				scenario := "graph_extract"
				fallback := "fast"
				if payload.ComplexExtraction {
					scenario = "graph_extract_complex"
					fallback = "balanced"
				}
				payload.ReasoningProfile = resolveScenarioReasoningProfile(r.Context(), configStore, scenario, fallback)
			}

			job, err := jobStore.CreateJob(r.Context(), buildPublicGraphBuildJobCreateRequest(r, payload))
			if errors.Is(err, adminstore.ErrJobValidation) {
				return marshalAPIResponse(
					http.StatusBadRequest,
					"任务参数错误",
					map[string]string{"error_code": "INVALID_BODY"},
					r.Header.Get(traceHeader),
				)
			}
			if err != nil {
				logger.Error("public graph build job create failed", "error", err.Error())
				return marshalAPIResponse(
					http.StatusServiceUnavailable,
					"任务创建失败",
					map[string]string{"error_code": "ADMIN_STORE_UNAVAILABLE"},
					r.Header.Get(traceHeader),
				)
			}

			nudgePythonJobWorker(r, logger, pythonWakeClient)
			return marshalAPIResponse(
				http.StatusOK,
				"建图任务已提交",
				map[string]interface{}{
					"job_id":  job.ID,
					"status":  "queued",
					"message": "建图任务已提交，请在任务中心查看进度",
					"job":     job,
				},
				r.Header.Get(traceHeader),
			)
		}

		var (
			status   int
			respBody []byte
			execErr  error
		)
		if store == nil || idempotencyKey == "" {
			status, respBody, execErr = executor()
		} else {
			status, respBody, execErr = store.execute(r.Context(), idempotencyKey, body, executor)
		}
		if execErr != nil {
			if errors.Is(execErr, ErrIdempotencyConflict) {
				WriteJSON(w, http.StatusConflict, "幂等键与请求体不一致", map[string]interface{}{
					"error_code":      "IDEMPOTENCY_KEY_CONFLICT",
					"idempotency_key": idempotencyKey,
				})
				return
			}
			logger.Error("public graph build job request failed", "error", execErr.Error())
			WriteJSON(w, http.StatusBadGateway, "建图任务提交失败", map[string]string{"error_code": "UPSTREAM_REQUEST_FAILED"})
			return
		}

		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		if idempotencyKey != "" {
			w.Header().Set("X-Idempotency-Key", idempotencyKey)
		}
		w.WriteHeader(status)
		_, _ = w.Write(respBody)
	})
}

func buildPublicGraphBuildJobCreateRequest(r *http.Request, payload publicGraphBuildPayload) adminstore.JobCreateRequest {
	source := strings.TrimSpace(payload.Source)
	if source == "" {
		source = "documents"
	}

	docIDs := make([]string, 0, len(payload.DocIDs))
	for _, item := range payload.DocIDs {
		trimmed := strings.TrimSpace(item)
		if trimmed == "" {
			continue
		}
		docIDs = append(docIDs, trimmed)
	}

	scope := resolveScopeHeaders(r)
	jobPayload := map[string]interface{}{
		"source":             source,
		"force":              payload.Force,
		"doc_ids":            docIDs,
		"complex_extraction": payload.ComplexExtraction,
	}
	if profile := strings.TrimSpace(payload.ReasoningProfile); profile != "" {
		jobPayload["reasoning_profile"] = profile
	}
	if parserProvider := strings.TrimSpace(payload.ParserProvider); parserProvider != "" {
		jobPayload["parser_provider"] = parserProvider
	}
	if note := trimOptionalString(payload.Note); note != nil {
		jobPayload["note"] = *note
	}

	return adminstore.JobCreateRequest{
		JobType:     "build_graph",
		TenantID:    optionalString(scope["x-tenant-id"]),
		ProjectID:   optionalString(scope["x-project-id"]),
		KBID:        optionalString(scope["x-kb-id"]),
		Payload:     jobPayload,
		MaxRetries:  3,
		RequestedBy: optionalIntHeader(r, "x-auth-user-id"),
		TraceID:     optionalStringHeader(r, traceHeader),
		IPAddress:   optionalString(firstRemoteAddr(r)),
		UserAgent:   optionalString(r.UserAgent()),
	}
}

func marshalAPIResponse(status int, message string, data interface{}, traceID string) (int, []byte, error) {
	body, err := json.Marshal(APIResponse{
		Code:      status,
		Message:   message,
		Data:      data,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		TraceID:   traceID,
	})
	if err != nil {
		return 0, nil, err
	}
	return status, body, nil
}

func adminJobTypeFromPath(path string) string {
	switch path {
	case "/api/v1/admin/jobs/build-graph":
		return "build_graph"
	case "/api/v1/admin/jobs/clear-kb":
		return "clear_kb"
	case "/api/v1/admin/jobs/reindex":
		return "reindex"
	default:
		return ""
	}
}

func parseAdminJobActionPath(path string, action string) (int, bool) {
	rest := strings.TrimPrefix(path, "/api/v1/admin/jobs/")
	suffix := ":" + action
	if rest == "" || !strings.HasSuffix(rest, suffix) {
		return 0, false
	}
	rawID := strings.TrimSuffix(rest, suffix)
	if rawID == "" || strings.Contains(rawID, "/") || strings.Contains(rawID, ":") {
		return 0, false
	}
	id, err := strconv.Atoi(rawID)
	if err != nil || id <= 0 {
		return 0, false
	}
	return id, true
}

func trimOptionalString(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func nudgePythonJobWorker(r *http.Request, logger *slog.Logger, pythonWakeClient *proxy.Client) {
	if pythonWakeClient == nil {
		return
	}

	wakeReq := httptest.NewRequest(http.MethodPost, "/api/internal/jobs/wake", strings.NewReader("{}"))
	wakeReq = wakeReq.WithContext(r.Context())
	for key, values := range r.Header {
		wakeReq.Header.Del(key)
		for _, value := range values {
			wakeReq.Header.Add(key, value)
		}
	}
	wakeReq.Header.Set("Content-Type", "application/json; charset=utf-8")
	wakeReq.Header.Set("Accept", "application/json")

	resp, err := pythonWakeClient.Capture(wakeReq)
	if err != nil {
		logger.Warn("python job worker wake failed", "error", err.Error())
		return
	}
	if resp.StatusCode >= http.StatusBadRequest {
		logger.Warn("python job worker wake returned error status", "status", resp.StatusCode)
	}
}

func writeAdminJobMutationResult(w http.ResponseWriter, logger *slog.Logger, err error, successStatus int, successMessage string, item adminstore.JobItem) bool {
	if errors.Is(err, adminstore.ErrJobNotFound) {
		WriteJSON(w, http.StatusNotFound, "任务不存在", map[string]string{"error_code": "NOT_FOUND"})
		return false
	}
	if errors.Is(err, adminstore.ErrJobValidation) {
		WriteJSON(w, http.StatusBadRequest, "任务参数错误", map[string]string{"error_code": "INVALID_BODY"})
		return false
	}
	if errors.Is(err, adminstore.ErrJobInvalidTransition) {
		WriteJSON(w, http.StatusBadRequest, "当前任务状态不支持该操作", map[string]string{"error_code": "INVALID_JOB_STATUS"})
		return false
	}
	if errors.Is(err, adminstore.ErrJobMaxRetriesReached) {
		WriteJSON(w, http.StatusBadRequest, "任务已达到最大重试次数", map[string]string{"error_code": "JOB_MAX_RETRIES_REACHED"})
		return false
	}
	if err != nil {
		logger.Error("admin job mutation failed", "error", err.Error())
		WriteJSON(w, http.StatusServiceUnavailable, "任务操作失败", map[string]string{"error_code": "ADMIN_STORE_UNAVAILABLE"})
		return false
	}
	WriteJSON(w, successStatus, successMessage, item)
	return true
}

func parseAdminJobReadPath(path string) (jobID int, isLogsRoute bool, ok bool) {
	rest := strings.TrimPrefix(path, "/api/v1/admin/jobs/")
	if rest == "" || strings.Contains(rest, ":") {
		return 0, false, false
	}
	if strings.HasSuffix(rest, "/logs") {
		rawID := strings.TrimSuffix(rest, "/logs")
		rawID = strings.TrimSuffix(rawID, "/")
		id, err := strconv.Atoi(rawID)
		if err != nil {
			return 0, false, false
		}
		return id, true, true
	}
	if strings.Contains(rest, "/") {
		return 0, false, false
	}
	id, err := strconv.Atoi(rest)
	if err != nil {
		return 0, false, false
	}
	return id, false, true
}
