/**
 * PromptVersion write path (PRD-002b FR-7, consumed by 002c AC-7 + 002d AC-4).
 *
 * `recordPromptVersion` is SYNCHRONOUS (the write must land before the config activation
 * that triggered it returns) and the change rationale is REQUIRED — an empty rationale
 * rejects here (belt) and at the DB `change_rationale NOT NULL` column (suspenders).
 * Written on baseline registration (002a), cascade-affecting config writes (002c), and
 * coach-authored definition activation (PRD-006). Append-only, tenant-scoped, indefinite.
 */
import type { PoolClient } from 'pg';
import { withTenantTx } from './tenant-context.js';
import type { CiypScope } from './scope-resolver.js';

/** Cascade layers, mirroring the `prompt_cascade_layer` enum (migration 20260702120000). */
export type PromptCascadeLayer = 'platform' | 'tenant' | 'coach' | 'routing';

export interface PromptVersionInput {
  layer: PromptCascadeLayer;
  /** The cascade block id (e.g. `tenantBrandVoice`) or baseline id. */
  blockId: string;
  content: string;
  /** REQUIRED — the reason this prompt changed (audit invariant). */
  changeRationale: string;
  agentKind?: string | null;
  priorVersionId?: string | null;
  changedByAdminId?: string | null;
}

export class PromptRationaleRequiredError extends Error {
  constructor(blockId: string) {
    super(
      `recordPromptVersion(${blockId}): change_rationale is required and must be non-empty ` +
        `(H-3 / 002d AC-4 — a cascade-affecting write without a rationale is rejected).`,
    );
    this.name = 'PromptRationaleRequiredError';
  }
}

/** Insert one prompt_versions row using an EXISTING tenant-scoped client. Returns the id. */
export async function recordPromptVersionWithClient(
  client: PoolClient,
  tenantId: string,
  input: PromptVersionInput,
): Promise<string> {
  if (!input.changeRationale || input.changeRationale.trim() === '') {
    throw new PromptRationaleRequiredError(input.blockId);
  }
  const res = await client.query(
    `insert into prompt_versions
       (tenant_id, layer, agent_kind, block_id, content, prior_version_id,
        change_rationale, changed_by_admin_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8)
     returning id`,
    [
      tenantId,
      input.layer,
      input.agentKind ?? null,
      input.blockId,
      input.content,
      input.priorVersionId ?? null,
      input.changeRationale.trim(),
      input.changedByAdminId ?? null,
    ],
  );
  return (res.rows[0] as { id: string }).id;
}

/** Convenience: open a tenant-scoped tx and record. Also bumps the tenant prompt-set version. */
export async function recordPromptVersion(
  scope: CiypScope,
  input: PromptVersionInput,
  opts: { bumpPromptSet?: boolean } = {},
): Promise<string> {
  return withTenantTx(scope, async (client) => {
    const id = await recordPromptVersionWithClient(client, scope.tenantId, input);
    if (opts.bumpPromptSet) {
      // Monotonic prompt-set bump on cascade-affecting writes (002c AC-7). `v<N>` scheme.
      await client.query(
        `update app_config
            set prompt_set_version = 'v' || (
              coalesce(nullif(regexp_replace(prompt_set_version, '\\D', '', 'g'), '')::int, 0) + 1
            )
          where tenant_id = $1`,
        [scope.tenantId],
      );
    }
    return id;
  });
}
