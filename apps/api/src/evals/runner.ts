/**
 * Eval runner (PRD-002d §4.2). Key-free posture:
 *   - a spec that needs an absent key reports `skipped` (never runs, never a false pass);
 *   - a spec returning `null` self-skips (clean absence);
 *   - one bad spec never aborts the run (its failure is captured, the rest continue);
 *   - a provider rate-limit (Voyage 429) reports `blocked`, NOT `pass` (AC-6);
 *   - the process exits 0 on a keyless run (AC-1).
 *
 * Every result is persisted to `eval_snapshots` (value, target, alert, status) under the
 * tenant's coach scope, linked to the prompt-set version being evaluated (AC-2).
 */
import { randomUUID } from 'node:crypto';
import { withTenantTx } from '../lib/sport/tenant-context.js';
import type { CiypScope } from '../lib/sport/scope-resolver.js';
import { EVAL_REGISTRY } from './registry.js';
import { isRateLimit, type EvalResult, type EvalSpec, type EvalContext } from './types.js';

export interface RunEvalsOptions {
  scope: CiypScope;
  specs?: readonly EvalSpec[];
  /** Skip the eval_snapshots persistence (unit tests that only assert statuses). */
  persist?: boolean;
  runId?: string;
}

function statusFor(value: number, alert: number): 'ok' | 'alert' {
  return value < alert ? 'alert' : 'ok';
}

/** Run the metric set; returns one result per spec. Never throws for a spec failure. */
export async function runEvals(opts: RunEvalsOptions): Promise<EvalResult[]> {
  const specs = opts.specs ?? EVAL_REGISTRY;
  const runId = opts.runId ?? randomUUID();
  const hasModelKey = !!process.env.OPENROUTER_API_KEY?.trim();
  const hasEmbedKey = !!process.env.VOYAGE_API_KEY?.trim();
  const ctx: EvalContext = { scope: opts.scope, hasModelKey, hasEmbedKey, runId };

  const results: EvalResult[] = [];
  for (const spec of specs) {
    const base = {
      metric: spec.metric,
      feature: spec.feature,
      target: spec.target,
      alert: spec.alert,
      goldenSetVersion: spec.goldenSetVersion,
    };

    // Key gate — a spec needing an absent key is skipped, never a false pass.
    if ((spec.needsModelKey && !hasModelKey) || (spec.needsEmbedKey && !hasEmbedKey)) {
      results.push({ ...base, status: 'skipped', value: null, sampleSize: 0, blockReason: 'missing_key' });
      continue;
    }

    try {
      const outcome = await spec.run(ctx);
      if (outcome === null || outcome.value === null) {
        results.push({ ...base, status: 'skipped', value: null, sampleSize: outcome?.sampleSize ?? 0 });
        continue;
      }
      results.push({
        ...base,
        status: statusFor(outcome.value, spec.alert),
        value: outcome.value,
        sampleSize: outcome.sampleSize,
        ...(outcome.blockReason ? { blockReason: outcome.blockReason } : {}),
        ...(outcome.data ? { data: outcome.data } : {}),
      });
    } catch (err) {
      // A provider rate-limit is a BLOCK (not a pass, not a fail-as-alert) — AC-6.
      if (isRateLimit(err)) {
        results.push({ ...base, status: 'blocked', value: null, sampleSize: 0, blockReason: 'rate_limited' });
      } else {
        // One bad spec never aborts the run; capture it as a blocked row with the reason.
        results.push({
          ...base,
          status: 'blocked',
          value: null,
          sampleSize: 0,
          blockReason: `error: ${(err as Error)?.message?.slice(0, 200) ?? 'unknown'}`,
        });
      }
    }
  }

  if (opts.persist !== false) await persistSnapshots(opts.scope, runId, results);
  return results;
}

/** Persist each result as an eval_snapshots row (blocked rows carry a null score). */
async function persistSnapshots(scope: CiypScope, runId: string, results: EvalResult[]): Promise<void> {
  await withTenantTx(scope, async (client) => {
    const pv = await client.query(
      `select prompt_set_version from app_config where tenant_id = $1`,
      [scope.tenantId],
    );
    const promptSet = (pv.rows[0]?.prompt_set_version ?? 'v1') as string;
    for (const r of results) {
      await client.query(
        `insert into eval_snapshots
           (tenant_id, metric, feature, golden_set_version, score, target, alert, status,
            run_id, block_reason, sample_size, data)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)`,
        [
          scope.tenantId,
          r.metric,
          r.feature ?? null,
          r.goldenSetVersion,
          r.status === 'blocked' || r.status === 'skipped' ? null : r.value,
          r.target,
          r.alert,
          // Schema enum is ok|alert|blocked; a `skipped` metric persists as `blocked`
          // (a non-measurement, never a pass) with a distinguishing block_reason.
          r.status === 'skipped' ? 'blocked' : r.status,
          runId,
          r.status === 'skipped' ? (r.blockReason ?? 'skipped') : (r.blockReason ?? null),
          r.sampleSize,
          JSON.stringify({ prompt_set_version: promptSet, ...(r.data ?? {}), skipped: r.status === 'skipped' }),
        ],
      );
    }
  });
}
