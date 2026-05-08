package httpserver

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"graphinsight/go-backend/internal/config"
	"graphinsight/go-backend/internal/orchestrator"
)

func TestOrchestratorBuildRoute(t *testing.T) {
	t.Parallel()

	var gotUserID, gotPermission string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/graph/build" {
			t.Fatalf("unexpected upstream path: %s", r.URL.Path)
		}
		gotUserID = r.Header.Get("x-auth-user-id")
		gotPermission = r.Header.Get("x-authz-permission")
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"code":200,"message":"已触发建图"}`))
	}))
	defer upstream.Close()

	orc, err := orchestrator.New(config.Config{PythonBackendBaseURL: upstream.URL, PythonBackendTimeoutSeconds: 2})
	if err != nil {
		t.Fatalf("new orchestrator client: %v", err)
	}

	mux := http.NewServeMux()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	cfg := config.Config{AppName: "GraphInsight Go API", Version: "test", RBACEnforceBusinessAPI: false}
	registerRoutes(mux, cfg, logger, nil, nil, nil, nil, nil, nil, orc, nil)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/graph/build", nil)
	req.Header.Set("x-auth-user-id", "12")
	req.Header.Set("x-authz-permission", "graph:build")
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	if body := rec.Body.String(); body == "" {
		t.Fatalf("expected response body")
	}
	if gotUserID != "12" || gotPermission != "graph:build" {
		t.Fatalf("expected auth context headers forwarded, got user_id=%s permission=%s", gotUserID, gotPermission)
	}
}

func TestOrchestratorBuildRouteIdempotencyReplay(t *testing.T) {
	t.Parallel()

	var calls int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := atomic.AddInt32(&calls, 1)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(fmt.Sprintf(`{"code":200,"message":"build-%d"}`, n)))
	}))
	defer upstream.Close()

	orc, err := orchestrator.New(config.Config{PythonBackendBaseURL: upstream.URL, PythonBackendTimeoutSeconds: 2})
	if err != nil {
		t.Fatalf("new orchestrator client: %v", err)
	}

	mux := http.NewServeMux()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	cfg := config.Config{AppName: "GraphInsight Go API", Version: "test", RBACEnforceBusinessAPI: false}
	registerRoutes(mux, cfg, logger, nil, nil, nil, nil, nil, nil, orc, nil)

	reqBody := `{"source":"documents","force":false}`

	rec1 := httptest.NewRecorder()
	req1 := httptest.NewRequest(http.MethodPost, "/api/graph/build", strings.NewReader(reqBody))
	req1.Header.Set("Idempotency-Key", "build-123")
	req1.Header.Set("Content-Type", "application/json")
	mux.ServeHTTP(rec1, req1)

	rec2 := httptest.NewRecorder()
	req2 := httptest.NewRequest(http.MethodPost, "/api/graph/build", strings.NewReader(reqBody))
	req2.Header.Set("Idempotency-Key", "build-123")
	req2.Header.Set("Content-Type", "application/json")
	mux.ServeHTTP(rec2, req2)

	if rec1.Code != http.StatusOK || rec2.Code != http.StatusOK {
		t.Fatalf("expected both 200, got %d and %d", rec1.Code, rec2.Code)
	}
	if rec1.Body.String() != rec2.Body.String() {
		t.Fatalf("expected replayed response to match, got %s vs %s", rec1.Body.String(), rec2.Body.String())
	}
	if rec1.Body.String() != `{"code":200,"message":"build-1"}` {
		t.Fatalf("unexpected body: %s", rec1.Body.String())
	}
	if atomic.LoadInt32(&calls) != 1 {
		t.Fatalf("expected upstream called once, got %d", calls)
	}
	if rec2.Header().Get("X-Idempotency-Key") != "build-123" {
		t.Fatalf("expected X-Idempotency-Key response header")
	}
}

func TestOrchestratorBuildRouteIdempotencyConflict(t *testing.T) {
	t.Parallel()

	var calls int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"code":200,"message":"ok"}`))
	}))
	defer upstream.Close()

	orc, err := orchestrator.New(config.Config{PythonBackendBaseURL: upstream.URL, PythonBackendTimeoutSeconds: 2})
	if err != nil {
		t.Fatalf("new orchestrator client: %v", err)
	}

	mux := http.NewServeMux()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	cfg := config.Config{AppName: "GraphInsight Go API", Version: "test", RBACEnforceBusinessAPI: false}
	registerRoutes(mux, cfg, logger, nil, nil, nil, nil, nil, nil, orc, nil)

	rec1 := httptest.NewRecorder()
	req1 := httptest.NewRequest(http.MethodPost, "/api/graph/build", strings.NewReader(`{"force":false}`))
	req1.Header.Set("Idempotency-Key", "build-456")
	req1.Header.Set("Content-Type", "application/json")
	mux.ServeHTTP(rec1, req1)
	if rec1.Code != http.StatusOK {
		t.Fatalf("first request expected 200, got %d", rec1.Code)
	}

	rec2 := httptest.NewRecorder()
	req2 := httptest.NewRequest(http.MethodPost, "/api/graph/build", strings.NewReader(`{"force":true}`))
	req2.Header.Set("Idempotency-Key", "build-456")
	req2.Header.Set("Content-Type", "application/json")
	mux.ServeHTTP(rec2, req2)

	if rec2.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d", rec2.Code)
	}
	if atomic.LoadInt32(&calls) != 1 {
		t.Fatalf("expected upstream called once, got %d", calls)
	}
}

