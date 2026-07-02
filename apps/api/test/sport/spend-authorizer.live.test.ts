/**
 * SpendAuthorizer stub (PRD-002b AC-7): configured-allow by default; a configured deny
 * short-circuits with the documented shape and writes a governance trace row.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withClient, closeAppPool } from '../../src/lib/sport/db.js';
import { withTenantReadTx } from '../../src/lib/sport/tenant-context.js';
import { createSpendAuthorizerStub, SpendDeniedError } from '../../src/lib/sport/spend-authorizer.js';
import { flushTraces } from '../../src/lib/sport/trace-sink.js';
import type { CiypScope } from '../../src/lib/sport/scope-resolver.js';
import { seedTwoTenants, teardownTwoTenants, T_A } from './fixtures.js';
import type { AuthorizeRequest } from '@stormforgeventures/ciyp-shared';

const coachA: CiypScope = { tenantId: T_A, context: 'coach' };
const heavyReq: AuthorizeRequest = {
  tenantId: T_A,
  feature: 'coaching_chat',
  spendClass: 'heavy',
  estimatedCostMicros: 5000,
};

beforeAll(async () => {
  await withClient((c) => seedTwoTenants(c));
}, 60_000);

afterAll(async () => {
  await withClient((c) => teardownTwoTenants(c));
  await closeAppPool();
});

describe('spend authorizer stub', () => {
  it('configured-allow: heavy call gets an authToken; a governance trace is written', async () => {
    const corr = 'corr-spend-allow';
    const auth = createSpendAuthorizerStub(coachA, corr);
    const res = await auth.authorize(heavyReq);
    expect(res.allow).toBe(true);
    expect(res.reason).toBe('ok');
    expect(res.authToken).toBeTruthy();
    await flushTraces();
    const n = await withTenantReadTx(coachA, async (c) =>
      Number(
        (
          await c.query(
            `select count(*)::int n from ai_traces where tenant_id=$1 and event_type='spend_authorization' and data->>'correlation_id'=$2`,
            [T_A, corr],
          )
        ).rows[0].n,
      ),
    );
    expect(n).toBe(1);
  });

  it('AC-7: configured-deny short-circuits with the documented shape + a governance trace', async () => {
    const corr = 'corr-spend-deny';
    const auth = createSpendAuthorizerStub(coachA, corr, { allow: false });
    const res = await auth.authorize(heavyReq);
    expect(res.allow).toBe(false);
    expect(res.reason).toBe('insufficient_balance');
    expect(res.authToken).toBeNull();
    // The turn wraps a denial in the documented error to short-circuit.
    const denied = new SpendDeniedError(res.reason);
    expect(denied.reason).toBe('insufficient_balance');
    await flushTraces();
    const row = await withTenantReadTx(coachA, async (c) =>
      (
        await c.query(
          `select data->>'decision' d from ai_traces where tenant_id=$1 and event_type='spend_authorization' and data->>'correlation_id'=$2 limit 1`,
          [T_A, corr],
        )
      ).rows[0],
    );
    expect(row.d).toBe('deny');
  });

  it('settle + release write their own governance rows', async () => {
    const corr = 'corr-spend-settle';
    const auth = createSpendAuthorizerStub(coachA, corr);
    await auth.settle({ authToken: 'stub-auth-x', actualCostMicros: 4200 });
    await auth.release('stub-auth-x');
    await flushTraces();
    const n = await withTenantReadTx(coachA, async (c) =>
      Number(
        (
          await c.query(
            `select count(*)::int n from ai_traces where tenant_id=$1 and event_type in ('spend_settle','spend_release') and data->>'correlation_id'=$2`,
            [T_A, corr],
          )
        ).rows[0].n,
      ),
    );
    expect(n).toBe(2);
  });
});
