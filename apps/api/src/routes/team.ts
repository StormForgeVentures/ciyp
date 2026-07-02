/**
 * /admin/team — owner-only team management (PRD-006a FR + Settings-lite v1: owner adds a member
 * by email, assigns a role). Runs tenant-scoped (withTenantTx) so the RLS fence guarantees a
 * request can only ever read/write its own tenant's admins — a cross-tenant id resolves to 0
 * rows → 404 (AC-1). Every mutation writes an audit row in the same transaction.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../http/types.js';
import { requireSession, requireOwner } from '../http/middleware.js';
import { requireNotSuspended } from '../http/suspended.js';
import { actingScope } from '../http/scope.js';
import { withTenantTx } from '../lib/pool.js';
import { writeAudit } from '../audit/log.js';

export const teamRoute = new Hono<AppEnv>();

teamRoute.use('*', requireSession, requireOwner);

const AddMember = z.object({
  email: z.string().trim().email().max(254),
  displayName: z.string().trim().min(1).max(120),
  role: z.enum(['owner', 'team']).default('team'),
});
const SetRole = z.object({ role: z.enum(['owner', 'team']) });

teamRoute.get('/', async (c) => {
  const scope = actingScope(c);
  if (!scope) return c.json({ error: 'no tenant scope' }, 400);
  const rows = await withTenantTx(scope, (cl) =>
    cl
      .query<{ id: string; email: string; display_name: string; role: string; created_at: string }>(
        `select id, email, display_name, role, created_at from admins order by created_at asc`,
      )
      .then((r) => r.rows),
  );
  return c.json({ team: rows });
});

teamRoute.post('/', requireNotSuspended, async (c) => {
  const scope = actingScope(c);
  if (!scope) return c.json({ error: 'no tenant scope' }, 400);
  const parsed = AddMember.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid', issues: parsed.error.issues }, 400);
  const { email, displayName, role } = parsed.data;
  const p = c.get('principal');

  try {
    const member = await withTenantTx(scope, async (cl) => {
      const ins = await cl.query<{ id: string; email: string; display_name: string; role: string; created_at: string }>(
        `insert into admins (tenant_id, email, display_name, role) values ($1,$2,$3,$4)
         returning id, email, display_name, role, created_at`,
        [scope.tenantId, email, displayName, role],
      );
      const row = ins.rows[0]!;
      await writeAudit(cl, {
        tenantId: scope.tenantId,
        actorUserId: p.authUserId,
        actingAsSuperadmin: scope.actingAsSuperadmin,
        action: 'team.add_member',
        entity: 'admin',
        entityId: row.id,
      });
      return row;
    });
    return c.json({ member }, 201);
  } catch (err) {
    if (err instanceof Error && /unique|duplicate/i.test(err.message)) {
      return c.json({ error: 'a member with that email already exists' }, 409);
    }
    throw err;
  }
});

teamRoute.patch('/:id', requireNotSuspended, async (c) => {
  const id = c.req.param('id');
  const scope = actingScope(c);
  if (!scope) return c.json({ error: 'no tenant scope' }, 400);
  const parsed = SetRole.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid', issues: parsed.error.issues }, 400);
  const p = c.get('principal');

  const updated = await withTenantTx(scope, async (cl) => {
    const r = await cl.query<{ id: string; role: string }>(
      `update admins set role = $2 where id = $1 returning id, role`,
      [id, parsed.data.role],
    );
    if (r.rows.length === 0) return null;
    await writeAudit(cl, {
      tenantId: scope.tenantId,
      actorUserId: p.authUserId,
      actingAsSuperadmin: scope.actingAsSuperadmin,
      action: 'team.set_role',
      entity: 'admin',
      entityId: id,
    });
    return r.rows[0]!;
  });
  if (!updated) return c.json({ error: 'not found' }, 404);
  return c.json({ member: updated });
});
