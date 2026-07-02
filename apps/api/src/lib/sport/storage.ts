/**
 * Artifact storage port (PRD-002b FR-7). Coaching-process artifacts (the deterministic
 * plan-document render from `@ciyp/agents`, and any authored output) persist to
 * `coaching_outputs` under the member+thread scope — tenant- AND member-fenced by RLS,
 * so a stored artifact is only ever readable within the producing member's scope.
 *
 * Interim seam: when sport-server's `ArtifactStore` (egress/clearance) is wired into a
 * driven turn (issues #25–#27), this same `storeOutput`/`readOutputs` shape backs the
 * `emitArtifact` port with no call-site change.
 */
import { withTenantTx, withTenantReadTx } from './tenant-context.js';
import type { CiypScope } from './scope-resolver.js';

export interface CoachingOutput {
  memberId: string;
  threadId: string;
  /** Opaque coaching-process/agent key (de-enumed). */
  agentKind: string;
  output: Record<string, unknown>;
}

/** Persist one coaching output; returns its id. Requires a member-scoped scope. */
export async function storeOutput(scope: CiypScope, artifact: CoachingOutput): Promise<string> {
  return withTenantTx(scope, async (client) => {
    const res = await client.query(
      `insert into coaching_outputs (tenant_id, member_id, thread_id, agent_kind, output)
       values ($1,$2,$3,$4,$5::jsonb) returning id`,
      [scope.tenantId, artifact.memberId, artifact.threadId, artifact.agentKind, JSON.stringify(artifact.output)],
    );
    return (res.rows[0] as { id: string }).id;
  });
}

export interface StoredOutput {
  id: string;
  agentKind: string;
  output: Record<string, unknown>;
  occurredAt: Date;
}

/** Read a member's stored outputs (most-recent first), optionally for one thread. */
export async function readOutputs(
  scope: CiypScope,
  memberId: string,
  threadId?: string,
): Promise<StoredOutput[]> {
  return withTenantReadTx(scope, async (client) => {
    const res = await client.query(
      `select id, agent_kind, output, occurred_at
         from coaching_outputs
        where member_id = $1 ${threadId ? 'and thread_id = $2' : ''}
        order by occurred_at desc`,
      threadId ? [memberId, threadId] : [memberId],
    );
    return (res.rows as { id: string; agent_kind: string; output: Record<string, unknown>; occurred_at: Date }[]).map(
      (r) => ({ id: r.id, agentKind: r.agent_kind, output: r.output, occurredAt: r.occurred_at }),
    );
  });
}
