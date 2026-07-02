/**
 * admin_audit_log writer. Called inside the SAME transaction as the mutation it records, so the
 * audit row is atomic with the change (no orphaned "we logged it but the write rolled back").
 * Every superadmin-switched mutation writes one; owner self-tenant management writes one too.
 */
import type pg from 'pg';

export interface AuditEntry {
  tenantId: string;
  actorUserId: string;
  actingAsSuperadmin: boolean;
  action: string;
  entity: string;
  entityId?: string | null;
}

export async function writeAudit(c: pg.PoolClient, e: AuditEntry): Promise<void> {
  await c.query(
    `insert into admin_audit_log
       (tenant_id, actor_user_id, acting_as_superadmin, action, entity, entity_id)
     values ($1,$2,$3,$4,$5,$6)`,
    [e.tenantId, e.actorUserId, e.actingAsSuperadmin, e.action, e.entity, e.entityId ?? null],
  );
}
