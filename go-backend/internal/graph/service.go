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

const (
	defaultQueryTimeout = 20 * time.Second
	schemaQueryTimeout  = 5 * time.Second
)

func NewService(ctx context.Context, cfg config.Config, logger *slog.Logger) (*Service, error) {
	if cfg.Neo4jConfigSource == "admin" && strings.TrimSpace(cfg.Neo4jConfigResolutionErr) != "" {
		return nil, fmt.Errorf("resolve neo4j admin config failed: %s", cfg.Neo4jConfigResolutionErr)
	}
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

func (s *Service) CheckHealth(ctx context.Context) error {
	if s == nil || s.driver == nil {
		return errors.New("neo4j driver is not initialized")
	}
	session := s.driver.NewSession(ctx, neo4j.SessionConfig{DatabaseName: s.database})
	defer func() { _ = session.Close(ctx) }()

	result, err := session.Run(
		ctx,
		"RETURN 1 AS ok",
		nil,
		neo4j.WithTxTimeout(2*time.Second),
		neo4j.WithTxMetadata(map[string]any{"app": "graphinsight", "operation": "health"}),
	)
	if err != nil {
		return err
	}
	if !result.Next(ctx) {
		if err := result.Err(); err != nil {
			return err
		}
		return errors.New("neo4j health probe returned no rows")
	}
	return result.Err()
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

	result, err := session.Run(
		ctx,
		cypher,
		parameters,
		neo4j.WithTxTimeout(defaultQueryTimeout),
		neo4j.WithTxMetadata(map[string]any{"app": "graphinsight", "operation": "query"}),
	)
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

func (s *Service) DiscoverSchema(ctx context.Context) (GraphSchemaResponse, error) {
	start := time.Now()
	session := s.driver.NewSession(ctx, neo4j.SessionConfig{DatabaseName: s.database})
	defer func() { _ = session.Close(ctx) }()

	labels, err := s.discoverLabels(ctx, session)
	if err != nil && s.logger != nil {
		s.logger.Warn("schema label discovery failed", "error", err.Error())
	}
	relationships, err := s.discoverRelationships(ctx, session)
	if err != nil && s.logger != nil {
		s.logger.Warn("schema relationship discovery failed", "error", err.Error())
	}
	patterns, err := s.discoverPatterns(ctx, session)
	if err != nil && s.logger != nil {
		s.logger.Warn("schema pattern discovery failed", "error", err.Error())
	}
	nodeProperties, err := s.discoverNodeProperties(ctx, session)
	if err != nil && s.logger != nil {
		s.logger.Warn("schema node property discovery failed", "error", err.Error())
	}
	relProperties, err := s.discoverRelProperties(ctx, session)
	if err != nil && s.logger != nil {
		s.logger.Warn("schema relationship property discovery failed", "error", err.Error())
	}
	nodeCount, edgeCount, err := s.discoverCounts(ctx, session)
	if err != nil && s.logger != nil {
		s.logger.Warn("schema count discovery failed", "error", err.Error())
	}

	elapsed := time.Since(start).Seconds()
	return GraphSchemaResponse{
		Labels:         labels,
		Relationships:  relationships,
		Patterns:       patterns,
		NodeProperties: nodeProperties,
		RelProperties:  relProperties,
		SampleQuery:    buildSampleQuery(labels, patterns),
		Stats: GraphSchemaStats{
			NodeCount:     nodeCount,
			EdgeCount:     edgeCount,
			ExecutionTime: float64(int(elapsed*1000)) / 1000,
		},
	}, nil
}

func (s *Service) discoverLabels(ctx context.Context, session neo4j.SessionWithContext) ([]GraphLabelSummary, error) {
	result, err := session.Run(ctx, `
CALL db.labels() YIELD label
RETURN label, 0 AS count
ORDER BY label ASC
LIMIT 50
`, nil, schemaTxOptions("schema.labels")...)
	if err != nil {
		return nil, err
	}
	items := make([]GraphLabelSummary, 0, 16)
	for result.Next(ctx) {
		record := result.Record()
		items = append(items, GraphLabelSummary{
			Label: stringFromRecord(record, "label"),
			Count: int64FromRecord(record, "count"),
		})
	}
	return items, result.Err()
}

func (s *Service) discoverRelationships(ctx context.Context, session neo4j.SessionWithContext) ([]GraphRelationshipSummary, error) {
	result, err := session.Run(ctx, `
CALL db.relationshipTypes() YIELD relationshipType
RETURN relationshipType AS type, 0 AS count
ORDER BY relationshipType ASC
LIMIT 50
`, nil, schemaTxOptions("schema.relationshipTypes")...)
	if err != nil {
		return nil, err
	}
	items := make([]GraphRelationshipSummary, 0, 16)
	for result.Next(ctx) {
		record := result.Record()
		items = append(items, GraphRelationshipSummary{
			Type:  stringFromRecord(record, "type"),
			Count: int64FromRecord(record, "count"),
		})
	}
	return items, result.Err()
}

func (s *Service) discoverPatterns(ctx context.Context, session neo4j.SessionWithContext) ([]GraphPatternSummary, error) {
	result, err := session.Run(ctx, `
MATCH (a)
WITH a LIMIT 200
MATCH (a)-[r]->(b)
RETURN labels(a) AS source_labels, type(r) AS relationship, labels(b) AS target_labels, count(*) AS count
ORDER BY count DESC
LIMIT 50
`, nil, schemaTxOptions("schema.patterns")...)
	if err != nil {
		return nil, err
	}
	items := make([]GraphPatternSummary, 0, 16)
	for result.Next(ctx) {
		record := result.Record()
		items = append(items, GraphPatternSummary{
			SourceLabels: stringsFromRecord(record, "source_labels"),
			Relationship: stringFromRecord(record, "relationship"),
			TargetLabels: stringsFromRecord(record, "target_labels"),
			Count:        int64FromRecord(record, "count"),
		})
	}
	return items, result.Err()
}

func (s *Service) discoverNodeProperties(ctx context.Context, session neo4j.SessionWithContext) ([]GraphPropertySummary, error) {
	result, err := session.Run(ctx, `
MATCH (n)
WITH n LIMIT 200
UNWIND labels(n) AS label
UNWIND keys(n) AS key
RETURN label, key, count(*) AS count
ORDER BY count DESC
LIMIT 100
`, nil, schemaTxOptions("schema.nodeProperties")...)
	if err != nil {
		return nil, err
	}
	items := make([]GraphPropertySummary, 0, 32)
	for result.Next(ctx) {
		record := result.Record()
		items = append(items, GraphPropertySummary{
			Owner: stringFromRecord(record, "label"),
			Key:   stringFromRecord(record, "key"),
			Count: int64FromRecord(record, "count"),
		})
	}
	return items, result.Err()
}

func (s *Service) discoverRelProperties(ctx context.Context, session neo4j.SessionWithContext) ([]GraphPropertySummary, error) {
	result, err := session.Run(ctx, `
MATCH (a)
WITH a LIMIT 200
MATCH (a)-[r]->()
UNWIND keys(r) AS key
RETURN type(r) AS type, key, count(*) AS count
ORDER BY count DESC
LIMIT 100
`, nil, schemaTxOptions("schema.relProperties")...)
	if err != nil {
		return nil, err
	}
	items := make([]GraphPropertySummary, 0, 32)
	for result.Next(ctx) {
		record := result.Record()
		items = append(items, GraphPropertySummary{
			Owner: stringFromRecord(record, "type"),
			Key:   stringFromRecord(record, "key"),
			Count: int64FromRecord(record, "count"),
		})
	}
	return items, result.Err()
}

func (s *Service) discoverCounts(ctx context.Context, session neo4j.SessionWithContext) (int64, int64, error) {
	result, err := session.Run(ctx, `
MATCH (n)
WITH n LIMIT 1000
OPTIONAL MATCH (n)-[r]-()
RETURN count(DISTINCT n) AS node_count, count(DISTINCT r) AS edge_count
`, nil, schemaTxOptions("schema.countSample")...)
	if err != nil {
		return 0, 0, err
	}
	if !result.Next(ctx) {
		if err := result.Err(); err != nil {
			return 0, 0, err
		}
		return 0, 0, nil
	}
	record := result.Record()
	if err := result.Err(); err != nil {
		return 0, 0, err
	}
	return int64FromRecord(record, "node_count"), int64FromRecord(record, "edge_count"), nil
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

func buildSampleQuery(labels []GraphLabelSummary, patterns []GraphPatternSummary) string {
	for _, item := range labels {
		if strings.EqualFold(strings.TrimSpace(item.Label), "CausalFactView") ||
			strings.EqualFold(strings.TrimSpace(item.Label), "TemporalFactView") {
			return `// 当前图谱的论文事实视图查询
MATCH p=(a)-[:FACT_SOURCE|FACT_TARGET]-(f)-[:FACT_SOURCE|FACT_TARGET]-(b)
WHERE f.view_scope = 'paper_wheat_four_type_fact_view'
RETURN p
LIMIT 200`
		}
	}
	if len(patterns) > 0 {
		pattern := patterns[0]
		source := firstNonEmpty(pattern.SourceLabels)
		target := firstNonEmpty(pattern.TargetLabels)
		relationship := strings.TrimSpace(pattern.Relationship)
		if source != "" && target != "" && relationship != "" {
			return fmt.Sprintf(`// 自动发现：按当前图数据库最常见的关系模式查询
MATCH (n:%s)-[r:%s]->(m:%s)
RETURN n, r, m
LIMIT 80`, quoteCypherName(source), quoteCypherName(relationship), quoteCypherName(target))
		}
	}
	if len(labels) > 0 && strings.TrimSpace(labels[0].Label) != "" {
		return fmt.Sprintf(`// 自动发现：当前图数据库暂未发现关系，先查看节点
MATCH (n:%s)
RETURN n
LIMIT 80`, quoteCypherName(labels[0].Label))
	}
	return `// 当前图数据库暂未发现节点，先执行一个通用探测查询
MATCH (n)
RETURN n
LIMIT 80`
}

func quoteCypherName(value string) string {
	return "`" + strings.ReplaceAll(strings.TrimSpace(value), "`", "``") + "`"
}

func schemaTxOptions(operation string) []func(*neo4j.TransactionConfig) {
	return []func(*neo4j.TransactionConfig){
		neo4j.WithTxTimeout(schemaQueryTimeout),
		neo4j.WithTxMetadata(map[string]any{"app": "graphinsight", "operation": operation}),
	}
}

func firstNonEmpty(items []string) string {
	for _, item := range items {
		if strings.TrimSpace(item) != "" {
			return strings.TrimSpace(item)
		}
	}
	return ""
}

func stringFromRecord(record *neo4j.Record, key string) string {
	value, ok := record.Get(key)
	if !ok || value == nil {
		return ""
	}
	if text, ok := value.(string); ok {
		return text
	}
	return fmt.Sprintf("%v", value)
}

func stringsFromRecord(record *neo4j.Record, key string) []string {
	value, ok := record.Get(key)
	if !ok || value == nil {
		return []string{}
	}
	switch v := value.(type) {
	case []string:
		return append([]string(nil), v...)
	case []interface{}:
		items := make([]string, 0, len(v))
		for _, item := range v {
			if item == nil {
				continue
			}
			items = append(items, fmt.Sprintf("%v", item))
		}
		return items
	default:
		return []string{fmt.Sprintf("%v", value)}
	}
}

func int64FromRecord(record *neo4j.Record, key string) int64 {
	value, ok := record.Get(key)
	if !ok || value == nil {
		return 0
	}
	switch v := value.(type) {
	case int:
		return int64(v)
	case int8:
		return int64(v)
	case int16:
		return int64(v)
	case int32:
		return int64(v)
	case int64:
		return v
	case float32:
		return int64(v)
	case float64:
		return int64(v)
	default:
		parsed, err := strconv.ParseInt(fmt.Sprintf("%v", value), 10, 64)
		if err != nil {
			return 0
		}
		return parsed
	}
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
	if strings.Contains(lower, "dbms.memory.transaction.total.max") || strings.Contains(lower, "memorypooloutofmemory") || strings.Contains(lower, "memory pool") {
		return 503, map[string]interface{}{
			"error":   "Database transaction memory exhausted",
			"code":    "DATABASE_MEMORY_EXHAUSTED",
			"message": "Neo4j transaction memory is exhausted. Restart Neo4j or terminate the heavy query, then retry with a narrower Cypher query.",
		}
	}
	if strings.Contains(lower, "transaction timed out") || strings.Contains(lower, "transaction timeout") || strings.Contains(lower, "terminated due to timeout") {
		return 503, map[string]interface{}{
			"error":   "Query timeout",
			"code":    "QUERY_TIMEOUT",
			"message": "Cypher query timed out. Narrow the query with labels, relationship types, indexed properties, or a lower LIMIT.",
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
