/**
 * Eval harness ACs (PRD-002d):
 *   AC-1 key-free run: key-requiring specs report skipped, key-free specs complete, exit 0.
 *   AC-2 metric rows carry value/target/alert linked to the prompt-set version.
 *   AC-5 model-slug smoke fails loudly on an empty completion, naming slot + slug.
 *   AC-6 a Voyage 429 during an eval reports `blocked`, not `pass`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withClient, closeAppPool } from '../../src/lib/sport/db.js';
import { withTenantReadTx } from '../../src/lib/sport/tenant-context.js';
import { runEvals } from '../../src/evals/runner.js';
import { runSlugSmoke, SlugSmokeError } from '../../src/evals/smoke.js';
import type { EvalSpec } from '../../src/evals/types.js';
import type { CiypScope } from '../../src/lib/sport/scope-resolver.js';
import { seedTwoTenants, teardownTwoTenants, T_A } from '../sport/fixtures.js';

const coachA: CiypScope = { tenantId: T_A, context: 'coach' };

beforeAll(async () => {
  await withClient((c) => seedTwoTenants(c));
}, 60_000);

afterAll(async () => {
  await withClient((c) => teardownTwoTenants(c));
  await closeAppPool();
});

describe('eval runner — key-free posture', () => {
  it('AC-1: key-free specs complete; key-requiring specs are skipped (no false pass)', async () => {
    // Force the keyless posture regardless of the ambient env.
    const savedO = process.env.OPENROUTER_API_KEY;
    const savedV = process.env.VOYAGE_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.VOYAGE_API_KEY;
    try {
      const results = await runEvals({ scope: coachA });
      const determinism = results.find((r) => r.metric === 'cascade_determinism');
      const routing = results.find((r) => r.metric === 'routing_accuracy');
      expect(determinism?.status).toBe('ok'); // key-free → completes
      expect(determinism?.value).toBe(1);
      expect(routing?.status).toBe('skipped'); // needs model key → skipped, not passed
      expect(routing?.value).toBeNull();
    } finally {
      if (savedO) process.env.OPENROUTER_API_KEY = savedO;
      if (savedV) process.env.VOYAGE_API_KEY = savedV;
    }
  });

  it('AC-2: persisted snapshots carry value/target/alert linked to the prompt-set version', async () => {
    const results = await runEvals({ scope: coachA });
    expect(results.length).toBeGreaterThan(0);
    const row = await withTenantReadTx(coachA, async (c) =>
      (
        await c.query(
          `select metric, target, alert, status, score, data->>'prompt_set_version' pv
             from eval_snapshots where tenant_id=$1 and metric='cascade_determinism'
             order by created_at desc limit 1`,
          [T_A],
        )
      ).rows[0],
    );
    expect(row.metric).toBe('cascade_determinism');
    expect(Number(row.target)).toBe(1);
    expect(Number(row.alert)).toBe(1);
    expect(row.status).toBe('ok');
    expect(Number(row.score)).toBe(1);
    expect(row.pv).toBeTruthy();
  });

  it('AC-6: a Voyage 429 in a spec reports `blocked` (not pass), with a null score', async () => {
    const throwing: EvalSpec = {
      metric: 'retrieval_precision_library',
      feature: 'library',
      target: 0.7,
      alert: 0.4,
      needsModelKey: false,
      needsEmbedKey: false,
      goldenSetVersion: 'luminify-v1',
      async run() {
        throw new Error('Voyage API 429: rate limit exceeded');
      },
    };
    const [result] = await runEvals({ scope: coachA, specs: [throwing], runId: 'rl-run' });
    expect(result?.status).toBe('blocked');
    expect(result?.value).toBeNull();
    expect(result?.blockReason).toBe('rate_limited');

    const row = await withTenantReadTx(coachA, async (c) =>
      (
        await c.query(
          `select status, score, block_reason from eval_snapshots where tenant_id=$1 and run_id='rl-run' limit 1`,
          [T_A],
        )
      ).rows[0],
    );
    expect(row.status).toBe('blocked');
    expect(row.score).toBeNull(); // a blocked run records no score (constraint-backed)
    expect(row.block_reason).toBe('rate_limited');
  });

  it('one bad spec never aborts the run (the rest still complete)', async () => {
    const bad: EvalSpec = {
      metric: 'boom',
      target: 1,
      alert: 1,
      needsModelKey: false,
      needsEmbedKey: false,
      goldenSetVersion: 'luminify-v1',
      async run() {
        throw new Error('unexpected explosion');
      },
    };
    const results = await runEvals({ scope: coachA, persist: false, specs: [bad] });
    expect(results[0]?.status).toBe('blocked');
    expect(results[0]?.blockReason).toContain('explosion');
  });
});

describe('model-slug smoke test (AC-5)', () => {
  it('fails loudly naming slot + slug when a completion is empty', async () => {
    await expect(
      runSlugSmoke({ scope: coachA, caller: async () => '' }),
    ).rejects.toBeInstanceOf(SlugSmokeError);
  });

  it('passes when every chat-capable slot returns a non-empty completion', async () => {
    const probed = await runSlugSmoke({ scope: coachA, caller: async () => 'ok' });
    expect(probed.length).toBeGreaterThan(0);
    // Every probed slot is an OpenRouter chat-capable slot (embed/rerank excluded).
    for (const p of probed) expect(p.slug).toBeTruthy();
  });

  it('a bad slug (empty from one slot) names that exact slot', async () => {
    // Only `default` returns empty → the error names it.
    await expect(
      runSlugSmoke({
        scope: coachA,
        slots: ['default'],
        caller: async (_p, model) => (model.includes('sonnet') ? '' : 'ok'),
      }),
    ).rejects.toThrow(/default/);
  });
});
