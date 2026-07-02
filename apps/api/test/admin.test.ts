/**
 * Admin surface integration tests (PRD-006a) against the LIVE local DB + real Supabase Auth.
 * Tokens are real GoTrue password grants (ES256/JWKS) — the exact verification path production
 * uses. Written adversarially: every auth/role/tenant boundary is probed with the wrong principal.
 *
 * Fabricated fixtures are namespaced (test-006a-*) and created via on-conflict upserts so the
 * suite is idempotent across reruns WITHOUT deleting rows (audit rows are append-only + RESTRICT
 * the tenant, so test tenants are intentionally non-deletable).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/index.js';
import { getPool, withSystemTx, closePool } from '../src/lib/pool.js';
import { PLATFORM_DEFAULT_MODEL_ROUTING } from '../src/routes/defaults.js';
import { authHeader, ensureAuthUser, getToken, loadSeedIds, type SeedIds } from './helpers.js';
import { seedAdminIdentities } from '../scripts/seed-admin-identities.js';
import { env } from '../src/lib/env.js';

let ids: SeedIds;
let ownerTok: string;
let teamTok: string;
let superTok: string;
let susOwnerTok: string;
let susOwnerSub: string;

const SUS_TENANT = '00000000-0006-4a00-8000-0000000006a5';
const TEST_TENANT_SLUG = 'test-006a-created';

// These tests exercise the real Supabase Auth (GoTrue) path — sign-in tokens, JWKS verify,
// admin user creation. CI runs a bare Postgres service with no auth server, so probe GoTrue
// once and skip the whole suite when it's unreachable (local `supabase start` has it).
async function authServerReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${env.supabaseUrl()}/auth/v1/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
const AUTH_UP = await authServerReachable();
if (!AUTH_UP) {
  // eslint-disable-next-line no-console
  console.warn('admin.test.ts: Supabase Auth (GoTrue) not reachable — skipping admin-shell suite');
}

async function req(path: string, init: RequestInit = {}): Promise<Response> {
  return app.request(path, init);
}

beforeAll(async () => {
  if (!AUTH_UP) return;
  // Self-sufficient setup: the SQL seed doesn't create GoTrue auth users, so mint + link the
  // three admin identities here (idempotent) before resolving them — otherwise loadSeedIds()
  // throws when run in the integrated `pnpm test` flow (no separate seed:identities step).
  await seedAdminIdentities();
  ids = await loadSeedIds();
  ownerTok = await getToken('owner@luminify.example');
  teamTok = await getToken('team@luminify.example');
  superTok = await getToken('super@luminify.example');

  // AC-5 fixture: a paused tenant with its own (real GoTrue) owner.
  susOwnerSub = await ensureAuthUser('owner@suspended.example');
  await withSystemTx(async (c) => {
    await c.query(
      `insert into tenants (id, slug, display_name, status) values ($1,'test-006a-suspended','Suspended Co','paused')
       on conflict (id) do update set status = 'paused'`,
      [SUS_TENANT],
    );
    await c.query(
      `insert into app_config (tenant_id, model_routing) values ($1,$2::jsonb) on conflict (tenant_id) do nothing`,
      [SUS_TENANT, JSON.stringify(PLATFORM_DEFAULT_MODEL_ROUTING)],
    );
    await c.query(
      `insert into admins (tenant_id, auth_user_id, email, display_name, role)
       values ($1,$2,'owner@suspended.example','Suspended Owner','owner')
       on conflict (tenant_id, email) do update set auth_user_id = excluded.auth_user_id`,
      [SUS_TENANT, susOwnerSub],
    );
  });
  susOwnerTok = await getToken('owner@suspended.example');
}, 30_000);

// Tear down every fixture so the shared local DB is left as we found it (the seed-verify
// "exactly 1 tenant" invariant is global across the parallel wave-2 tracks). Audit rows are
// RESTRICT-linked to the tenant, so delete them first (system-role targeted delete is permitted),
// then the tenants (cascades admins + app_config).
afterAll(async () => {
  try {
    await withSystemTx(async (c) => {
      const created = await c.query<{ id: string }>(`select id from tenants where slug = $1`, [
        TEST_TENANT_SLUG,
      ]);
      const testTenantIds = [SUS_TENANT, ...created.rows.map((r) => r.id)];
      await c.query(`delete from admin_audit_log where tenant_id = any($1::uuid[])`, [testTenantIds]);
      await c.query(`delete from tenants where id = any($1::uuid[])`, [testTenantIds]);
    });
  } finally {
    await closePool();
  }
});

describe.skipIf(!AUTH_UP)('AC-6 — authentication fence', () => {
  it('rejects a request with no token (401)', async () => {
    expect((await req('/admin/me')).status).toBe(401);
  });
  it('rejects a malformed token (401)', async () => {
    expect((await req('/admin/me', { headers: authHeader('not.a.jwt') })).status).toBe(401);
  });
  it('rejects a well-formed but wrongly-signed token (401)', async () => {
    const forged =
      'eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ4Iiwicm9sZSI6ImF1dGhlbnRpY2F0ZWQifQ.' +
      'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    expect((await req('/admin/me', { headers: authHeader(forged) })).status).toBe(401);
  });
});

describe.skipIf(!AUTH_UP)('AC-2 — role gates (owner vs delegated team)', () => {
  it('owner sees config sections but NOT tenants', async () => {
    const res = await req('/admin/me', { headers: authHeader(ownerTok) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { isSuperadmin: boolean; authorizedSections: string[]; admin: { role: string } };
    expect(body.isSuperadmin).toBe(false);
    expect(body.admin.role).toBe('owner');
    expect(body.authorizedSections).toEqual(
      expect.arrayContaining(['dashboard', 'instance', 'agent_studio', 'library', 'wallet', 'settings']),
    );
    expect(body.authorizedSections).not.toContain('tenants');
  });

  it('delegated team member lacks instance/agent_studio/tenants in nav', async () => {
    const res = await req('/admin/me', { headers: authHeader(teamTok) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { authorizedSections: string[] };
    expect(body.authorizedSections).not.toContain('instance');
    expect(body.authorizedSections).not.toContain('agent_studio');
    expect(body.authorizedSections).not.toContain('tenants');
    expect(body.authorizedSections).toContain('dashboard');
  });

  it('team member is 403 on owner-only API (nav absence is backed by the API)', async () => {
    expect((await req('/admin/team', { headers: authHeader(teamTok) })).status).toBe(403);
    const post = await req('/admin/team', {
      method: 'POST',
      headers: { ...authHeader(teamTok), 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'x@y.z', displayName: 'X' }),
    });
    expect(post.status).toBe(403);
  });

  it('non-superadmin is 403 on tenant management', async () => {
    expect((await req('/admin/tenants', { headers: authHeader(ownerTok) })).status).toBe(403);
    expect((await req('/admin/tenants', { headers: authHeader(teamTok) })).status).toBe(403);
  });
});

describe.skipIf(!AUTH_UP)('AC-3 — superadmin tenant management', () => {
  it('superadmin lists tenants including the seed tenant', async () => {
    const res = await req('/admin/tenants', { headers: authHeader(superTok) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tenants: { slug: string; status: string }[] };
    expect(body.tenants.some((t) => t.slug === 'luminify')).toBe(true);
  });

  it('create tenant writes a tenants row (status active) + a platform-default app_config (Q-1)', async () => {
    const res = await req('/admin/tenants', {
      method: 'POST',
      headers: { ...authHeader(superTok), 'content-type': 'application/json' },
      body: JSON.stringify({ slug: TEST_TENANT_SLUG, displayName: 'Test 006a Created' }),
    });
    expect([201, 409]).toContain(res.status);

    const list = (await (await req('/admin/tenants', { headers: authHeader(superTok) })).json()) as {
      tenants: { id: string; slug: string; status: string }[];
    };
    const created = list.tenants.find((t) => t.slug === TEST_TENANT_SLUG);
    expect(created, 'created tenant should appear in the list').toBeDefined();
    expect(created!.status).toBe('active');

    const cfg = await withSystemTx((c) =>
      c.query(`select 1 from app_config where tenant_id = $1`, [created!.id]).then((r) => r.rowCount),
    );
    expect(cfg, 'created tenant must have a default app_config row').toBe(1);
  });

  it('rejects an invalid slug (400)', async () => {
    const res = await req('/admin/tenants', {
      method: 'POST',
      headers: { ...authHeader(superTok), 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'Bad Slug!!', displayName: 'x' }),
    });
    expect(res.status).toBe(400);
  });
});

describe.skipIf(!AUTH_UP)('AC-1 — cross-tenant isolation (a forged acting-tenant header is ignored for non-superadmins)', () => {
  it('owner passing X-Acting-Tenant for another tenant still resolves their OWN tenant', async () => {
    const res = await req('/admin/dashboard', {
      headers: { ...authHeader(ownerTok), 'x-acting-tenant': SUS_TENANT },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tenant: { id: string; slug: string } };
    expect(body.tenant.id).toBe(ids.luminifyTenantId);
    expect(body.tenant.slug).toBe('luminify');
  });

  it('owner cannot read another tenant\'s team via a forged header (scoped to own tenant)', async () => {
    const res = await req('/admin/team', {
      headers: { ...authHeader(ownerTok), 'x-acting-tenant': SUS_TENANT },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { team: { email: string }[] };
    expect(body.team.some((m) => m.email === 'owner@luminify.example')).toBe(true);
    expect(body.team.some((m) => m.email === 'owner@suspended.example')).toBe(false);
  });
});

describe.skipIf(!AUTH_UP)('AC-4 — superadmin-switched mutation is audit-logged', () => {
  it('a switched superadmin add-member writes an audit row (operator id + target tenant + action)', async () => {
    const post = await req('/admin/team', {
      method: 'POST',
      headers: { ...authHeader(superTok), 'x-acting-tenant': SUS_TENANT, 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'audited-member@test006a.example', displayName: 'Audited Member' }),
    });
    expect([201, 409]).toContain(post.status);

    const audit = await withSystemTx((c) =>
      c
        .query<{ actor_user_id: string; acting_as_superadmin: boolean }>(
          `select actor_user_id, acting_as_superadmin
             from admin_audit_log
            where tenant_id = $1 and action = 'team.add_member'
            order by created_at desc limit 1`,
          [SUS_TENANT],
        )
        .then((r) => r.rows[0]),
    );
    expect(audit, 'an add_member audit row must exist for the target tenant').toBeDefined();
    expect(audit!.actor_user_id).toBe(ids.superSub);
    expect(audit!.acting_as_superadmin).toBe(true);
  });
});

describe.skipIf(!AUTH_UP)('audit log immutability (app role)', () => {
  it('the app role cannot delete, edit, or truncate audit entries (append-only preserved)', async () => {
    const client = await getPool().connect();
    async function asAppExpectReject(sql: string): Promise<void> {
      await client.query('begin');
      await client.query('set local role authenticated');
      await client.query(`select set_config('app.tenant_id', $1, true)`, [SUS_TENANT]);
      await client.query(`select set_config('app.context', 'coach', true)`);
      await expect(client.query(sql)).rejects.toThrow();
      await client.query('rollback');
    }
    try {
      await asAppExpectReject(`delete from admin_audit_log`);
      await asAppExpectReject(`update admin_audit_log set action = 'x'`);
      await asAppExpectReject(`truncate admin_audit_log`);
    } finally {
      client.release();
    }
  });
});

describe.skipIf(!AUTH_UP)('AC-5 — suspended tenant', () => {
  it('a suspended tenant\'s owner authenticates but sees the suspended status', async () => {
    const res = await req('/admin/me', { headers: authHeader(susOwnerTok) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { admin: { tenantStatus: string } };
    expect(body.admin.tenantStatus).toBe('paused');
  });

  it('write APIs return 403 for the suspended tenant\'s owner', async () => {
    const res = await req('/admin/team', {
      method: 'POST',
      headers: { ...authHeader(susOwnerTok), 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'blocked@x.z', displayName: 'Blocked' }),
    });
    expect(res.status).toBe(403);
  });

  it('a superadmin can still view/act on the suspended tenant', async () => {
    const res = await req('/admin/team', {
      headers: { ...authHeader(superTok), 'x-acting-tenant': SUS_TENANT },
    });
    expect(res.status).toBe(200);
  });
});
