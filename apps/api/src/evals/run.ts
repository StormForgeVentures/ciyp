/**
 * `pnpm evals` entrypoint (PRD-002d §4.2). Resolves the seed tenant's coach scope, runs
 * the model-slug smoke test (when a key is present), then the metric set, persists the
 * snapshots, prints a summary, and exits 0 on a keyless run (AC-1). A smoke failure or an
 * unexpected error exits non-zero (loud); `blocked`/`skipped` metrics do NOT fail the run.
 *
 * Usage: `pnpm evals [tenant-slug]` (default: luminify).
 */
import { appPool, closeAppPool, withClient } from '../lib/sport/db.js';
import type { CiypScope } from '../lib/sport/scope-resolver.js';
import { runEvals } from './runner.js';
import { runSlugSmoke, SlugSmokeError } from './smoke.js';

async function resolveTenantScope(slug: string): Promise<CiypScope> {
  const id = await withClient(async (c) => {
    const r = await c.query(`select id from tenants where slug = $1`, [slug]);
    if (r.rows.length === 0) throw new Error(`no tenant with slug '${slug}'`);
    return r.rows[0].id as string;
  });
  return { tenantId: id, context: 'coach' };
}

async function main(): Promise<void> {
  const slug = process.argv[2] ?? 'luminify';
  const scope = await resolveTenantScope(slug);

  // Model-slug smoke — only when a model key is present (keyless CI cannot probe live).
  if (process.env.OPENROUTER_API_KEY?.trim()) {
    const probed = await runSlugSmoke({ scope });
    console.warn(`smoke: ${probed.length} chat-capable slot(s) returned non-empty completions.`);
  } else {
    console.warn('smoke: OPENROUTER_API_KEY absent — model-slug smoke SKIPPED (keyless run).');
  }

  const results = await runEvals({ scope });
  console.warn(`\nEval results for '${slug}' (run persisted to eval_snapshots):`);
  for (const r of results) {
    const v = r.value === null ? '—' : r.value.toFixed(4);
    console.warn(`  ${r.status.padEnd(8)} ${r.metric.padEnd(30)} value=${v} target=${r.target} alert=${r.alert}${r.blockReason ? ` (${r.blockReason})` : ''}`);
  }

  const alerts = results.filter((r) => r.status === 'alert');
  if (alerts.length > 0) console.warn(`\n${alerts.length} metric(s) below alert threshold.`);
  // Keyless run exits 0 (AC-1): skipped/blocked/alert do not fail the process. Only a
  // thrown smoke failure or infra error (below) exits non-zero.
}

main()
  .then(() => closeAppPool())
  .then(() => process.exit(0))
  .catch(async (err) => {
    await closeAppPool().catch(() => {});
    if (err instanceof SlugSmokeError) {
      console.error(`\nEVALS FAILED (smoke): ${err.message}`);
    } else {
      console.error(`\nEVALS FAILED: ${(err as Error)?.message ?? err}`);
    }
    process.exit(1);
  });

// Keep the pool import referenced for side-effect-free typecheck.
void appPool;
