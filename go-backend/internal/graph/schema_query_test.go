package graph

import (
	"strings"
	"testing"
)

func TestBuildSampleQueryUsesDiscoveredTopPattern(t *testing.T) {
	t.Parallel()

	query := buildSampleQuery(
		[]GraphLabelSummary{
			{Label: "CausalFactView", Count: 10},
			{Label: "Chunk", Count: 80},
			{Label: "Entity", Count: 140},
		},
		[]GraphPatternSummary{
			{
				SourceLabels: []string{"Chunk"},
				Relationship: "MENTIONS",
				TargetLabels: []string{"Entity"},
				Count:        96,
			},
		},
	)

	if !strings.Contains(query, "MATCH (n:`Chunk`)-[r:`MENTIONS`]->(m:`Entity`)") {
		t.Fatalf("expected discovered Chunk-MENTIONS-Entity pattern, got:\n%s", query)
	}
	if strings.Contains(query, "paper_wheat_four_type_fact_view") {
		t.Fatalf("sample query should not prefer retired paper fact view query:\n%s", query)
	}
}

func TestBuildSampleQueryFallsBackToNodeScan(t *testing.T) {
	t.Parallel()

	query := buildSampleQuery([]GraphLabelSummary{{Label: "Chunk", Count: 80}}, nil)
	if !strings.Contains(query, "MATCH (n:`Chunk`)") {
		t.Fatalf("expected label fallback query, got:\n%s", query)
	}
}
