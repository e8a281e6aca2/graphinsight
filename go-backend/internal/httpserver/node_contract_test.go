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
	schema     graph.GraphSchemaResponse
	schemaErr  error
	healthErr  error
}

func (s *stubGraphService) CheckHealth(ctx context.Context) error {
	return s.healthErr
}

func (s *stubGraphService) ExecuteQuery(ctx context.Context, cypher string, parameters map[string]interface{}) (graph.QueryResponse, error) {
	return graph.QueryResponse{}, nil
}

func (s *stubGraphService) DiscoverSchema(ctx context.Context) (graph.GraphSchemaResponse, error) {
	if s.schemaErr != nil {
		return graph.GraphSchemaResponse{}, s.schemaErr
	}
	return s.schema, nil
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
	data, ok := body["data"].(map[string]interface{})
	if !ok {
		t.Fatalf("response missing data envelope: %v", body)
	}
	if data["id"] != "42" {
		t.Fatalf("unexpected id: %v", data["id"])
	}
	if _, ok := data["media"]; !ok {
		t.Fatalf("response missing media field")
	}
	if body["trace_id"] == "" {
		t.Fatalf("response missing trace_id")
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
	if body["code"] != float64(http.StatusNotFound) {
		t.Fatalf("unexpected status code: %v", body["code"])
	}
	data, ok := body["data"].(map[string]interface{})
	if !ok {
		t.Fatalf("response missing data envelope: %v", body)
	}
	if data["error_code"] != "NODE_NOT_FOUND" {
		t.Fatalf("unexpected error code: %v", data["error_code"])
	}
	if body["trace_id"] == "" {
		t.Fatalf("response missing trace_id")
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

func TestGraphSchemaContractSuccess(t *testing.T) {
	t.Parallel()

	mux := http.NewServeMux()
	cfg := config.Config{AppName: "GraphInsight Go API", Version: "test", RBACEnforceBusinessAPI: false}
	graphSvc := &stubGraphService{schema: graph.GraphSchemaResponse{
		Labels: []graph.GraphLabelSummary{
			{Label: "Section", Count: 12},
		},
		Relationships: []graph.GraphRelationshipSummary{
			{Type: "HAS_SUBSECTION", Count: 11},
		},
		Patterns: []graph.GraphPatternSummary{
			{SourceLabels: []string{"Section"}, Relationship: "HAS_SUBSECTION", TargetLabels: []string{"Section"}, Count: 11},
		},
		SampleQuery: "MATCH (n)-[r]->(m) RETURN n,r,m LIMIT 80",
		Stats: graph.GraphSchemaStats{
			NodeCount: 12,
			EdgeCount: 11,
		},
	}}

	registerRoutes(mux, cfg, newTestLogger(), graphSvc, nil, nil, nil, nil, nil, nil, nil)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/graph/schema", nil)
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	var body map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body failed: %v", err)
	}
	data, ok := body["data"].(map[string]interface{})
	if !ok {
		t.Fatalf("response missing data envelope: %v", body)
	}
	if data["sampleQuery"] == "" {
		t.Fatalf("response missing sampleQuery")
	}
	if _, ok := data["labels"]; !ok {
		t.Fatalf("response missing labels")
	}
	if _, ok := data["patterns"]; !ok {
		t.Fatalf("response missing patterns")
	}
}

func TestHealthReportsNeo4jProbeFailure(t *testing.T) {
	t.Parallel()

	mux := http.NewServeMux()
	cfg := config.Config{AppName: "GraphInsight Go API", Version: "test", RBACEnforceBusinessAPI: false}
	graphSvc := &stubGraphService{healthErr: errors.New("connection refused")}

	registerRoutes(mux, cfg, newTestLogger(), graphSvc, nil, nil, nil, nil, nil, nil, nil)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	var body struct {
		Data struct {
			Status string `json:"status"`
			Neo4j  struct {
				Connected bool   `json:"connected"`
				Error     string `json:"error"`
			} `json:"neo4j"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body failed: %v", err)
	}
	if body.Data.Status != "degraded" {
		t.Fatalf("expected degraded status, got %q", body.Data.Status)
	}
	if body.Data.Neo4j.Connected {
		t.Fatalf("expected neo4j connected=false")
	}
	if body.Data.Neo4j.Error == "" {
		t.Fatalf("expected neo4j error")
	}
}
