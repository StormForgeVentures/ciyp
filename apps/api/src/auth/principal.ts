/**
 * Principal resolution: verified session → who this actor is on the CIYP control plane.
 *
 * Runs as the bypassrls system role (no tenant scope exists yet — this is the chicken-and-egg
 * lookup that establishes it). Keyed ONLY by the verified auth_user_id from the JWT; request
 * body/query/headers are never consulted here. This is the single source of the tenant scope
 * that withTenantTx later enforces at the DB.
 */
import type pg from 'pg';
import { withSystemTx } from '../lib/pool.js';
import type { VerifiedSession } from './session.js';

export type AdminRole = 'owner' | 'team';

export interface AdminMembership {
  adminId: string;
  tenantId: string;
  role: AdminRole;
  displayName: string;
  /** The actor's home-tenant status (drives the suspended-instance state, AC-5). */
  tenantStatus: 'active' | 'paused';
  tenantDisplayName: string;
}

export interface Principal {
  authUserId: string;
  email: string;
  /** In the platform_operators allowlist → may manage/switch tenants. */
  isSuperadmin: boolean;
  /** Home-tenant admin membership, or null for a pure operator with no tenant. */
  admin: AdminMembership | null;
}

async function loadPrincipal(c: pg.PoolClient, session: VerifiedSession): Promise<Principal> {
  const op = await c.query<{ id: string }>(
    `select id from platform_operators where auth_user_id = $1 limit 1`,
    [session.authUserId],
  );

  const membership = await c.query<{
    admin_id: string;
    tenant_id: string;
    role: AdminRole;
    display_name: string;
    tenant_status: 'active' | 'paused';
    tenant_display_name: string;
  }>(
    `select a.id            as admin_id,
            a.tenant_id      as tenant_id,
            a.role           as role,
            a.display_name   as display_name,
            t.status         as tenant_status,
            t.display_name   as tenant_display_name
       from admins a
       join tenants t on t.id = a.tenant_id
      where a.auth_user_id = $1
      limit 1`,
    [session.authUserId],
  );

  const row = membership.rows[0];
  return {
    authUserId: session.authUserId,
    email: session.email,
    isSuperadmin: op.rows.length > 0,
    admin: row
      ? {
          adminId: row.admin_id,
          tenantId: row.tenant_id,
          role: row.role,
          displayName: row.display_name,
          tenantStatus: row.tenant_status,
          tenantDisplayName: row.tenant_display_name,
        }
      : null,
  };
}

export async function resolvePrincipal(session: VerifiedSession): Promise<Principal> {
  return withSystemTx((c) => loadPrincipal(c, session));
}
