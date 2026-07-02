// RLS isolation proof (PRD-001b task 3.5 / AC-2..AC-6). Proves the two-layer GUC
// fence on a REAL local DB: a structural sweep over every tenant-scoped table plus
// row-level cross-tenant + member-fence proofs on a connected fixture graph for two
// tenants. Queries run as the non-bypassrls `authenticated` role with app.tenant_id
// / app.member_id GUCs set — exactly how the backend reaches the DB.
//
// Fixture ids are module-namespaced (iso-*) so they never collide with the seed
// tenant or a parallel test file. Fixtures carry NO append-only ledger rows, so
// afterAll's cascade delete is not blocked by the guard trigger.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { makePool, withClient } from '../src/lib/pg.js';

const pool = makePool();

// Module-unique fixture UUIDs (iso namespace).
const TA = 'a5011501-0000-4000-8000-00000000000a';
const TB = 'b5011501-0000-4000-8000-00000000000b';
const A_M1 = 'a5011501-0000-4000-8000-0000000000a1';
const A_M2 = 'a5011501-0000-4000-8000-0000000000a2';
const B_M1 = 'b5011501-0000-4000-8000-0000000000b1';
const A_ADMIN = 'a5011501-0000-4000-8000-0000000000da';
const B_ADMIN = 'b5011501-0000-4000-8000-0000000000db';

// Member-fenced tables in the fixture graph → (table, member column).
const MEMBER_FENCED: [string, string][] = [
  ['members', 'id'],
  ['member_facts', 'member_id'],
  ['member_recent_state', 'member_id'],
  ['check_ins', 'member_id'],
  ['chat_threads', 'member_id'],
  ['chat_messages', 'member_id'],
  ['member_uploads', 'member_id'],
  ['member_plans', 'member_id'],
  ['coaching_outputs', 'member_id'],
];
// Tenant-only fixture tables.
const TENANT_ONLY = [
  'app_config',
  'admins',
  'tenant_archetypes',
  'tenant_tiers',
  'coaching_process_definitions',
  'entitlements',
  'library_items',
  'library_chunks',
  'wallets',
  'ai_traces',
];
const ALL_FIXTURE_TABLES = [...MEMBER_FENCED.map(([t]) => t), ...TENANT_ONLY];

