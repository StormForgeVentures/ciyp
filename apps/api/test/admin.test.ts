/**
 * Admin surface integration tests (PRD-006a) against the LIVE local DB + real seeded identities.
 * Written adversarially: every auth/role/tenant boundary is probed with the wrong principal.
 *
 * Ids come from the seed; fabricated fixtures are namespaced (test-006a-*) and created via
 * on-conflict upserts so the suite is idempotent across reruns WITHOUT deleting rows (audit rows
 * are append-only + RESTRICT the tenant, so test tenants are intentionally non-deletable).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/index.js';
import { withSystemTx, closePool } from '../src/lib/pool.js';
import { PLATFORM_DEFAULT_MODEL_ROUTING } from '../src/routes/defaults.js';
import { authHeader, loadSeedIds, mintToken, type SeedIds } from './helpers.js';

let ids: SeedIds;
let ownerTok: string;
let teamTok: string;
let superTok: string;

// Fabricated suspended-tenant fixture (AC-5). Fixed ids → idempotent upsert.
const SUS_TENANT = '00000000-0006-4a00-8000-0000000006a5';
const SUS_OWNER_SUB = '00000000-0006-4a00-8000-0000000006a6';
const TEST_TENANT_SLUG = 'test-006a-created';

async function req(path: string, init: RequestInit = {}): Promise<Response> {
  return app.request(path, init);
}

beforeAll(async () => {
  ids = await loadSeedIds();
  ownerTok = await mintToken(ids.ownerSub, 'owner@luminify.example');
  teamTok = await mintToken(ids.teamSub, 'team@luminify.example');
  superTok = await mintToken(ids.superSub, 'super@luminify.example');

  // AC-5 fixture: a paused tenant with its own owner admin.
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
      [SUS_TENANT, SUS_OWNER_SUB],
    );
  });
}, 30_000);

afterAll(async () => {
  await closePool();
});

describe('AC-6 — authentication fence', () => {
  it('rejects a request with no token (401)', async () => {
    expect((await req('/admin/me')).status).toBe(401);
  });
  it('rejects a forged/garbage token (401)', async () => {
    const res = await req('/admin/me', { headers: authHeader('not.a.jwt') });
    expect(res.status).toBe(401);
  });
  it('rejects a token signed with the wrong secret (401)', async () => {
    // Valid shape, wrong signature.
    const bad =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4Iiwicm9sZSI6ImF1dGhlbnRpY2F0ZWQifQ.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    expect((await req('/admin/me', { headers: authHeader(bad) })).status).toBe(401);
  });
});

describe('AC-2 — role gates (owner vs delegated team)', () => {
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

describe('AC-3 — superadmin tenant management', () => {
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
    // 201 first run, 409 on rerun — both prove the create path; assert the end state either way.
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

describe('AC-1 — cross-tenant isolation (a forged acting-tenant header is ignored for non-superadmins)', () => {
  it('owner passing X-Acting-Tenant for another tenant still resolves their OWN tenant', async () => {
    const res = await req('/admin/dashboard', {
      headers: { ...authHeader(ownerTok), 'x-acting-tenant': SUS_TENANT },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tenant: { id: string; slug: string } };
    expect(body.tenant.id).toBe(ids.luminifyTenantId);
    expect(body.tenant.slug).toBe('luminify');
  });

  it('owner cannot manage another tenant\'s team via a forged header (scoped to own tenant)', async () => {
    // The forged header is ignored → team list is Luminify's, never the suspended tenant's.
    const res = await req('/admin/team', {
      headers: { ...authHeader(ownerTok), 'x-acting-tenant': SUS_TENANT },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { team: { email: string }[] };
    expect(body.team.some((m) => m.email === 'owner@luminify.example')).toBe(true);
    expect(body.team.some((m) => m.email === 'owner@suspended.example')).toBe(false);
  });
});

describe('AC-4 — superadmin-switched mutation is audit-logged', () => {
  it('a switched superadmin add-member writes an audit row (operator id + target tenant + action)', async () => {
    const memberEmail = 'audited-member@test006a.example';
    const post = await req('/admin/team', {
      method: 'POST',
      headers: { ...authHeader(superTok), 'x-acting-tenant': SUS_TENANT, 'content-type': 'application/json' },
      body: JSON.stringify({ email: memberEmail, displayName: 'Audited Member' }),
    });
    expect([201, 409]).toContain(post.status);

    const audit = await withSystemTx((c) =>
      c
        .query<{ actor_user_id: string; acting_as_superadmin: boolean; action: string }>(
          `select actor_user_id, acting_as_superadmin, action
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

describe('AC-5 — suspended tenant', () => {
  it('a suspended tenant\'s owner authenticates but sees the suspended status', async () => {
    const susOwnerTok = await mintToken(SUS_OWNER_SUB, 'owner@suspended.example');
    const res = await req('/admin/me', { headers: authHeader(susOwnerTok) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { admin: { tenantStatus: string } };
    expect(body.admin.tenantStatus).toBe('paused');
  });

  it('write APIs return 403 for the suspended tenant\'s owner', async () => {
    const susOwnerTok = await mintToken(SUS_OWNER_SUB, 'owner@suspended.example');
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
