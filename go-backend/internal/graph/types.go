package graph

type QueryRequest struct {
	Cypher     string                 `json:"cypher"`
	Parameters map[string]interface{} `json:"parameters,omitempty"`
}

type ExpandRequest struct {
	NodeID            string   `json:"nodeId"`
	Direction         string   `json:"direction,omitempty"`
	RelationshipTypes []string `json:"relationshipTypes,omitempty"`
	Limit             int      `json:"limit,omitempty"`
}

type Node struct {
	ID         string                 `json:"id"`
	Labels     []string               `json:"labels"`
	Properties map[string]interface{} `json:"properties"`
}

type Edge struct {
	ID         string                 `json:"id"`
	Source     string                 `json:"source"`
	Target     string                 `json:"target"`
	Type       string                 `json:"type"`
	Properties map[string]interface{} `json:"properties"`
}

type MediaResource struct {
	Filename  string   `json:"filename"`
	URL       string   `json:"url"`
	Thumbnail string   `json:"thumbnail,omitempty"`
	Duration  *float64 `json:"duration,omitempty"`
}

type NodeDetail struct {
	ID         string                     `json:"id"`
	Labels     []string                   `json:"labels"`
	Properties map[string]interface{}     `json:"properties"`
	Media      map[string][]MediaResource `json:"media"`
}

type Stats struct {
	NodeCount     int     `json:"nodeCount"`
	EdgeCount     int     `json:"edgeCount"`
	ExecutionTime float64 `json:"executionTime"`
}

type QueryResponse struct {
	Nodes []Node `json:"nodes"`
	Edges []Edge `json:"edges"`
	Stats Stats  `json:"stats"`
}
