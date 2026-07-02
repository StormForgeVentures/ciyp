/**
 * GET /admin/dashboard — v1 placeholder shell rendering seed-backed tenant identity + a few
 * live counts (PRD-006a FR-7). Proves live-DB binding on real seed; no analytics (P1). Runs
 * tenant-scoped, so counts come through the RLS fence — the numbers are the tenant's own.
 */
import { Hono } from 'hono';
import type pg from 'pg';
import type { AppEnv } from '../http/types.js';
import { requireSession } from '../http/middleware.js';
import { actingScope } from '../http/scope.js';
import { withTenantTx } from '../lib/pool.js';

export const dashboardRoute = new Hono<AppEnv>();

dashboardRoute.use('*', requireSession);

const count = async (c: pg.PoolClient, table: string): Promise<number> =>
  Number((await c.query<{ n: string }>(`select count(*)::int as n from ${table}`)).rows[0]!.n);

dashboardRoute.get('/', async (c) => {
  const scope = actingScope(c);
  if (!scope) return c.json({ error: 'no tenant scope' }, 400);

  const data = await withTenantTx(scope, async (cl) => {
    const identity = await cl.query<{
      id: string;
      slug: string;
      display_name: string;
      status: 'active' | 'paused';
      branding: Record<string, unknown>;
    }>(
      `select t.id, t.slug, t.display_name, t.status, coalesce(ac.branding, '{}'::jsonb) as branding
         from tenants t
         left join app_config ac on ac.tenant_id = t.id
        where t.id = $1`,
      [scope.tenantId],
    );
    const tenant = identity.rows[0] ?? null;
    if (!tenant) return null;

    const wallet = await cl.query<{ balance_credits: string }>(
      `select balance_credits from wallets where tenant_id = $1`,
      [scope.tenantId],
    );

    return {
      tenant: {
        id: tenant.id,
        slug: tenant.slug,
        displayName: tenant.display_name,
        status: tenant.status,
        branding: tenant.branding,
      },
      counts: {
        members: await count(cl, 'members'),
        libraryItems: await count(cl, 'library_items'),
        team: await count(cl, 'admins'),
      },
      walletBalanceCredits: wallet.rows[0] ? Number(wallet.rows[0].balance_credits) : 0,
    };
  });

  if (!data) return c.json({ error: 'not found' }, 404);
  return c.json(data);
});
