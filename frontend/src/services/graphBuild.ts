import { api } from './api';

export interface GraphBuildResponse {
  job_id: string;
  status: string;
  message?: string;
  stats?: {
    documents: number;
    chunks: number;
    entities: number;
  };
}

export async function triggerGraphBuild(payload?: { source?: string; force?: boolean; note?: string }) {
  const response = await api.post('/api/graph/build', {
    source: payload?.source ?? 'documents',
    force: payload?.force ?? false,
    note: payload?.note ?? null,
  });
  return response.data?.data as GraphBuildResponse;
}