async function seedTenantGraph(c: pg.PoolClient, t: string, m1: string, m2: string | null, admin: string): Promise<void> {
  await c.query(`insert into tenants (id, slug, display_name) values ($1,$2,$3)`, [t, `iso-${t.slice(0, 8)}`, `iso ${t.slice(0, 4)}`]);
  await c.query(`insert into app_config (tenant_id, model_routing) values ($1, '{"default":{"provider":"x","model":"y"}}'::jsonb)`, [t]);
  await c.query(`insert into admins (id, tenant_id, email, display_name, role) values ($1,$2,$3,'iso admin','owner')`, [admin, t, `admin-${t.slice(0, 6)}@iso`]);
  await c.query(`insert into tenant_archetypes (tenant_id, key, label, prompt_fragment) values ($1,'op','Op','frag')`, [t]);
  await c.query(`insert into tenant_tiers (tenant_id, key, label) values ($1,'core','Core')`, [t]);
  await c.query(`insert into coaching_process_definitions (tenant_id, key, title, directive) values ($1,'daily','Daily','do the thing')`, [t]);
  await c.query(`insert into wallets (tenant_id, balance_credits) values ($1, 1000)`, [t]);
  await c.query(`insert into ai_traces (tenant_id, event_type, feature) values ($1,'model_call','chat')`, [t]);
  await c.query(`insert into library_items (tenant_id, kind, title, storage_kind, storage_id, created_by_admin_id) values ($1,'article','Iso Doc','supabase_storage','iso/1',$2)`, [t, admin]);
  const item = (await c.query(`select id from library_items where tenant_id=$1 limit 1`, [t])).rows[0] as { id: string };
  await c.query(`insert into library_chunks (tenant_id, library_item_id, chunk_index, text) values ($1,$2,0,'iso chunk text')`, [t, item.id]);

  const members = m2 ? [m1, m2] : [m1];
  for (const [i, mid] of members.entries()) {
    await c.query(`insert into members (id, tenant_id, email, display_name, archetype_key, tier_key) values ($1,$2,$3,$4,'op','core')`, [mid, t, `iso-m${i}-${t.slice(0, 6)}@iso`, `iso m${i}`]);
    await c.query(`insert into member_facts (tenant_id, member_id, fact, source) values ($1,$2,$3,'explicit')`, [t, mid, `fact for ${mid}`]);
    await c.query(`insert into member_recent_state (member_id, tenant_id, state) values ($1,$2,'iso state')`, [mid, t]);
    await c.query(`insert into check_ins (tenant_id, member_id, local_date, energy, clarity, execution) values ($1,$2, current_date - $3::int, 5,5,5)`, [t, mid, i]);
    await c.query(`insert into chat_threads (id, tenant_id, member_id, agent_kind, title) values (gen_random_uuid(),$1,$2,'daily','Iso thread')`, [t, mid]);
    const thread = (await c.query(`select id from chat_threads where member_id=$1 limit 1`, [mid])).rows[0] as { id: string };
    await c.query(`insert into chat_messages (tenant_id, member_id, thread_id, role, parts) values ($1,$2,$3,'user','[{"type":"text","text":"hi"}]'::jsonb)`, [t, mid, thread.id]);
    await c.query(`insert into member_uploads (tenant_id, member_id, kind, storage_path) values ($1,$2,'journal_text','iso/up')`, [t, mid]);
    await c.query(`insert into member_plans (tenant_id, member_id, source, period_start_date, period_end_date) values ($1,$2,'member_authored', current_date, current_date + 30)`, [t, mid]);
    await c.query(`insert into coaching_outputs (tenant_id, member_id, thread_id, agent_kind, output) values ($1,$2,$3,'daily','{}'::jsonb)`, [t, mid, thread.id]);
    await c.query(`insert into entitlements (tenant_id, member_id, sku, source) values ($1,$2,'coaching_chat','manual')`, [t, mid]);
  }
}

/**
 * Run fn as the non-bypassrls app role with the given GUC scope; always reset.
 * app.context selects the fail-closed member fence path (H1): 'coach' sees all
 * tenant member rows; 'member' (or unset) requires a matching non-null member GUC.
 */
async function asApp<T>(
  scope: { tenant?: string; member?: string; context?: 'coach' | 'member' },
  fn: (c: pg.PoolClient) => Promise<T>,
): Promise<T> {
  return withClient(pool, async (c) => {
    try {
      await c.query(`set role authenticated`);
      await c.query(`select set_config('app.tenant_id', $1, false)`, [scope.tenant ?? '']);
      await c.query(`select set_config('app.member_id', $1, false)`, [scope.member ?? '']);
      await c.query(`select set_config('app.context', $1, false)`, [scope.context ?? '']);
      return await fn(c);
    } finally {
      await c.query(`select set_config('app.tenant_id', '', false)`);
      await c.query(`select set_config('app.member_id', '', false)`);
      await c.query(`select set_config('app.context', '', false)`);
      await c.query(`reset role`);
    }
  });
}

const countIn = async (c: pg.PoolClient, table: string, tenant: string): Promise<number> =>
  Number((await c.query(`select count(*)::int n from ${table} where tenant_id = $1`, [tenant])).rows[0].n);

beforeAll(async () => {
  await withClient(pool, async (c) => {
    // Clean any prior run, then build both tenant graphs (as bypassrls postgres).
    await c.query(`delete from tenants where id = any($1::uuid[])`, [[TA, TB]]);
    await seedTenantGraph(c, TA, A_M1, A_M2, A_ADMIN);
    await seedTenantGraph(c, TB, B_M1, null, B_ADMIN);
  });
}, 60_000);

afterAll(async () => {
  await withClient(pool, async (c) => {
    await c.query(`delete from tenants where id = any($1::uuid[])`, [[TA, TB]]);
  });
  await pool.end();
});

