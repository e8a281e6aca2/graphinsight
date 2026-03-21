import { api } from './api';
import type { QueryRequest, QueryResponse, ExpandRequest, NodeDetailResponse } from '../types/api';
import type { GraphData } from '../store/graphStore';

// 自定义错误类
export class GraphServiceError extends Error {
  public code: string;
  public details?: any;

  constructor(message: string, code: string, details?: any) {
    super(message);
    this.name = 'GraphServiceError';
    this.code = code;
    this.details = details;
  }
}

// 执行 Cypher 查询
export async function executeQuery(cypher: string, parameters?: Record<string, any>): Promise<GraphData> {
  try {
    const request: QueryRequest = { cypher, parameters };
    const response = await api.post<QueryResponse>('/api/query', request);
    
    return {
      nodes: response.data.nodes,
      edges: response.data.edges,
      stats: response.data.stats,
    };
  } catch (error: any) {
    if (error.response?.status === 400) {
      throw new GraphServiceError(
        error.response.data.message || 'Invalid Cypher query',
        'INVALID_QUERY',
        error.response.data
      );
    } else if (error.response?.status === 503) {
      throw new GraphServiceError(
        'Database unavailable',
        'DATABASE_UNAVAILABLE',
        error.response.data
      );
    } else if (error.response?.status === 500) {
      throw new GraphServiceError(
        'Internal server error',
        'SERVER_ERROR',
        error.response.data
      );
    }
    throw new GraphServiceError(
      'Failed to execute query',
      'UNKNOWN_ERROR',
      error
    );
  }
}

// 获取节点详情
export async function getNodeDetail(nodeId: string): Promise<NodeDetailResponse> {
  try {
    const response = await api.get<NodeDetailResponse>(`/api/node/${nodeId}`);
    return response.data;
  } catch (error: any) {
    if (error.response?.status === 404) {
      throw new GraphServiceError(
        'Node not found',
        'NODE_NOT_FOUND',
        error.response.data
      );
    }
    throw new GraphServiceError(
      'Failed to fetch node details',
      'UNKNOWN_ERROR',
      error
    );
  }
}

// 展开节点（获取邻居节点）
export async function expandNode(
  nodeId: string,
  direction: 'in' | 'out' | 'both' = 'both',
  relationshipTypes?: string[],
  limit: number = 20
): Promise<GraphData> {
  try {
    const request: ExpandRequest = {
      nodeId,
      direction,
      relationshipTypes,
      limit,
    };
    const response = await api.post<QueryResponse>('/api/expand', request);
    
    return {
      nodes: response.data.nodes,
      edges: response.data.edges,
      stats: response.data.stats,
    };
  } catch (error: any) {
    if (error.response?.status === 404) {
      throw new GraphServiceError(
        'Node not found',
        'NODE_NOT_FOUND',
        error.response.data
      );
    }
    throw new GraphServiceError(
      'Failed to expand node',
      'UNKNOWN_ERROR',
      error
    );
  }
}
