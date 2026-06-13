import { api } from './api';

export interface DocQaCitation {
  id: string;
  title: string;
  snippet: string;
  location?: string;
  entity_names?: string[];
  retrieval_score?: number;
  confidence?: number;
  confidence_level?: 'high' | 'medium' | 'low' | string;
}

export interface DocQaResponse {
  answer: string;
  citations: DocQaCitation[];
}

export type ReasoningProfile = 'fast' | 'balanced' | 'deep';

export interface DocDeepResearchResponse {
  question: string;
  summary: string;
  final_conclusion: string;
  report: string;
  sub_questions: string[];
  citations: DocQaCitation[];
  confidence: {
    score: number;
    level: 'high' | 'medium' | 'low' | string;
    reason?: string;
  };
  evidence_stats: {
    sub_questions: number;
    answered_sub_questions?: number;
    coverage_ratio?: number;
    retrieved_chunks: number;
    unique_citations: number;
    avg_citation_confidence?: number;
  };
}

export async function askDocQa(question: string, topK = 2, reasoningProfile: ReasoningProfile = 'balanced') {
  const response = await api.post('/api/docqa', {
    question,
    top_k: topK,
    require_citation: true,
    reasoning_profile: reasoningProfile,
  });
  return response.data?.data as DocQaResponse;
}

export async function askDocDeepResearch(
  question: string,
  options?: { topK?: number; maxSubQuestions?: number; reasoningProfile?: ReasoningProfile }
) {
  const response = await api.post('/api/docqa/deep-research', {
    question,
    top_k: options?.topK ?? 8,
    max_sub_questions: options?.maxSubQuestions ?? 4,
    reasoning_profile: options?.reasoningProfile ?? 'deep',
  });
  return response.data?.data as DocDeepResearchResponse;
}
