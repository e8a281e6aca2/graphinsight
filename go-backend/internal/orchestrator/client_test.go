package orchestrator

import (
	"context"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"graphinsight/go-backend/internal/config"
)

func TestDoJSON(t *testing.T) {
	t.Parallel()

	var gotMethod, gotPath, gotQuery, gotAuth, gotBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		gotMethod = r.Method
		gotPath = r.URL.Path
		gotQuery = r.URL.RawQuery
		gotAuth = r.Header.Get("Authorization")
		gotBody = string(body)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"code":200,"message":"ok"}`))
	}))
	defer srv.Close()

	client, err := New(config.Config{PythonBackendBaseURL: srv.URL, PythonBackendTimeoutSeconds: 2})
	if err != nil {
		t.Fatalf("new orchestrator client: %v", err)
	}

	status, respBody, err := client.DoJSON(context.Background(), http.MethodPost, "/api/graph/build", "force=true", []byte(`{"force":true}`), map[string]string{
		"Authorization": "Bearer abc",
	})
	if err != nil {
		t.Fatalf("DoJSON failed: %v", err)
	}

	if status != http.StatusOK {
		t.Fatalf("unexpected status: %d", status)
	}
	if string(respBody) != `{"code":200,"message":"ok"}` {
		t.Fatalf("unexpected body: %s", string(respBody))
	}
	if gotMethod != http.MethodPost || gotPath != "/api/graph/build" || gotQuery != "force=true" {
		t.Fatalf("unexpected request: method=%s path=%s query=%s", gotMethod, gotPath, gotQuery)
	}
	if gotAuth != "Bearer abc" {
		t.Fatalf("unexpected auth: %s", gotAuth)
	}
	if gotBody != `{"force":true}` {
		t.Fatalf("unexpected body: %s", gotBody)
	}
}

func TestDoStream(t *testing.T) {
	t.Parallel()

	var gotMethod, gotPath, gotContentType, gotAuth string
	var gotBodyContains bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		gotMethod = r.Method
		gotPath = r.URL.Path
		gotContentType = r.Header.Get("Content-Type")
		gotAuth = r.Header.Get("Authorization")
		gotBodyContains = strings.Contains(string(body), "sample.txt")
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"code":200,"message":"上传完成"}`))
	}))
	defer srv.Close()

	client, err := New(config.Config{PythonBackendBaseURL: srv.URL, PythonBackendTimeoutSeconds: 2})
	if err != nil {
		t.Fatalf("new orchestrator client: %v", err)
	}

	var b strings.Builder
	writer := multipart.NewWriter(&b)
	part, err := writer.CreateFormFile("files", "sample.txt")
	if err != nil {
		t.Fatalf("create form file failed: %v", err)
	}
	_, _ = part.Write([]byte("hello"))
	_ = writer.Close()

	status, respBody, err := client.DoStream(
		context.Background(),
		http.MethodPost,
		"/api/documents/upload",
		"",
		strings.NewReader(b.String()),
		writer.FormDataContentType(),
		map[string]string{"Authorization": "Bearer token-1"},
	)
	if err != nil {
		t.Fatalf("DoStream failed: %v", err)
	}
	if status != http.StatusOK {
		t.Fatalf("unexpected status: %d", status)
	}
	if string(respBody) != `{"code":200,"message":"上传完成"}` {
		t.Fatalf("unexpected body: %s", string(respBody))
	}
	if gotMethod != http.MethodPost || gotPath != "/api/documents/upload" {
		t.Fatalf("unexpected request: method=%s path=%s", gotMethod, gotPath)
	}
	if !strings.HasPrefix(gotContentType, "multipart/form-data; boundary=") {
		t.Fatalf("unexpected content-type: %s", gotContentType)
	}
	if gotAuth != "Bearer token-1" {
		t.Fatalf("unexpected auth header: %s", gotAuth)
	}
	if !gotBodyContains {
		t.Fatalf("expected multipart body to contain filename marker")
	}
}

