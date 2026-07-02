/**
 * Trace sink (correlation id, redaction, app:* widening) + PromptVersion write path
 * (rationale required) on the live DB.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withClient, closeAppPool } from '../../src/lib/sport/db.js';
import { withTenantReadTx } from '../../src/lib/sport/tenant-context.js';
import {
  createTraceAICall,
  recordAiTrace,
  flushTraces,
  redactText,
} from '../../src/lib/sport/trace-sink.js';
import {
  recordPromptVersion,
  PromptRationaleRequiredError,
} from '../../src/lib/sport/prompt-version.js';
import type { CiypScope } from '../../src/lib/sport/scope-resolver.js';
import { seedTwoTenants, teardownTwoTenants, T_A } from './fixtures.js';

const coachA: CiypScope = { tenantId: T_A, context: 'coach' };
const CORR = 'corr-trace-test-0001';

beforeAll(async () => {
  await withClient((c) => seedTwoTenants(c));
}, 60_000);

afterAll(async () => {
  await withClient((c) => teardownTwoTenants(c));
  await closeAppPool();
});

describe('trace sink', () => {
  it('redactText scrubs credential-shaped substrings', () => {
    expect(redactText('key sk-abcd1234efgh here')).toContain('[REDACTED]');
    expect(redactText('api_key=supersecretvalue')).toContain('[REDACTED]');
    expect(redactText('a normal message')).toBe('a normal message');
  });

  it('writes a row carrying the correlation id in data, tenant + member scoped', async () => {
    recordAiTrace(coachA, CORR, {
      eventType: 'app:custom_decision',
      feature: 'chat',
      data: { note: 'hello' },
    });
    await flushTraces();
    const row = await withTenantReadTx(coachA, async (c) =>
      (
        await c.query(
          `select event_type, data->>'correlation_id' corr from ai_traces
             where tenant_id=$1 and data->>'correlation_id'=$2 order by created_at desc limit 1`,
          [T_A, CORR],
        )
      ).rows[0],
    );
    expect(row.event_type).toBe('app:custom_decision'); // app:* widening is free text
    expect(row.corr).toBe(CORR);
  });

  it('createTraceAICall traces non-model decisions and re-throws on error (redacted)', async () => {
    const traceAICall = createTraceAICall({ scope: coachA, correlationId: CORR, feature: 'chat' });

    const ok = await traceAICall({
      eventType: 'routing',
      call: async () => 'classified',
    });
    expect(ok).toBe('classified');

    await expect(
      traceAICall({
        eventType: 'tool',
        call: async () => {
          throw new Error('boom with api_key=leakedsecret inside');
        },
      }),
    ).rejects.toThrow(/boom/);
    await flushTraces();

    const errRow = await withTenantReadTx(coachA, async (c) =>
      (
        await c.query(
          `select data->>'error' err from ai_traces
             where tenant_id=$1 and event_type='tool' and data->>'correlation_id'=$2
             order by created_at desc limit 1`,
          [T_A, CORR],
        )
      ).rows[0],
    );
    expect(errRow.err).toContain('[REDACTED]');
    expect(errRow.err).not.toContain('leakedsecret');
  });

  it('does NOT write a model_call row (the LLM caller owns the token-bearing one)', async () => {
    const traceAICall = createTraceAICall({ scope: coachA, correlationId: 'corr-model-skip' });
    await traceAICall({ eventType: 'model_call', call: async () => 'text' });
    await flushTraces();
    const n = await withTenantReadTx(coachA, async (c) =>
      Number(
        (
          await c.query(
            `select count(*)::int n from ai_traces where tenant_id=$1 and data->>'correlation_id'=$2`,
            [T_A, 'corr-model-skip'],
          )
        ).rows[0].n,
      ),
    );
    expect(n).toBe(0);
  });
});

describe('prompt-version write path', () => {
  it('AC-4/002d: an empty rationale is rejected (belt) before the DB', async () => {
    await expect(
      recordPromptVersion(coachA, {
        layer: 'tenant',
        blockId: 'tenantBrandVoice',
        content: 'warm, direct',
        changeRationale: '   ',
      }),
    ).rejects.toBeInstanceOf(PromptRationaleRequiredError);
  });

  it('002c AC-7: an L2 write records a prompt_versions row and bumps the prompt-set version', async () => {
    const before = await withTenantReadTx(coachA, async (c) =>
      (await c.query(`select prompt_set_version v from app_config where tenant_id=$1`, [T_A])).rows[0]
        .v,
    );
    const id = await recordPromptVersion(
      coachA,
      {
        layer: 'tenant',
        blockId: 'tenantBrandVoice',
        content: 'warm, direct, playful',
        changeRationale: 'coach tightened the brand voice',
      },
      { bumpPromptSet: true },
    );
    expect(id).toBeTruthy();
    const after = await withTenantReadTx(coachA, async (c) =>
      (
        await c.query(
          `select (select prompt_set_version from app_config where tenant_id=$1) v,
                  (select count(*)::int from prompt_versions where tenant_id=$1 and block_id='tenantBrandVoice') n`,
          [T_A],
        )
      ).rows[0],
    );
    expect(after.n).toBeGreaterThan(0);
    expect(after.v).not.toBe(before); // monotonic bump
  });
});
