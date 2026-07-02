/**
 * Voyage reranker port (PRD-002b FR-6, Stage-2 cross-encoder). Injectable caller so
 * unit tests never hit the network or spend Voyage tokens; the default calls Voyage
 * `rerank-2.5`. Returns candidates reordered by relevance (indices into the input).
 */
export interface RerankCandidate {
  id: string;
  text: string;
}

export interface RerankResult {
  id: string;
  text: string;
  relevanceScore: number;
}

/** Low-level rerank call — injectable seam. */
export type RerankCaller = (
  query: string,
  documents: string[],
) => Promise<{ index: number; relevance_score: number }[]>;

export const RERANK_MODEL = process.env.VOYAGE_RERANK_MODEL?.trim() || 'rerank-2.5';

export const defaultRerankCaller: RerankCaller = async (query, documents) => {
  const key = process.env.VOYAGE_API_KEY;
  if (!key || key.trim() === '') {
    throw new Error('rerank: no VOYAGE_API_KEY — inject a caller for tests (never a synthetic rank).');
  }
  const res = await fetch('https://api.voyageai.com/v1/rerank', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: RERANK_MODEL, query, documents, top_k: documents.length }),
  });
  if (!res.ok) throw new Error(`Voyage rerank ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as {
    data: { index: number; relevance_score: number }[];
  };
  return json.data;
};

export interface Reranker {
  rerank(query: string, candidates: RerankCandidate[], topK?: number): Promise<RerankResult[]>;
}

export function createReranker(caller: RerankCaller = defaultRerankCaller): Reranker {
  return {
    async rerank(query, candidates, topK) {
      if (candidates.length === 0) return [];
      const ranked = await caller(
        query,
        candidates.map((c) => c.text),
      );
      return ranked
        .slice(0, topK ?? candidates.length)
        .map((r) => {
          const c = candidates[r.index];
          if (!c) throw new Error(`rerank: caller returned out-of-range index ${r.index}`);
          return { id: c.id, text: c.text, relevanceScore: r.relevance_score };
        });
    },
  };
}