func TestDoJSONRetryOnGet503(t *testing.T) {
	t.Parallel()

	var attempts int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		current := atomic.AddInt32(&attempts, 1)
		if current == 1 {
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte(`{"code":503,"message":"temp unavailable"}`))
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"code":200,"message":"ok"}`))
	}))
	defer srv.Close()

	client, err := New(config.Config{
		PythonBackendBaseURL:          srv.URL,
		PythonBackendTimeoutSeconds:   2,
		OrchestratorRetryMax:          2,
		OrchestratorRetryBackoffMS:    1,
		OrchestratorRetryMaxBackoffMS: 2,
	})
	if err != nil {
		t.Fatalf("new orchestrator client: %v", err)
	}

	status, body, err := client.DoJSON(context.Background(), http.MethodGet, "/api/docqa/health", "", nil, nil)
	if err != nil {
		t.Fatalf("DoJSON failed: %v", err)
	}
	if status != http.StatusOK {
		t.Fatalf("expected 200, got %d", status)
	}
	if string(body) != `{"code":200,"message":"ok"}` {
		t.Fatalf("unexpected body: %s", string(body))
	}
	if atomic.LoadInt32(&attempts) != 2 {
		t.Fatalf("expected 2 attempts, got %d", attempts)
	}
}

func TestDoJSONNoRetryOnPost503(t *testing.T) {
	t.Parallel()

	var attempts int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&attempts, 1)
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte(`{"code":503,"message":"temp unavailable"}`))
	}))
	defer srv.Close()

	client, err := New(config.Config{
		PythonBackendBaseURL:          srv.URL,
		PythonBackendTimeoutSeconds:   2,
		OrchestratorRetryMax:          3,
		OrchestratorRetryBackoffMS:    1,
		OrchestratorRetryMaxBackoffMS: 2,
	})
	if err != nil {
		t.Fatalf("new orchestrator client: %v", err)
	}

	status, _, err := client.DoJSON(context.Background(), http.MethodPost, "/api/graph/build", "", []byte(`{"force":false}`), nil)
	if err != nil {
		t.Fatalf("DoJSON failed: %v", err)
	}
	if status != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", status)
	}
	if atomic.LoadInt32(&attempts) != 1 {
		t.Fatalf("expected 1 attempt, got %d", attempts)
	}
}

func TestDoJSONRetryOnPost503WithRetryableOption(t *testing.T) {
	t.Parallel()

	var attempts int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		current := atomic.AddInt32(&attempts, 1)
		if current == 1 {
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte(`{"code":503,"message":"temp unavailable"}`))
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"code":200,"message":"ok"}`))
	}))
	defer srv.Close()

	client, err := New(config.Config{
		PythonBackendBaseURL:          srv.URL,
		PythonBackendTimeoutSeconds:   2,
		OrchestratorRetryMax:          2,
		OrchestratorRetryBackoffMS:    1,
		OrchestratorRetryMaxBackoffMS: 2,
	})
	if err != nil {
		t.Fatalf("new orchestrator client: %v", err)
	}
	client.httpClient.Timeout = 20 * time.Millisecond

	status, body, err := client.DoJSONWithOptions(
		context.Background(),
		http.MethodPost,
		"/api/docqa",
		"",
		[]byte(`{"question":"hello"}`),
		nil,
		RequestOptions{Retryable: true},
	)
	if err != nil {
		t.Fatalf("DoJSONWithOptions failed: %v", err)
	}
	if status != http.StatusOK {
		t.Fatalf("expected 200, got %d", status)
	}
	if string(body) != `{"code":200,"message":"ok"}` {
		t.Fatalf("unexpected body: %s", string(body))
	}
	if atomic.LoadInt32(&attempts) != 2 {
		t.Fatalf("expected 2 attempts, got %d", attempts)
	}
}

func TestDoJSONWithTimeoutOverride(t *testing.T) {
	t.Parallel()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(80 * time.Millisecond)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"code":200,"message":"ok"}`))
	}))
	defer srv.Close()

	client, err := New(config.Config{
		PythonBackendBaseURL:        srv.URL,
		PythonBackendTimeoutSeconds: 1,
	})
	if err != nil {
		t.Fatalf("new orchestrator client: %v", err)
	}

	status, body, err := client.DoJSONWithOptions(
		context.Background(),
		http.MethodPost,
		"/api/graph/build",
		"",
		[]byte(`{"force":false}`),
		nil,
		RequestOptions{Timeout: 200 * time.Millisecond},
	)
	if err != nil {
		t.Fatalf("DoJSONWithOptions failed: %v", err)
	}
	if status != http.StatusOK {
		t.Fatalf("expected 200, got %d", status)
	}
	if string(body) != `{"code":200,"message":"ok"}` {
		t.Fatalf("unexpected body: %s", string(body))
	}
}
