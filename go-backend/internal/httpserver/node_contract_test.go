package httpserver

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"graphinsight/go-backend/internal/config"
	"graphinsight/go-backend/internal/graph"
)

type stubGraphService struct {
	nodeDetail graph.NodeDetail
	nodeErr    error
}

func (s *stubGraphService) ExecuteQuery(ctx context.Context, cypher string, parameters map[string]interface{}) (graph.QueryResponse, error) {
	return graph.QueryResponse{}, nil
}

func (s *stubGraphService) ExpandNode(ctx context.Context, req graph.ExpandRequest) (graph.QueryResponse, error) {
	return graph.QueryResponse{}, nil
}

func (s *stubGraphService) GetNodeDetail(ctx context.Context, nodeID string) (graph.NodeDetail, error) {
	if s.nodeErr != nil {
		return graph.NodeDetail{}, s.nodeErr
	}
	return s.nodeDetail, nil
}

func newTestLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func TestNodeDetailContractSuccess(t *testing.T) {
	t.Parallel()

	mux := http.NewServeMux()
	cfg := config.Config{AppName: "GraphInsight Go API", Version: "test", RBACEnforceBusinessAPI: false}
	graphSvc := &stubGraphService{nodeDetail: graph.NodeDetail{
		ID:     "42",
		Labels: []string{"Entity"},
		Properties: map[string]interface{}{
			"name": "Fhb1",
		},
		Media: map[string][]graph.MediaResource{
			"images": []graph.MediaResource{
				{Filename: "a.png", URL: "/api/media/a.png", Thumbnail: "/api/media/a.png"},
			},
			"videos": []graph.MediaResource{},
			"audios": []graph.MediaResource{},
		},
	}}

	registerRoutes(mux, cfg, newTestLogger(), graphSvc, nil, nil, nil, nil, nil, nil, nil)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/node/42", nil)
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	var body map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body failed: %v", err)
	}
	if body["id"] != "42" {
		t.Fatalf("unexpected id: %v", body["id"])
	}
	if _, ok := body["media"]; !ok {
		t.Fatalf("response missing media field")
	}
}

func TestNodeDetailContractNotFound(t *testing.T) {
	t.Parallel()

	mux := http.NewServeMux()
	cfg := config.Config{AppName: "GraphInsight Go API", Version: "test", RBACEnforceBusinessAPI: false}
	graphSvc := &stubGraphService{nodeErr: graph.ErrNodeNotFound}

	registerRoutes(mux, cfg, newTestLogger(), graphSvc, nil, nil, nil, nil, nil, nil, nil)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/node/not-exists", nil)
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}

	var body map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body failed: %v", err)
	}
	if body["code"] != "NODE_NOT_FOUND" {
		t.Fatalf("unexpected code: %v", body["code"])
	}
}

func TestNodeDetailContractInternalError(t *testing.T) {
	t.Parallel()

	mux := http.NewServeMux()
	cfg := config.Config{AppName: "GraphInsight Go API", Version: "test", RBACEnforceBusinessAPI: false}
	graphSvc := &stubGraphService{nodeErr: errors.New("boom")}

	registerRoutes(mux, cfg, newTestLogger(), graphSvc, nil, nil, nil, nil, nil, nil, nil)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/node/42", nil)
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", rec.Code)
	}
}
