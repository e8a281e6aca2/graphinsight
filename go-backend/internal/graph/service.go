package graph

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/neo4j/neo4j-go-driver/v5/neo4j"
	"github.com/neo4j/neo4j-go-driver/v5/neo4j/dbtype"

	"graphinsight/go-backend/internal/config"
)

type Service struct {
	driver   neo4j.DriverWithContext
	database string
	logger   *slog.Logger
}

var ErrNodeNotFound = errors.New("node not found")

func NewService(ctx context.Context, cfg config.Config, logger *slog.Logger) (*Service, error) {
	driver, err := neo4j.NewDriverWithContext(cfg.Neo4jURI, neo4j.BasicAuth(cfg.Neo4jUser, cfg.Neo4jPassword, ""))
	if err != nil {
		return nil, fmt.Errorf("create neo4j driver failed: %w", err)
	}
	if err := driver.VerifyConnectivity(ctx); err != nil {
		_ = driver.Close(ctx)
		return nil, fmt.Errorf("verify neo4j connectivity failed: %w", err)
	}
	return &Service{driver: driver, database: cfg.Neo4jDatabase, logger: logger}, nil
}

func (s *Service) Close(ctx context.Context) error {
	if s == nil || s.driver == nil {
		return nil
	}
	return s.driver.Close(ctx)
}

func (s *Service) ExecuteQuery(ctx context.Context, cypher string, parameters map[string]interface{}) (QueryResponse, error) {
	if strings.TrimSpace(cypher) == "" {
		return QueryResponse{}, fmt.Errorf("cypher is empty")
	}
	if parameters == nil {
		parameters = map[string]interface{}{}
	}

	start := time.Now()
	session := s.driver.NewSession(ctx, neo4j.SessionConfig{DatabaseName: s.database})
	defer func() { _ = session.Close(ctx) }()

	result, err := session.Run(ctx, cypher, parameters)
	if err != nil {
		return QueryResponse{}, err
	}

	nodeMap := map[string]Node{}
	edges := make([]Edge, 0, 128)
	edgeSet := map[string]struct{}{}

	for result.Next(ctx) {
		record := result.Record()
		for _, value := range record.Values {
			parseValue(value, nodeMap, &edges, edgeSet)
		}
	}
	if err := result.Err(); err != nil {
		return QueryResponse{}, err
	}

	nodes := make([]Node, 0, len(nodeMap))
	for _, node := range nodeMap {
		nodes = append(nodes, node)
	}

	elapsed := time.Since(start).Seconds()
	return QueryResponse{
		Nodes: nodes,
		Edges: edges,
		Stats: Stats{
			NodeCount:     len(nodes),
			EdgeCount:     len(edges),
			ExecutionTime: float64(int(elapsed*1000)) / 1000,
		},
	}, nil
}

func (s *Service) ExpandNode(ctx context.Context, req ExpandRequest) (QueryResponse, error) {
	nodeID := strings.TrimSpace(req.NodeID)
	if nodeID == "" {
		return QueryResponse{}, fmt.Errorf("node id is empty")
	}
	direction := strings.ToLower(strings.TrimSpace(req.Direction))
	if direction == "" {
		direction = "both"
	}
	if direction != "in" && direction != "out" && direction != "both" {
		return QueryResponse{}, fmt.Errorf("invalid direction: %s", direction)
	}

	limit := req.Limit
	if limit <= 0 {
		limit = 20
	}
	if limit > 500 {
		limit = 500
	}

	pattern := "(n)-[r]-(m)"
	if direction == "in" {
		pattern = "(n)<-[r]-(m)"
	} else if direction == "out" {
		pattern = "(n)-[r]->(m)"
	}

	relTypes := make([]string, 0, len(req.RelationshipTypes))
	for _, item := range req.RelationshipTypes {
		v := strings.TrimSpace(item)
		if v == "" {
			continue
		}
		relTypes = append(relTypes, v)
	}

	parsedInt, err := strconv.ParseInt(nodeID, 10, 64)
	hasIntID := err == nil

	cypher := fmt.Sprintf(`
MATCH %s
WHERE (elementId(n) = $node_id_str OR ($has_int_id AND id(n) = $node_id_int))
  AND (size($rel_types) = 0 OR type(r) IN $rel_types)
RETURN n, r, m
LIMIT $limit
`, pattern)

	params := map[string]interface{}{
		"node_id_str": nodeID,
		"node_id_int": parsedInt,
		"has_int_id":  hasIntID,
		"rel_types":   relTypes,
		"limit":       limit,
	}
	return s.ExecuteQuery(ctx, cypher, params)
}

func (s *Service) GetNodeDetail(ctx context.Context, nodeID string) (NodeDetail, error) {
	nodeID = strings.TrimSpace(nodeID)
	if nodeID == "" {
		return NodeDetail{}, fmt.Errorf("node id is empty")
	}

	parsedInt, err := strconv.ParseInt(nodeID, 10, 64)
	hasIntID := err == nil

	session := s.driver.NewSession(ctx, neo4j.SessionConfig{DatabaseName: s.database})
	defer func() { _ = session.Close(ctx) }()

	result, err := session.Run(ctx, `
MATCH (n)
WHERE elementId(n) = $node_id_str OR ($has_int_id AND id(n) = $node_id_int)
RETURN n
LIMIT 1
`, map[string]interface{}{
		"node_id_str": nodeID,
		"node_id_int": parsedInt,
		"has_int_id":  hasIntID,
	})
	if err != nil {
		return NodeDetail{}, err
	}
	if !result.Next(ctx) {
		if err := result.Err(); err != nil {
			return NodeDetail{}, err
		}
		return NodeDetail{}, ErrNodeNotFound
	}

	value, ok := result.Record().Get("n")
	if !ok {
		return NodeDetail{}, fmt.Errorf("node result missing field n")
	}
	node, ok := value.(dbtype.Node)
	if !ok {
		return NodeDetail{}, fmt.Errorf("node result has unexpected type %T", value)
	}

	id := node.ElementId
	if id == "" {
		id = strconv.FormatInt(node.Id, 10)
	}
	properties := normalizeMap(node.Props)
	return NodeDetail{
		ID:         id,
		Labels:     append([]string(nil), node.Labels...),
		Properties: properties,
		Media:      buildMediaFromProperties(properties),
	}, nil
}

