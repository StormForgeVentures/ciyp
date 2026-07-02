/**
 * pgvector retrieval port (PRD-002b FR-5). Two defense layers on tenancy:
 *   1. the GUC RLS fence (the query runs inside `withTenantReadTx`), AND
 *   2. an EXPLICIT `tenant_id = $1` predicate IN THE SQL of every leg
 *      (rule-4 belt-and-suspenders — even a mis-set GUC cannot cross tenants).
 *
 * Hybrid retrieval: a dense cosine-kNN leg + a sparse BM25 (`ts_rank`) leg, fused by
 * Reciprocal Rank Fusion at k=60 (the documented default). Text is returned for the
 * grounding block; the trace records ids + scores only (never text — FR-12).
 */
import type { PoolClient } from 'pg';
import { withTenantReadTx } from './tenant-context.js';
import { toVectorLiteral } from './embedder.js';
import type { CiypScope } from './scope-resolver.js';

/** RRF constant — the standard k=60 (PRD-002b FR-5). */
export const RRF_K = 60;

export interface RetrievedChunk {
  id: string;
  libraryItemId: string;
  text: string;
  /** The fused RRF score (dense rank + sparse rank). */
  score: number;
  startSeconds: number | null;
  pageNumber: number | null;
}

export interface RetrieveOptions {
  /** Candidates per leg before fusion. */
  perLeg?: number;
  /** Final fused result count. */
  topK?: number;
}

interface LegRow {
  id: string;
  library_item_id: string;
  text: string;
  start_seconds: number | null;
  page_number: number | null;
}

/** Dense cosine-kNN leg. `tenant_id = $2` is IN the SQL (belt-and-suspenders). */
async function denseLeg(
  client: PoolClient,
  tenantId: string,
  queryEmbedding: number[],
  limit: number,
): Promise<LegRow[]> {
  const res = await client.query(
    `select id, library_item_id, text, start_seconds, page_number
       from library_chunks
      where tenant_id = $2
        and embedding is not null
      order by embedding <=> $1::vector
      limit $3`,
    [toVectorLiteral(queryEmbedding), tenantId, limit],
  );
  return res.rows as LegRow[];
}

/** Sparse BM25 leg (Postgres FTS `ts_rank`). `tenant_id = $2` is IN the SQL. */
async function sparseLeg(
  client: PoolClient,
  tenantId: string,
  queryText: string,
  limit: number,
): Promise<LegRow[]> {
  if (queryText.trim() === '') return [];
  const res = await client.query(
    `select id, library_item_id, text, start_seconds, page_number
       from library_chunks
      where tenant_id = $2
        and text_search @@ plainto_tsquery('english', $1)
      order by ts_rank(text_search, plainto_tsquery('english', $1)) desc
      limit $3`,
    [queryText, tenantId, limit],
  );
  return res.rows as LegRow[];
}

/** Reciprocal Rank Fusion at k=60 over the two legs' ranked id lists. */
function rrfFuse(legs: LegRow[][], topK: number): RetrievedChunk[] {
  const scores = new Map<string, number>();
  const rows = new Map<string, LegRow>();
  for (const leg of legs) {
    leg.forEach((row, rank) => {
      rows.set(row.id, row);
      scores.set(row.id, (scores.get(row.id) ?? 0) + 1 / (RRF_K + rank + 1));
    });
  }
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK)
    .map(([id, score]) => {
      const r = rows.get(id)!;
      return {
        id,
        libraryItemId: r.library_item_id,
        text: r.text,
        score,
        startSeconds: r.start_seconds,
        pageNumber: r.page_number,
      };
    });
}

/**
 * Retrieve inside an existing tenant-scoped transaction. `tenantId` is threaded into
 * the SQL predicate of every leg — the caller passes the RESOLVED scope's tenant, never
 * a client value.
 */
export async function retrieveWithClient(
  client: PoolClient,
  tenantId: string,
  queryEmbedding: number[],
  queryText: string,
  opts: RetrieveOptions = {},
): Promise<RetrievedChunk[]> {
  const perLeg = opts.perLeg ?? 20;
  const topK = opts.topK ?? 8;
  const [dense, sparse] = await Promise.all([
    denseLeg(client, tenantId, queryEmbedding, perLeg),
    sparseLeg(client, tenantId, queryText, perLeg),
  ]);
  return rrfFuse([dense, sparse], topK);
}

/** Convenience: open a read tx with the scope's GUC fence, then retrieve. */
export async function retrieve(
  scope: CiypScope,
  queryEmbedding: number[],
  queryText: string,
  opts: RetrieveOptions = {},
): Promise<RetrievedChunk[]> {
  return withTenantReadTx(scope, (client) =>
    retrieveWithClient(client, scope.tenantId, queryEmbedding, queryText, opts),
  );
}
