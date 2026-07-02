/**
 * Cross-tenant vector recall isolation (PRD-002b AC-8) on the live DB. Two tenants seeded
 * with distinct library chunks + embeddings; a retrieval scoped to one tenant must NEVER
 * surface the other's chunks — proven by BOTH the GUC fence AND the in-SQL tenant filter.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withClient, closeAppPool } from '../../src/lib/sport/db.js';
import { withTenantReadTx } from '../../src/lib/sport/tenant-context.js';
import { retrieve, retrieveWithClient } from '../../src/lib/sport/vector-store.js';
import type { CiypScope } from '../../src/lib/sport/scope-resolver.js';
import { seedTwoTenants, teardownTwoTenants, vec, T_A, T_B } from './fixtures.js';

const coachA: CiypScope = { tenantId: T_A, context: 'coach' };
const coachB: CiypScope = { tenantId: T_B, context: 'coach' };

// The query vector matches tenant A's seeded chunk (seed=1) and tenant B's (seed=7).
function parseVec(literal: string): number[] {
  return literal.slice(1, -1).split(',').map(Number);
}
const qA = parseVec(vec(1));
const qB = parseVec(vec(7));

beforeAll(async () => {
  await withClient((c) => seedTwoTenants(c));
}, 60_000);

afterAll(async () => {
  await withClient((c) => teardownTwoTenants(c));
  await closeAppPool();
});

describe('vector-store cross-tenant isolation', () => {
  it('AC-8: retrieval under tenant-A scope returns ONLY tenant-A chunks', async () => {
    const hits = await retrieve(coachA, qA, 'tenant A private library chunk', { topK: 10 });
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) {
      expect(h.text).toContain('tenant A');
      expect(h.text).not.toContain('tenant B');
    }
  });

  it('AC-8 (reverse): retrieval under tenant-B scope returns ONLY tenant-B chunks', async () => {
    const hits = await retrieve(coachB, qB, 'tenant B private library chunk', { topK: 10 });
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) expect(h.text).toContain('tenant B');
  });

  it('AC-8: a MISMATCHED in-SQL tenant filter returns zero rows even under a valid GUC', async () => {
    // GUC scope = tenant A, but we ask the SQL leg to filter for tenant B → zero rows
    // (the belt-and-suspenders in-SQL predicate). RLS would also block it; this proves
    // the second layer independently.
    const rows = await withTenantReadTx(coachA, (client) =>
      retrieveWithClient(client, T_B, qB, 'tenant B private library chunk', { topK: 10 }),
    );
    expect(rows).toHaveLength(0);
  });

  it('hybrid: a text-only query (zero-vector dense) still recalls via the sparse BM25 leg', async () => {
    const hits = await retrieve(coachA, new Array(1024).fill(0), 'private library chunk', {
      topK: 10,
    });
    expect(hits.some((h) => h.text.includes('tenant A'))).toBe(true);
  });
});