func TestOrchestratorDocumentsRoutes(t *testing.T) {
	t.Parallel()

	var seen []string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = append(seen, r.Method+" "+r.URL.Path+"?"+r.URL.RawQuery)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"code":200,"message":"ok"}`))
	}))
	defer upstream.Close()

	orc, err := orchestrator.New(config.Config{PythonBackendBaseURL: upstream.URL, PythonBackendTimeoutSeconds: 2})
	if err != nil {
		t.Fatalf("new orchestrator client: %v", err)
	}

	mux := http.NewServeMux()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	cfg := config.Config{AppName: "GraphInsight Go API", Version: "test", RBACEnforceBusinessAPI: false}
	registerRoutes(mux, cfg, logger, nil, nil, nil, nil, nil, nil, orc, nil)

	cases := []struct {
		method string
		path   string
	}{
		{method: http.MethodGet, path: "/api/documents"},
		{method: http.MethodDelete, path: "/api/documents?purge_graph=true"},
		{method: http.MethodDelete, path: "/api/documents/doc-123?purge_graph=true"},
	}
	for _, tc := range cases {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(tc.method, tc.path, nil)
		mux.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("request %s %s expected 200, got %d", tc.method, tc.path, rec.Code)
		}
	}

	if len(seen) != 3 {
		t.Fatalf("expected 3 upstream requests, got %d", len(seen))
	}
	if seen[0] != "GET /api/documents?" {
		t.Fatalf("unexpected upstream request[0]: %s", seen[0])
	}
	if seen[1] != "DELETE /api/documents?purge_graph=true" {
		t.Fatalf("unexpected upstream request[1]: %s", seen[1])
	}
	if seen[2] != "DELETE /api/documents/doc-123?purge_graph=true" {
		t.Fatalf("unexpected upstream request[2]: %s", seen[2])
	}
}

func TestOrchestratorUploadRoute(t *testing.T) {
	t.Parallel()

	var gotPath, gotContentType string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotContentType = r.Header.Get("Content-Type")
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"code":200,"message":"上传完成"}`))
	}))
	defer upstream.Close()

	orc, err := orchestrator.New(config.Config{PythonBackendBaseURL: upstream.URL, PythonBackendTimeoutSeconds: 2})
	if err != nil {
		t.Fatalf("new orchestrator client: %v", err)
	}

	mux := http.NewServeMux()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	cfg := config.Config{AppName: "GraphInsight Go API", Version: "test", RBACEnforceBusinessAPI: false}
	registerRoutes(mux, cfg, logger, nil, nil, nil, nil, nil, nil, orc, nil)

	var b strings.Builder
	writer := multipart.NewWriter(&b)
	part, _ := writer.CreateFormFile("files", "a.txt")
	_, _ = part.Write([]byte("abc"))
	_ = writer.Close()

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/documents/upload", strings.NewReader(b.String()))
	req.Header.Set("Content-Type", writer.FormDataContentType())
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	if gotPath != "/api/documents/upload" {
		t.Fatalf("unexpected upstream path: %s", gotPath)
	}
	if !strings.HasPrefix(gotContentType, "multipart/form-data; boundary=") {
		t.Fatalf("unexpected upstream content-type: %s", gotContentType)
	}
}

