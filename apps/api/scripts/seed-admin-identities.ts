/**
 * Admin-identity seed (PRD-006a). The SQL seed (@ciyp/db) creates the Luminify tenant + one
 * `admins` row but NO Supabase Auth users, so nobody can actually sign in. This script mints the
 * real GoTrue users (via the auth admin API — the supported path; never hand-inserted auth.users
 * rows, which 500 on password login) and links them:
 *
 *   owner@luminify.example  → existing Luminify `admins` owner   (full tenant nav)
 *   team@luminify.example   → new Luminify `admins` role=team    (delegated, config-read-only)
 *   super@luminify.example  → platform_operators (superadmin)    (no home tenant; manages tenants)
 *
 * Idempotent: re-running finds existing auth users by email and re-links. Password comes from
 * SEED_ADMIN_PASSWORD (see .env.example) — never hard-coded here.
 */
import { env } from '../src/lib/env.js';
import { withSystemTx, closePool } from '../src/lib/pool.js';

interface Identity {
  email: string;
  displayName: string;
  kind: 'owner' | 'team' | 'superadmin';
}

const IDENTITIES: Identity[] = [
  { email: 'owner@luminify.example', displayName: 'Luminify Coach', kind: 'owner' },
  { email: 'team@luminify.example', displayName: 'Luminify Team', kind: 'team' },
  { email: 'super@luminify.example', displayName: 'Luminify Operator', kind: 'superadmin' },
];

function authHeaders(): Record<string, string> {
  const key = env.supabaseServiceRoleKey();
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

async function findUserId(email: string): Promise<string | null> {
  // GoTrue admin list (small dev dataset — first page is enough).
  const res = await fetch(`${env.supabaseUrl()}/auth/v1/admin/users?per_page=200`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`list users failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { users?: { id: string; email?: string }[] };
  const match = body.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  return match?.id ?? null;
}

async function ensureUser(email: string, password: string): Promise<string> {
  const res = await fetch(`${env.supabaseUrl()}/auth/v1/admin/users`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (res.ok) {
    const body = (await res.json()) as { id: string };
    return body.id;
  }
  // Already exists (or similar) → resolve by listing.
  const existing = await findUserId(email);
  if (existing) return existing;
  throw new Error(`could not create or find auth user ${email}: ${res.status} ${await res.text()}`);
}

/**
 * Idempotently mint + link the three admin identities. Exported so the admin integration
 * suite can make itself self-sufficient (call in beforeAll) — the same path CI/`pnpm seed:identities`
 * uses. Does NOT close the pool; the caller owns pool lifecycle.
 */
export async function seedAdminIdentities(): Promise<void> {
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!password || password.trim() === '') {
    throw new Error('SEED_ADMIN_PASSWORD is required (see .env.example).');
  }

  const linked: Record<Identity['kind'], string> = {} as Record<Identity['kind'], string>;
  for (const id of IDENTITIES) {
    linked[id.kind] = await ensureUser(id.email, password);
  }

  await withSystemTx(async (c) => {
    const t = await c.query<{ id: string }>(`select id from tenants where slug = 'luminify'`);
    const tenantId = t.rows[0]?.id;
    if (!tenantId) throw new Error('Luminify tenant not found — run `pnpm seed` first.');

    // owner — link the pre-seeded owner row.
    await c.query(`update admins set auth_user_id = $2 where tenant_id = $1 and email = $3`, [
      tenantId,
      linked.owner,
      'owner@luminify.example',
    ]);

    // team — delegated member (owner "adds member by email", Settings-lite v1).
    await c.query(
      `insert into admins (tenant_id, auth_user_id, email, display_name, role)
       values ($1,$2,$3,$4,'team')
       on conflict (tenant_id, email)
       do update set auth_user_id = excluded.auth_user_id, display_name = excluded.display_name`,
      [tenantId, linked.team, 'team@luminify.example', 'Luminify Team'],
    );

    // superadmin — platform operator, no tenant membership.
    await c.query(
      `insert into platform_operators (auth_user_id, email, display_name)
       values ($1,$2,$3)
       on conflict (email) do update set auth_user_id = excluded.auth_user_id`,
      [linked.superadmin, 'super@luminify.example', 'Luminify Operator'],
    );
  });

  // eslint-disable-next-line no-console
  console.log(
    `admin identities seeded:\n` +
      `  owner  owner@luminify.example  (${linked.owner})\n` +
      `  team   team@luminify.example   (${linked.team})\n` +
      `  super  super@luminify.example  (${linked.superadmin})`,
  );
}

// CLI entrypoint — only runs when invoked directly (not when imported by the test suite).
if (import.meta.url === `file://${process.argv[1]}`) {
  seedAdminIdentities()
    .catch((err) => {
      console.error('admin-identity seed failed:', err);
      process.exitCode = 1;
    })
    .finally(() => closePool());
}
