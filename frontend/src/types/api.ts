// API 请求和响应类型定义

export interface QueryRequest {
  cypher: string;
  parameters?: Record<string, any>;
}

export interface QueryResponse {
  nodes: Array<{
    id: string;
    labels: string[];
    properties: Record<string, any>;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    type: string;
    properties: Record<string, any>;
  }>;
  stats?: {
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
  properties: Record<string, any>;
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
  details?: any;
}