func TestOrchestratorMetricsRoute(t *testing.T) {
	t.Parallel()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/docqa/health" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"code":200,"message":"ok"}`))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte(`{"code":503,"message":"busy"}`))
	}))
	defer upstream.Close()

	orc, err := orchestrator.New(config.Config{
		PythonBackendBaseURL:        upstream.URL,
		PythonBackendTimeoutSeconds: 2,
		OrchestratorRetryMax:        0,
	})
	if err != nil {
		t.Fatalf("new orchestrator client: %v", err)
	}

	mux := http.NewServeMux()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	cfg := config.Config{AppName: "GraphInsight Go API", Version: "test", RBACEnforceBusinessAPI: false}
	registerRoutes(mux, cfg, logger, nil, nil, nil, nil, nil, nil, orc, nil)

	recCall := httptest.NewRecorder()
	reqCall := httptest.NewRequest(http.MethodGet, "/api/docqa/health", nil)
	mux.ServeHTTP(recCall, reqCall)
	if recCall.Code != http.StatusOK {
		t.Fatalf("expected health call 200, got %d", recCall.Code)
	}

	recCall2 := httptest.NewRecorder()
	reqCall2 := httptest.NewRequest(http.MethodPost, "/api/docqa/deep-research", strings.NewReader(`{"question":"x"}`))
	reqCall2.Header.Set("Content-Type", "application/json")
	mux.ServeHTTP(recCall2, reqCall2)
	if recCall2.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected deep-research 503 passthrough, got %d", recCall2.Code)
	}

	recMetrics := httptest.NewRecorder()
	reqMetrics := httptest.NewRequest(http.MethodGet, "/api/monitor/orchestrator", nil)
	mux.ServeHTTP(recMetrics, reqMetrics)
	if recMetrics.Code != http.StatusOK {
		t.Fatalf("expected metrics 200, got %d", recMetrics.Code)
	}

	var payload struct {
		Code int `json:"code"`
		Data struct {
			TotalRequests int `json:"total_requests"`
			Failed        int `json:"failed"`
			Routes        []struct {
				Route         string         `json:"route"`
				Method        string         `json:"method"`
				ErrorTaxonomy map[string]int `json:"error_taxonomy"`
			} `json:"routes"`
		} `json:"data"`
	}
	if err := json.Unmarshal(recMetrics.Body.Bytes(), &payload); err != nil {
		t.Fatalf("unmarshal metrics response: %v", err)
	}
	if payload.Code != http.StatusOK {
		t.Fatalf("expected response code 200 in body, got %d", payload.Code)
	}
	if payload.Data.TotalRequests < 2 {
		t.Fatalf("expected at least 2 orchestrator requests, got %d", payload.Data.TotalRequests)
	}
	if payload.Data.Failed < 1 {
		t.Fatalf("expected failed request count >=1, got %d", payload.Data.Failed)
	}
	foundSuccess := false
	found5xx := false
	for _, route := range payload.Data.Routes {
		if route.Route == "/api/docqa/health" && route.Method == http.MethodGet && route.ErrorTaxonomy["success"] >= 1 {
			foundSuccess = true
		}
		if route.Route == "/api/docqa/deep-research" && route.Method == http.MethodPost && route.ErrorTaxonomy["upstream_5xx"] >= 1 {
			found5xx = true
		}
	}
	if !foundSuccess {
		t.Fatalf("expected success taxonomy for /api/docqa/health")
	}
	if !found5xx {
		t.Fatalf("expected upstream_5xx taxonomy for /api/docqa/deep-research")
	}
}