describe('two-layer RLS isolation', () => {
  it('structural sweep: every tenant-scoped table has USING + WITH CHECK tenant policy', async () => {
    const rows = await withClient(pool, async (c) =>
      (
        await c.query(`
          with tenant_tables as (
            select c.relname
            from pg_class c join pg_namespace n on n.oid=c.relnamespace
            join pg_attribute a on a.attrelid=c.oid and a.attname='tenant_id' and a.attnum>0 and not a.attisdropped
            where n.nspname='public' and c.relkind='r'
          )
          select tt.relname
          from tenant_tables tt
          left join pg_policies p
            on p.schemaname='public' and p.tablename=tt.relname
           and p.policyname = tt.relname || '_tenant_isolation'
           and p.qual is not null and p.with_check is not null
          where p.policyname is null`)
      ).rows,
    );
    expect(rows, `tables missing a complete tenant policy: ${rows.map((r) => r.relname).join(', ')}`).toHaveLength(0);
  });

  it('AC-3: tenant-A GUC returns only tenant-A rows and zero tenant-B rows on every fixture table', async () => {
    await asApp({ tenant: TA, context: 'coach' }, async (c) => {
      for (const table of ALL_FIXTURE_TABLES) {
        const aRows = await countIn(c, table, TA);
        const bRows = await countIn(c, table, TB);
        expect(aRows, `${table}: expected tenant-A rows visible`).toBeGreaterThan(0);
        expect(bRows, `${table}: tenant-B rows LEAKED under tenant-A GUC`).toBe(0);
      }
    });
  });

  it('AC-3 (reverse): tenant-B GUC returns only tenant-B rows and zero tenant-A rows', async () => {
    await asApp({ tenant: TB, context: 'coach' }, async (c) => {
      for (const table of ALL_FIXTURE_TABLES) {
        expect(await countIn(c, table, TA), `${table}: tenant-A rows leaked under tenant-B GUC`).toBe(0);
        expect(await countIn(c, table, TB)).toBeGreaterThan(0);
      }
    });
  });

  it('AC-4: member fence — member-1 context sees only member-1 rows within the tenant', async () => {
    await asApp({ tenant: TA, member: A_M1, context: 'member' }, async (c) => {
      for (const [table, col] of MEMBER_FENCED) {
        const mine = Number((await c.query(`select count(*)::int n from ${table} where ${col} = $1`, [A_M1])).rows[0].n);
        const other = Number((await c.query(`select count(*)::int n from ${table} where ${col} = $1`, [A_M2])).rows[0].n);
        expect(mine, `${table}: member-1 should see own rows`).toBeGreaterThan(0);
        expect(other, `${table}: member-2 rows LEAKED to member-1 (fence broken)`).toBe(0);
      }
    });
  });

  it('AC-4: member fence is independent — switching member within the tenant changes visibility', async () => {
    const m1Facts = await asApp({ tenant: TA, member: A_M1, context: 'member' }, async (c) =>
      Number((await c.query(`select count(*)::int n from member_facts`)).rows[0].n),
    );
    const m2Facts = await asApp({ tenant: TA, member: A_M2, context: 'member' }, async (c) =>
      Number((await c.query(`select count(*)::int n from member_facts`)).rows[0].n),
    );
    const coachFacts = await asApp({ tenant: TA, context: 'coach' }, async (c) =>
      Number((await c.query(`select count(*)::int n from member_facts`)).rows[0].n),
    );
    // Each member sees exactly their own fact; explicit coach context sees both.
    expect(m1Facts).toBe(1);
    expect(m2Facts).toBe(1);
    expect(coachFacts).toBe(2);
  });

  // H1 remediation: the member fence fails CLOSED. A member-context session that
  // sets the tenant GUC but omits app.member_id must see ZERO member rows — not the
  // whole tenant (the pre-fix fail-open behaviour that promoted a member to coach).
  it('H1: member context with member GUC unset is fail-closed (zero member rows)', async () => {
    await asApp({ tenant: TA, context: 'member' }, async (c) => {
      for (const [table] of MEMBER_FENCED) {
        const n = Number((await c.query(`select count(*)::int n from ${table} where tenant_id = $1`, [TA])).rows[0].n);
        expect(n, `${table}: member context w/o member GUC LEAKED tenant rows (fail-open)`).toBe(0);
      }
    });
  });

  // The inverse guard: an UNSET context is treated as member-scoped (fail-closed),
  // NOT as coach — coach-wide visibility must be an explicit opt-in.
  it('H1: unset context (no coach opt-in) is member-scoped, not coach-wide', async () => {
    await asApp({ tenant: TA }, async (c) => {
      const n = Number((await c.query(`select count(*)::int n from member_facts where tenant_id = $1`, [TA])).rows[0].n);
      expect(n, 'unset context defaulted to coach-wide visibility (should fail closed)').toBe(0);
    });
  });

  it('AC-2/AC-5: unset tenant GUC is fail-closed (zero rows), never a leak', async () => {
    await asApp({}, async (c) => {
      for (const table of ALL_FIXTURE_TABLES) {
        const total = Number((await c.query(`select count(*)::int n from ${table} where tenant_id = any($1::uuid[])`, [[TA, TB]])).rows[0].n);
        expect(total, `${table}: rows visible with NO tenant GUC set`).toBe(0);
      }
    });
  });

  it('AC-5: append-only ledgers reject UPDATE/DELETE even inside a tenant scope', async () => {
    await asApp({ tenant: TA, context: 'coach' }, async (c) => {
      await c.query('begin');
      try {
        await c.query(
          `insert into usage_ledger (tenant_id, feature, idempotency_key, priced_cost_micros) values ($1,'chat','iso-key-1',100)`,
          [TA],
        );
        await expect(c.query(`update usage_ledger set priced_cost_micros = 1 where idempotency_key='iso-key-1'`)).rejects.toThrow();
        await expect(c.query(`delete from usage_ledger where idempotency_key='iso-key-1'`)).rejects.toThrow();
      } finally {
        await c.query('rollback');
      }
    });
  });

  // C1 remediation: TRUNCATE is RLS-exempt and skips the row-level append-only guard.
  // The app role must NOT be able to wipe the money ledgers — both by REVOKE (no
  // TRUNCATE privilege → permission denied) and by the BEFORE TRUNCATE statement guard.
  it('C1: append-only money ledgers reject TRUNCATE as the app role', async () => {
    for (const ledger of ['wallet_ledger', 'usage_ledger']) {
      await asApp({ tenant: TA, context: 'coach' }, async (c) => {
        await c.query('begin');
        try {
          await expect(c.query(`truncate ${ledger}`), `${ledger}: TRUNCATE was NOT rejected`).rejects.toThrow();
        } finally {
          await c.query('rollback');
        }
      });
    }
  });

  // M1 remediation: idempotency uniqueness is per-tenant, so the same key inserts
  // independently under two different tenants (tenant A cannot collide-block tenant B).
  it('M1: idempotency_key is unique per-tenant, not global', async () => {
    await withClient(pool, async (c) => {
      // Run as postgres (bypassrls) so the WITH CHECK tenant fence does not mask the
      // uniqueness semantics under test; the constraint is what we are proving.
      await c.query('begin');
      try {
        await c.query(`insert into usage_ledger (tenant_id, feature, idempotency_key) values ($1,'chat','dup-key')`, [TA]);
        // Same key, DIFFERENT tenant → must succeed (per-tenant scope).
        await c.query(`insert into usage_ledger (tenant_id, feature, idempotency_key) values ($1,'chat','dup-key')`, [TB]);
        // Same key, SAME tenant → must violate the unique constraint.
        await expect(
          c.query(`insert into usage_ledger (tenant_id, feature, idempotency_key) values ($1,'chat','dup-key')`, [TA]),
        ).rejects.toThrow();
      } finally {
        await c.query('rollback');
      }
    });
  });
});
