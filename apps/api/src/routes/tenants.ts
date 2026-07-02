/**
 * /admin/tenants — superadmin-only tenant management (PRD-006a FR-4/5, AC-3/4/5).
 * These run as the bypassrls system role because they are inherently cross-tenant (list all,
 * create new, switch into). Every mutation writes an audit row in the SAME transaction.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../http/types.js';
import { requireSession, requireSuperadmin } from '../http/middleware.js';
import { withSystemTx } from '../lib/pool.js';
import { writeAudit } from '../audit/log.js';
import { PLATFORM_DEFAULT_MODEL_ROUTING } from './defaults.js';

export const tenantsRoute = new Hono<AppEnv>();

tenantsRoute.use('*', requireSession, requireSuperadmin);

const CreateTenant = z.object({
  slug: z
    .string()
    .trim()
    .min(2)
    .max(63)
    .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, 'slug must be lowercase alphanumeric/hyphen'),
  displayName: z.string().trim().min(1).max(120),
});

const SetStatus = z.object({ status: z.enum(['active', 'paused']) });

tenantsRoute.get('/', async (c) => {
  const rows = await withSystemTx((cl) =>
    cl
      .query<{
        id: string;
        slug: string;
        display_name: string;
        status: 'active' | 'paused';
        created_at: string;
        member_count: number;
        admin_count: number;
      }>(
        `select t.id, t.slug, t.display_name, t.status, t.created_at,
                (select count(*)::int from members m where m.tenant_id = t.id) as member_count,
                (select count(*)::int from admins a where a.tenant_id = t.id) as admin_count
           from tenants t
          order by t.created_at asc`,
      )
      .then((r) => r.rows),
  );
  return c.json({ tenants: rows });
});

tenantsRoute.post('/', async (c) => {
  const parsed = CreateTenant.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid', issues: parsed.error.issues }, 400);
  const { slug, displayName } = parsed.data;
  const p = c.get('principal');

  try {
    const created = await withSystemTx(async (cl) => {
      const ins = await cl.query<{ id: string; slug: string; display_name: string; status: string; created_at: string }>(
        `insert into tenants (slug, display_name, status) values ($1,$2,'active')
         returning id, slug, display_name, status, created_at`,
        [slug, displayName],
      );
      const tenant = ins.rows[0]!;
      // Q-1: a platform-default app_config row so slot resolution never faults pre-provisioning.
      await cl.query(
        `insert into app_config (tenant_id, model_routing) values ($1, $2::jsonb)`,
        [tenant.id, JSON.stringify(PLATFORM_DEFAULT_MODEL_ROUTING)],
      );
      await writeAudit(cl, {
        tenantId: tenant.id,
        actorUserId: p.authUserId,
        actingAsSuperadmin: true,
        action: 'tenant.create',
        entity: 'tenant',
        entityId: tenant.id,
      });
      return tenant;
    });
    return c.json({ tenant: created }, 201);
  } catch (err) {
    if (err instanceof Error && /unique|duplicate/i.test(err.message)) {
      return c.json({ error: 'slug already exists' }, 409);
    }
    throw err;
  }
});

tenantsRoute.patch('/:id/status', async (c) => {
  const id = c.req.param('id');
  const parsed = SetStatus.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid', issues: parsed.error.issues }, 400);
  const p = c.get('principal');

  const updated = await withSystemTx(async (cl) => {
    const r = await cl.query<{ id: string; status: string }>(
      `update tenants set status = $2 where id = $1 returning id, status`,
      [id, parsed.data.status],
    );
    if (r.rows.length === 0) return null;
    await writeAudit(cl, {
      tenantId: id,
      actorUserId: p.authUserId,
      actingAsSuperadmin: true,
      action: parsed.data.status === 'paused' ? 'tenant.suspend' : 'tenant.reactivate',
      entity: 'tenant',
      entityId: id,
    });
    return r.rows[0]!;
  });
  if (!updated) return c.json({ error: 'not found' }, 404);
  return c.json({ tenant: updated });
});

tenantsRoute.post('/:id/switch', async (c) => {
  const id = c.req.param('id');
  const p = c.get('principal');

  const target = await withSystemTx(async (cl) => {
    const r = await cl.query<{ id: string; display_name: string; status: 'active' | 'paused' }>(
      `select id, display_name, status from tenants where id = $1`,
      [id],
    );
    if (r.rows.length === 0) return null;
    await writeAudit(cl, {
      tenantId: id,
      actorUserId: p.authUserId,
      actingAsSuperadmin: true,
      action: 'tenant.switch',
      entity: 'tenant',
      entityId: id,
    });
    return r.rows[0]!;
  });
  if (!target) return c.json({ error: 'not found' }, 404);
  // The client stores this and sends X-Acting-Tenant on subsequent requests.
  return c.json({
    acting: { tenantId: target.id, tenantDisplayName: target.display_name, tenantStatus: target.status },
  });
});
