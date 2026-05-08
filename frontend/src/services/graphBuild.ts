import { api } from './api';

export interface GraphBuildResponse {
  job_id: string;
  status: string;
  message?: string;
  doc_ids?: string[];
  stats?: {
    documents: number;
    chunks: number;
    entities: number;
  };
  failures?: Array<{
    file: string;
    reason: string;
  }>;
}

export async function triggerGraphBuild(payload?: {
  source?: string;
  force?: boolean;
  note?: string;
  docIds?: string[];
}) {
  const response = await api.post(
    '/api/graph/build',
    {
      source: payload?.source ?? 'documents',
      force: payload?.force ?? false,
      note: payload?.note ?? null,
      doc_ids: payload?.docIds ?? [],
    },
    { timeout: 180000 }
  );
  return response.data?.data as GraphBuildResponse;
}
