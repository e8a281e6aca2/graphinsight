package httpserver

import (
	"context"

	"graphinsight/go-backend/internal/graph"
)

type graphService interface {
	CheckHealth(ctx context.Context) error
	ExecuteQuery(ctx context.Context, cypher string, parameters map[string]interface{}) (graph.QueryResponse, error)
	DiscoverSchema(ctx context.Context) (graph.GraphSchemaResponse, error)
	ExpandNode(ctx context.Context, req graph.ExpandRequest) (graph.QueryResponse, error)
	GetNodeDetail(ctx context.Context, nodeID string) (graph.NodeDetail, error)
}
