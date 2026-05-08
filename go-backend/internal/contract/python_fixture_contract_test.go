package contract

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"graphinsight/go-backend/internal/graph"
)

func mustLoadFixture(t *testing.T, name string) []byte {
	t.Helper()
	path := filepath.Join("..", "..", "testdata", "contracts", "python", name)
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read fixture %s failed: %v", name, err)
	}
	return b
}

func TestPythonQueryFixtureContract(t *testing.T) {
	t.Parallel()

	payload := mustLoadFixture(t, "query_success.json")
	var resp graph.QueryResponse
	if err := json.Unmarshal(payload, &resp); err != nil {
		t.Fatalf("unmarshal query fixture failed: %v", err)
	}
	if len(resp.Nodes) == 0 || len(resp.Edges) == 0 {
		t.Fatalf("query fixture must contain nodes and edges")
	}
	if resp.Stats.NodeCount != len(resp.Nodes) {
		t.Fatalf("nodeCount mismatch: stats=%d actual=%d", resp.Stats.NodeCount, len(resp.Nodes))
	}
	if resp.Stats.EdgeCount != len(resp.Edges) {
		t.Fatalf("edgeCount mismatch: stats=%d actual=%d", resp.Stats.EdgeCount, len(resp.Edges))
	}
}

func TestPythonExpandFixtureContract(t *testing.T) {
	t.Parallel()

	payload := mustLoadFixture(t, "expand_success.json")
	var resp graph.QueryResponse
	if err := json.Unmarshal(payload, &resp); err != nil {
		t.Fatalf("unmarshal expand fixture failed: %v", err)
	}
	if len(resp.Nodes) == 0 {
		t.Fatalf("expand fixture must contain nodes")
	}
	for _, edge := range resp.Edges {
		if edge.Source == "" || edge.Target == "" || edge.Type == "" {
			t.Fatalf("invalid edge contract: %+v", edge)
		}
	}
}

func TestPythonNodeFixtureContract(t *testing.T) {
	t.Parallel()

	payload := mustLoadFixture(t, "node_success.json")
	var detail graph.NodeDetail
	if err := json.Unmarshal(payload, &detail); err != nil {
		t.Fatalf("unmarshal node fixture failed: %v", err)
	}
	if detail.ID == "" {
		t.Fatalf("node detail id is required")
	}
	if detail.Media == nil {
		t.Fatalf("node detail media is required")
	}
	if _, ok := detail.Media["images"]; !ok {
		t.Fatalf("media.images missing")
	}
	if _, ok := detail.Media["videos"]; !ok {
		t.Fatalf("media.videos missing")
	}
	if _, ok := detail.Media["audios"]; !ok {
		t.Fatalf("media.audios missing")
	}
}

func TestPythonNodeNotFoundErrorFixtureContract(t *testing.T) {
	t.Parallel()

	payload := mustLoadFixture(t, "node_not_found_error.json")
	var errResp map[string]interface{}
	if err := json.Unmarshal(payload, &errResp); err != nil {
		t.Fatalf("unmarshal error fixture failed: %v", err)
	}
	if errResp["code"] != "NODE_NOT_FOUND" {
		t.Fatalf("unexpected error code: %v", errResp["code"])
	}
	if _, ok := errResp["message"]; !ok {
		t.Fatalf("error message missing")
	}
}
