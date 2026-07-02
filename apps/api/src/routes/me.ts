/**
 * GET /admin/me — the session + role + tenant context that drives nav gating and the
 * suspended-instance state. The client renders nav from `authorizedSections`, but every route
 * is independently gated server-side (nav is a convenience, not the fence).
 */
import { Hono } from 'hono';
import type { AppEnv } from '../http/types.js';
import { requireSession } from '../http/middleware.js';
import { actingScope } from '../http/scope.js';
import { withSystemTx } from '../lib/pool.js';

export type NavSection =
  | 'dashboard'
  | 'instance'
  | 'agent_studio'
  | 'library'
  | 'wallet'
  | 'settings'
  | 'tenants';

/** Sections a principal may see. Owner = all tenant sections; team = read-only subset; a
 *  superadmin additionally gets Tenants. Config surfaces (instance/agent studio) are owner-only. */
function authorizedSections(role: 'owner' | 'team' | null, isSuperadmin: boolean): NavSection[] {
  const out: NavSection[] = [];
  if (role) {
    out.push('dashboard', 'library', 'wallet', 'settings');
    if (role === 'owner') out.push('instance', 'agent_studio');
  }
  if (isSuperadmin) out.push('tenants');
  return out;
}

export const meRoute = new Hono<AppEnv>();

meRoute.use('*', requireSession);

meRoute.get('/', async (c) => {
  const p = c.get('principal');
  const scope = actingScope(c);

  // When a superadmin is acting inside a switched tenant, resolve that tenant's identity so the
  // banner + suspended state reflect the TARGET, not the operator's (absent) home tenant.
  let acting: {
    tenantId: string;
    actingAsSuperadmin: boolean;
    tenantDisplayName: string;
    tenantStatus: 'active' | 'paused';
  } | null = null;

  if (scope) {
    if (scope.actingAsSuperadmin) {
      const t = await withSystemTx((cl) =>
        cl.query<{ display_name: string; status: 'active' | 'paused' }>(
          `select display_name, status from tenants where id = $1`,
          [scope.tenantId],
        ),
      );
      const row = t.rows[0];
      if (row) {
        acting = {
          tenantId: scope.tenantId,
          actingAsSuperadmin: true,
          tenantDisplayName: row.display_name,
          tenantStatus: row.status,
        };
      }
    } else if (p.admin) {
      acting = {
        tenantId: p.admin.tenantId,
        actingAsSuperadmin: false,
        tenantDisplayName: p.admin.tenantDisplayName,
        tenantStatus: p.admin.tenantStatus,
      };
    }
  }

  return c.json({
    email: p.email,
    isSuperadmin: p.isSuperadmin,
    admin: p.admin
      ? {
          role: p.admin.role,
          displayName: p.admin.displayName,
          tenantId: p.admin.tenantId,
          tenantDisplayName: p.admin.tenantDisplayName,
          tenantStatus: p.admin.tenantStatus,
        }
      : null,
    acting,
    authorizedSections: authorizedSections(p.admin?.role ?? null, p.isSuperadmin),
  });
});
