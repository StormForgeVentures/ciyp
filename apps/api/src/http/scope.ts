/**
 * Effective tenant scope for a request.
 *
 * Security model (project-state #19): the tenant a request acts in is derived from the verified
 * principal, NOT from client input — with ONE gated exception. A superadmin may switch into a
 * target tenant; the target arrives in the X-Acting-Tenant header and is honored ONLY because
 * `isSuperadmin` was verified server-side. For everyone else the header is ignored and the scope
 * is pinned to the actor's own membership, so a coach admin of tenant A passing tenant B's id
 * gets tenant A's scope → tenant B rows are invisible (AC-1).
 */
import type { Context } from 'hono';
import type { AppEnv } from './types.js';
import { ACTING_TENANT_HEADER } from './types.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ActingScope {
  tenantId: string;
  /** True when a superadmin is acting inside a tenant they switched into (drives audit + banner). */
  actingAsSuperadmin: boolean;
}

/**
 * Returns the acting scope, or null when there is none (a pure superadmin who hasn't switched —
 * only /admin/tenants is reachable in that state).
 */
export function actingScope(c: Context<AppEnv>): ActingScope | null {
  const p = c.get('principal');
  const requested = c.req.header(ACTING_TENANT_HEADER)?.trim();

  if (p.isSuperadmin && requested && UUID_RE.test(requested)) {
    return { tenantId: requested, actingAsSuperadmin: p.admin?.tenantId !== requested };
  }
  if (p.admin) {
    return { tenantId: p.admin.tenantId, actingAsSuperadmin: false };
  }
  return null;
}
