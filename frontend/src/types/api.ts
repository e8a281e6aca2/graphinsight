// API 请求和响应类型定义

export interface QueryRequest {
  cypher: string;
  parameters?: Record<string, unknown>;
}

export interface QueryResponse {
  nodes: Array<{
    id: string;
    labels: string[];
    properties: Record<string, unknown>;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    type: string;
    properties: Record<string, unknown>;
  }>;
  stats?: {
    nodeCount: number;
    edgeCount: number;
    executionTime: number;
  };
}

export interface GraphSchemaSummary {
  labels: Array<{
    label: string;
    count: number;
  }>;
  relationships: Array<{
    type: string;
    count: number;
  }>;
  patterns: Array<{
    sourceLabels: string[];
    relationship: string;
    targetLabels: string[];
    count: number;
  }>;
  nodeProperties: Array<{
    owner: string;
    key: string;
    count: number;
  }>;
  relProperties: Array<{
    owner: string;
    key: string;
    count: number;
  }>;
  sampleQuery: string;
  stats: {
    nodeCount: number;
    edgeCount: number;
    executionTime: number;
  };
}

export interface ExpandRequest {
  nodeId: string;
  direction?: 'in' | 'out' | 'both';
  relationshipTypes?: string[];
  limit?: number;
}

export interface MediaResource {
  filename: string;
  url: string;
  thumbnail?: string;
  duration?: number;
}

export interface NodeDetailResponse {
  id: string;
  labels: string[];
  properties: Record<string, unknown>;
  media: {
    images: MediaResource[];
    videos: MediaResource[];
    audios: MediaResource[];
  };
}

export interface ApiError {
  error: string;
  code: string;
  message: string;
  details?: unknown;
}
