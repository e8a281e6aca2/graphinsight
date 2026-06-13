package httpserver

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestTraceMiddlewareAddsTraceHeaderAndBodyField(t *testing.T) {
	t.Parallel()

	handler := Trace(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		WriteJSON(w, http.StatusOK, "ok", map[string]string{"value": "1"})
	}))

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	handler.ServeHTTP(rec, req)

	traceID := rec.Header().Get(traceHeader)
	if strings.TrimSpace(traceID) == "" {
		t.Fatal("expected trace header")
	}

	var payload APIResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.TraceID != traceID {
		t.Fatalf("expected body trace_id %q, got %q", traceID, payload.TraceID)
	}
}

func TestTraceMiddlewarePreservesInboundTraceID(t *testing.T) {
	t.Parallel()

	handler := Trace(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get(traceHeader); got != "trace-from-client" {
			t.Fatalf("unexpected request trace id: %q", got)
		}
		WriteJSON(w, http.StatusAccepted, "ok", nil)
	}))

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	req.Header.Set(traceHeader, "trace-from-client")
	handler.ServeHTTP(rec, req)

	if got := rec.Header().Get(traceHeader); got != "trace-from-client" {
		t.Fatalf("expected outbound trace id to be preserved, got %q", got)
	}
}

func TestWriteJSONIncludesNullDataField(t *testing.T) {
	t.Parallel()

	rec := httptest.NewRecorder()
	WriteJSON(rec, http.StatusOK, "ok", nil)

	var payload map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if _, ok := payload["data"]; !ok {
		t.Fatalf("expected response to include data field, got %s", rec.Body.String())
	}
	if payload["data"] != nil {
		t.Fatalf("expected null data field, got %#v", payload["data"])
	}
}

func TestCORSAllowsOperationalHeaders(t *testing.T) {
	t.Parallel()

	handler := CORS(
		[]string{"http://localhost:5173"},
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusNoContent)
		}),
	)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodOptions, "/api/documents/upload", nil)
	req.Header.Set("Origin", "http://localhost:5173")
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", rec.Code)
	}
	allowed := rec.Header().Get("Access-Control-Allow-Headers")
	for _, header := range []string{"X-Trace-Id", "Idempotency-Key", "x-tenant-id", "x-project-id", "x-kb-id"} {
		if !strings.Contains(allowed, header) {
			t.Fatalf("expected allowed headers to contain %s, got %q", header, allowed)
		}
	}
	exposed := rec.Header().Get("Access-Control-Expose-Headers")
	if !strings.Contains(exposed, routeOwnerHeader) || !strings.Contains(exposed, traceHeader) {
		t.Fatalf("unexpected exposed headers: %q", exposed)
	}
}

func TestRequestLoggingRecordsTraceID(t *testing.T) {
	t.Parallel()

	handler := Trace(RequestLogging(
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			WriteJSON(w, http.StatusOK, "ok", nil)
		}),
	))

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	handler.ServeHTTP(rec, req)

	if strings.TrimSpace(rec.Header().Get(traceHeader)) == "" {
		t.Fatal("expected trace header after full middleware chain")
	}
}