func ClassifyQueryError(err error) (int, map[string]interface{}) {
	if err == nil {
		return 200, map[string]interface{}{}
	}
	msg := err.Error()
	lower := strings.ToLower(msg)

	if strings.Contains(lower, "cypher is empty") || strings.Contains(lower, "syntax") || strings.Contains(lower, "invalid input") {
		return 400, map[string]interface{}{
			"error":   "Invalid Cypher query",
			"code":    "INVALID_QUERY",
			"message": msg,
		}
	}
	if strings.Contains(lower, "invalid direction") {
		return 400, map[string]interface{}{
			"error":   "Invalid direction",
			"code":    "INVALID_DIRECTION",
			"message": "Direction must be 'in', 'out', or 'both'",
		}
	}
	if strings.Contains(lower, "node id is empty") {
		return 400, map[string]interface{}{
			"error":   "Invalid node id",
			"code":    "INVALID_NODE_ID",
			"message": "nodeId is required",
		}
	}
	if strings.Contains(lower, "unable to retrieve routing information") || strings.Contains(lower, "service unavailable") || strings.Contains(lower, "connection") || strings.Contains(lower, "connectivity") {
		return 503, map[string]interface{}{
			"error":   "Database unavailable",
			"code":    "DATABASE_UNAVAILABLE",
			"message": "Cannot connect to Neo4j database",
		}
	}
	return 500, map[string]interface{}{
		"error":   "Internal server error",
		"code":    "INTERNAL_ERROR",
		"message": msg,
	}
}

func parseValue(value interface{}, nodeMap map[string]Node, edges *[]Edge, edgeSet map[string]struct{}) {
	switch v := value.(type) {
	case dbtype.Node:
		upsertNode(v, nodeMap)
	case dbtype.Relationship:
		upsertRelationship(v, edges, edgeSet)
	case dbtype.Path:
		for _, n := range v.Nodes {
			upsertNode(n, nodeMap)
		}
		for _, r := range v.Relationships {
			upsertRelationship(r, edges, edgeSet)
		}
	case []interface{}:
		for _, item := range v {
			parseValue(item, nodeMap, edges, edgeSet)
		}
	case map[string]interface{}:
		for _, item := range v {
			parseValue(item, nodeMap, edges, edgeSet)
		}
	}
}

func upsertNode(node dbtype.Node, nodeMap map[string]Node) {
	nodeID := node.ElementId
	if nodeID == "" {
		nodeID = strconv.FormatInt(node.Id, 10)
	}
	if _, exists := nodeMap[nodeID]; exists {
		return
	}
	nodeMap[nodeID] = Node{
		ID:         nodeID,
		Labels:     append([]string(nil), node.Labels...),
		Properties: normalizeMap(node.Props),
	}
}

func upsertRelationship(rel dbtype.Relationship, edges *[]Edge, edgeSet map[string]struct{}) {
	edgeID := rel.ElementId
	if edgeID == "" {
		edgeID = strconv.FormatInt(rel.Id, 10)
	}
	if _, exists := edgeSet[edgeID]; exists {
		return
	}
	edgeSet[edgeID] = struct{}{}

	props := normalizeMap(rel.Props)
	edgeType := rel.Type
	if label, ok := props["label"].(string); ok && strings.TrimSpace(label) != "" {
		edgeType = label
	}

	source := rel.StartElementId
	if source == "" {
		source = strconv.FormatInt(rel.StartId, 10)
	}
	target := rel.EndElementId
	if target == "" {
		target = strconv.FormatInt(rel.EndId, 10)
	}

	*edges = append(*edges, Edge{
		ID:         edgeID,
		Source:     source,
		Target:     target,
		Type:       edgeType,
		Properties: props,
	})
}

func normalizeMap(input map[string]interface{}) map[string]interface{} {
	if len(input) == 0 {
		return map[string]interface{}{}
	}
	result := make(map[string]interface{}, len(input))
	for k, v := range input {
		result[k] = normalizeValue(v)
	}
	return result
}

func normalizeValue(value interface{}) interface{} {
	switch v := value.(type) {
	case nil:
		return nil
	case string, bool, float64, float32, int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64:
		return v
	case []byte:
		return string(v)
	case time.Time:
		return v.Format(time.RFC3339)
	case []interface{}:
		items := make([]interface{}, 0, len(v))
		for _, item := range v {
			items = append(items, normalizeValue(item))
		}
		return items
	case map[string]interface{}:
		return normalizeMap(v)
	default:
		if s, ok := v.(fmt.Stringer); ok {
			return s.String()
		}
		return fmt.Sprintf("%v", v)
	}
}