func TestOrchestratorNL2CypherRoutes(t *testing.T) {
	t.Parallel()

	var seen []string
	var permissions []string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = append(seen, r.Method+" "+r.URL.Path)
		permissions = append(permissions, r.Header.Get("x-authz-permission"))
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"code":200,"message":"ok"}`))
	}))
	defer upstream.Close()

	orc, err := orchestrator.New(config.Config{PythonBackendBaseURL: upstream.URL, PythonBackendTimeoutSeconds: 2})
	if err != nil {
		t.Fatalf("new orchestrator client: %v", err)
	}

	mux := http.NewServeMux()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	cfg := config.Config{AppName: "GraphInsight Go API", Version: "test", RBACEnforceBusinessAPI: false}
	registerRoutes(mux, cfg, logger, nil, nil, nil, nil, nil, nil, orc, nil)

	cases := []struct {
		method     string
		path       string
		permission string
		body       string
	}{
		{method: http.MethodPost, path: "/api/nl2cypher", permission: "nl2cypher:use", body: `{"natural_language":"查找小麦"}`},
		{method: http.MethodGet, path: "/api/nl2cypher/examples", permission: "", body: ""},
		{method: http.MethodGet, path: "/api/nl2cypher/status", permission: "config:read", body: ""},
	}

	for _, tc := range cases {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
		if tc.body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		if tc.permission != "" {
			req.Header.Set("x-authz-permission", tc.permission)
		}
		mux.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("request %s %s expected 200, got %d", tc.method, tc.path, rec.Code)
		}
		if rec.Header().Get(routeOwnerHeader) != "go-orchestrator" {
			t.Fatalf("request %s %s unexpected route owner: %s", tc.method, tc.path, rec.Header().Get(routeOwnerHeader))
		}
	}

	wantSeen := []string{
		"POST /api/nl2cypher",
		"GET /api/nl2cypher/examples",
		"GET /api/nl2cypher/status",
	}
	for i, want := range wantSeen {
		if seen[i] != want {
			t.Fatalf("request[%d] expected %s, got %s", i, want, seen[i])
		}
	}
	if permissions[0] != "nl2cypher:use" {
		t.Fatalf("expected nl2cypher permission, got %s", permissions[0])
	}
	if permissions[1] != "" {
		t.Fatalf("expected no permission header for examples, got %s", permissions[1])
	}
	if permissions[2] != "config:read" {
		t.Fatalf("expected config:read permission, got %s", permissions[2])
	}
}

func TestOrchestratorDocQAOptionalSafeRetry(t *testing.T) {
	t.Parallel()

	var attempts int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		current := atomic.AddInt32(&attempts, 1)
		if r.URL.Path != "/api/docqa" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if current == 1 {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte(`{"code":503,"message":"busy"}`))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"code":200,"message":"ok"}`))
	}))
	defer upstream.Close()

	orc, err := orchestrator.New(config.Config{
		PythonBackendBaseURL:          upstream.URL,
		PythonBackendTimeoutSeconds:   2,
		OrchestratorRetryMax:          2,
		OrchestratorRetryBackoffMS:    1,
		OrchestratorRetryMaxBackoffMS: 2,
	})
	if err != nil {
		t.Fatalf("new orchestrator client: %v", err)
	}

	mux := http.NewServeMux()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	cfg := config.Config{
		AppName:                    "GraphInsight Go API",
		Version:                    "test",
		RBACEnforceBusinessAPI:     false,
		OrchestratorSafeRetryDocQA: true,
	}
	registerRoutes(mux, cfg, logger, nil, nil, nil, nil, nil, nil, orc, nil)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/docqa", strings.NewReader(`{"question":"你好"}`))
	req.Header.Set("Content-Type", "application/json")
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	if atomic.LoadInt32(&attempts) != 2 {
		t.Fatalf("expected 2 attempts with safe retry enabled, got %d", attempts)
	}
}
