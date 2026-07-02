/**
 * Live per-scope model-slot resolution (PRD-002c AC-1/AC-2) on the DB. Two tenants with
 * different `default` slots resolve to different models; a config write + invalidate makes
 * the next resolve read the new model without a restart.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withClient, closeAppPool } from '../../src/lib/sport/db.js';
import { withTenantTx } from '../../src/lib/sport/tenant-context.js';
import {
  createCiypSlotResolver,
  makeGetModelSlot,
  slotScopeFor,
  loadSlotConfig,
} from '../../src/lib/sport/slot-resolver.js';
import type { CiypScope } from '../../src/lib/sport/scope-resolver.js';
import { seedTwoTenants, teardownTwoTenants, T_A, T_B } from './fixtures.js';

const coachA: CiypScope = { tenantId: T_A, context: 'coach' };
const coachB: CiypScope = { tenantId: T_B, context: 'coach' };

beforeAll(async () => {
  await withClient((c) => seedTwoTenants(c));
}, 60_000);

afterAll(async () => {
  await withClient((c) => teardownTwoTenants(c));
  await closeAppPool();
});

describe('live slot resolution — two tenants, two behaviors, zero code branches', () => {
  it('AC-1: tenant A default = sonnet, tenant B default = gpt-4o (from app_config)', async () => {
    const resolver = createCiypSlotResolver();
    const a = await makeGetModelSlot(resolver, coachA)('chat');
    const b = await makeGetModelSlot(resolver, coachB)('chat');
    expect(a?.model).toContain('claude-sonnet');
    expect(b?.model).toBe('openai/gpt-4o');
  });

  it('a tenant that omits a slot inherits the platform default (shallow merge)', async () => {
    // Neither seed tenant defines a bespoke `deep` override → inherits the platform default.
    const cfg = await loadSlotConfig(slotScopeFor(coachA));
    expect(cfg.deep?.model).toContain('claude-opus');
  });

  it('AC-2: updating A default + invalidate(A) makes the NEXT resolve read the new model, no restart', async () => {
    const resolver = createCiypSlotResolver();
    const before = await resolver.getModelSlot(slotScopeFor(coachA), 'default');
    expect(before.model).toContain('claude-sonnet');

    // Coach changes the model in app_config.model_routing.
    await withTenantTx(coachA, async (c) => {
      await c.query(
        `update app_config
            set model_routing = jsonb_set(model_routing, '{default}', '{"provider":"openrouter","model":"meta-llama/llama-3.3-70b"}'::jsonb)
          where tenant_id = $1`,
        [T_A],
      );
    });
    // Without invalidate the TTL cache would still serve the old value; the write path invalidates.
    resolver.invalidate(slotScopeFor(coachA));

    const after = await resolver.getModelSlot(slotScopeFor(coachA), 'default');
    expect(after.model).toBe('meta-llama/llama-3.3-70b');

    // B is unaffected (cross-tenant cache isolation).
    const b = await resolver.getModelSlot(slotScopeFor(coachB), 'default');
    expect(b.model).toBe('openai/gpt-4o');
  });
});
