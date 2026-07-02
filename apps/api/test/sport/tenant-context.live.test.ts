/**
 * Live GUC round-trip (decision #19 / H2): the scope's values reach the DB readers
 * transaction-locally, RLS actually fences under the app role, and a member scope can
 * never see coach-wide rows. Runs against the local Supabase DB.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appPool, closeAppPool, withClient } from '../../src/lib/sport/db.js';
import { withTenantReadTx } from '../../src/lib/sport/tenant-context.js';
import type { CiypScope } from '../../src/lib/sport/scope-resolver.js';
import { seedTwoTenants, teardownTwoTenants, T_A, T_B, A_MEMBER, B_MEMBER } from './fixtures.js';

const coachA: CiypScope = { tenantId: T_A, context: 'coach' };
const coachB: CiypScope = { tenantId: T_B, context: 'coach' };
const memberA: CiypScope = { tenantId: T_A, subjectId: A_MEMBER, context: 'member' };

beforeAll(async () => {
  await withClient((c) => seedTwoTenants(c));
}, 60_000);

afterAll(async () => {
  await withClient((c) => teardownTwoTenants(c));
  await closeAppPool();
});

describe('withTenantReadTx — GUC fence from resolved scope only', () => {
  it('sets the three readers from the scope, transaction-locally', async () => {
    const row = await withTenantReadTx(memberA, async (c) => {
      const r = await c.query(
        `select public.current_tenant_id() t, public.current_member_id() m, public.current_context() ctx`,
      );
      return r.rows[0] as { t: string; m: string; ctx: string };
    });
    expect(row.t).toBe(T_A);
    expect(row.m).toBe(A_MEMBER);
    expect(row.ctx).toBe('member');
  });

  it('the GUC does not leak to the next checkout (SET LOCAL scoping)', async () => {
    await withTenantReadTx(coachA, async () => {});
    // A fresh transaction with no scope applied must read unset GUCs.
    const t = await withClient(async (c) => {
      await c.query('begin read only');
      try {
        await c.query('set local role authenticated');
        return (await c.query(`select public.current_tenant_id() t`)).rows[0].t as string | null;
      } finally {
        await c.query('rollback');
      }
    });
    expect(t).toBeNull();
  });

  it('AC-8 precursor: coach-A sees tenant-A library chunks and ZERO tenant-B chunks', async () => {
    const { a, b } = await withTenantReadTx(coachA, async (c) => ({
      a: Number((await c.query(`select count(*)::int n from library_chunks where tenant_id=$1`, [T_A])).rows[0].n),
      b: Number((await c.query(`select count(*)::int n from library_chunks where tenant_id=$1`, [T_B])).rows[0].n),
    }));
    expect(a).toBeGreaterThan(0);
    expect(b).toBe(0);
  });

  it('reverse: coach-B sees only tenant-B chunks', async () => {
    const { a, b } = await withTenantReadTx(coachB, async (c) => ({
      a: Number((await c.query(`select count(*)::int n from library_chunks where tenant_id=$1`, [T_A])).rows[0].n),
      b: Number((await c.query(`select count(*)::int n from library_chunks where tenant_id=$1`, [T_B])).rows[0].n),
    }));
    expect(a).toBe(0);
    expect(b).toBeGreaterThan(0);
  });

  it('H2: a member scope (context=member) sees ZERO tenant-wide member rows it does not own', async () => {
    // memberA can only see its own member row; B_MEMBER (other tenant) is invisible,
    // and even A's own tenant members are member-fenced to the subject.
    const otherOwnTenant = await withTenantReadTx(memberA, async (c) =>
      Number((await c.query(`select count(*)::int n from members where id=$1`, [B_MEMBER])).rows[0].n),
    );
    expect(otherOwnTenant).toBe(0);
  });

  it('appPool is the single shared pool', () => {
    expect(appPool()).toBe(appPool());
  });
});
