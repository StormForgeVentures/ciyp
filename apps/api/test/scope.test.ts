/**
 * Tenant-scope invariant (project-state #19 / wave-1 H2). Proves the ONLY DB helper the admin
 * surface writes through:
 *   * drops to the non-bypassrls `authenticated` role,
 *   * sets app.tenant_id from the scope,
 *   * ALWAYS sets app.context='coach' and app.member_id='' — structurally, an admin request can
 *     never yield a member context, and no client value can flip it.
 * A member principal can never reach withTenantTx (there is no code path), and even if the scope
 * object were tampered with, context/member are hard-coded here.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { withTenantTx, withSystemTx, closePool } from '../src/lib/pool.js';

afterAll(async () => {
  await closePool();
});

describe('withTenantTx GUC binding', () => {
  it('runs as authenticated with coach context + empty member, scoped to the given tenant', async () => {
    const tenantId = await withSystemTx((c) =>
      c.query<{ id: string }>(`select id from tenants where slug = 'luminify'`).then((r) => r.rows[0]!.id),
    );

    const gucs = await withTenantTx({ tenantId }, async (c) => {
      const r = await c.query<{ role: string; tid: string; ctx: string; mid: string }>(
        `select current_user as role,
                current_setting('app.tenant_id', true) as tid,
                current_setting('app.context', true) as ctx,
                current_setting('app.member_id', true) as mid`,
      );
      return r.rows[0]!;
    });

    expect(gucs.role).toBe('authenticated');
    expect(gucs.tid).toBe(tenantId);
    expect(gucs.ctx).toBe('coach');
    expect(gucs.mid).toBe('');
  });

  it('the GUCs do not leak to the next pooled connection (SET LOCAL is transaction-scoped)', async () => {
    const tenantId = await withSystemTx((c) =>
      c.query<{ id: string }>(`select id from tenants where slug = 'luminify'`).then((r) => r.rows[0]!.id),
    );
    await withTenantTx({ tenantId }, async () => undefined);
    // A fresh system tx must see no residual app.* GUCs from the prior tenant tx.
    const residual = await withSystemTx((c) =>
      c.query<{ tid: string }>(`select current_setting('app.tenant_id', true) as tid`).then((r) => r.rows[0]!.tid),
    );
    expect(residual === '' || residual === null).toBe(true);
  });
});
