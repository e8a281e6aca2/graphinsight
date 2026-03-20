import { api } from './api';

export interface DocQaCitation {
  id: string;
  title: string;
  snippet: string;
  location?: string;
}

export interface DocQaResponse {
  answer: string;
  citations: DocQaCitation[];
}

export async function askDocQa(question: string, topK = 2) {
  const response = await api.post('/api/docqa', {
    question,
    top_k: topK,
    require_citation: true,
  });
  return response.data?.data as DocQaResponse;
}
