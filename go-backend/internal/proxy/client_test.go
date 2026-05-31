package proxy

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"graphinsight/go-backend/internal/config"
)

func TestProxyForwardsTraceAndDoesNotExposeUpstreamBase(t *testing.T) {
	t.Parallel()

	var gotTrace string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotTrace = r.Header.Get("X-Trace-Id")
		w.Header().Set("X-Upstream-Base", "http://internal-python")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"code":200,"message":"ok"}`))
	}))
	defer upstream.Close()

	client, err := New(config.Config{
		PythonBackendBaseURL:        upstream.URL,
		PythonBackendTimeoutSeconds: 2,
		PythonBackendForwardAuth:    true,
	})
	if err != nil {
		t.Fatalf("new proxy client: %v", err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/media/image.png", strings.NewReader(""))
	req.Header.Set("X-Trace-Id", "trace-123")
	if err := client.Proxy(rec, req); err != nil {
		t.Fatalf("proxy request: %v", err)
	}

	if gotTrace != "trace-123" {
		t.Fatalf("expected trace to be forwarded, got %q", gotTrace)
	}
	if rec.Header().Get("X-Upstream-Base") != "" {
		t.Fatalf("proxy must not expose upstream base, got %q", rec.Header().Get("X-Upstream-Base"))
	}
}
