/**
 * Test helpers for the admin surface. Uses REAL GoTrue tokens (password grant against the local
 * Supabase Auth) so the verification path exercised is exactly production's (ES256 + JWKS) — no
 * minted-token shortcut that could diverge from the shipped token contract. Ids come from the
 * live seed; the suspended fixture's owner is a real created auth user.
 */
import { env } from '../src/lib/env.js';
import { withSystemTx } from '../src/lib/pool.js';

const PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? '';

function adminHeaders(): Record<string, string> {
  const key = env.supabaseServiceRoleKey();
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

/** Real password-grant token from local GoTrue. */
export async function getToken(email: string, password = PASSWORD): Promise<string> {
  const res = await fetch(`${env.supabaseUrl()}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: env.supabaseAnonKey(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`token grant failed for ${email}: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { access_token: string };
  return body.access_token;
}

/** Create (or find) a GoTrue user, returning its id. Idempotent. */
export async function ensureAuthUser(email: string, password = PASSWORD): Promise<string> {
  const res = await fetch(`${env.supabaseUrl()}/auth/v1/admin/users`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (res.ok) return ((await res.json()) as { id: string }).id;
  const list = await fetch(`${env.supabaseUrl()}/auth/v1/admin/users?per_page=200`, {
    headers: adminHeaders(),
  });
  const body = (await list.json()) as { users?: { id: string; email?: string }[] };
  const found = body.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!found) throw new Error(`could not create/find auth user ${email}`);
  return found.id;
}

export interface SeedIds {
  luminifyTenantId: string;
  superSub: string;
}

export async function loadSeedIds(): Promise<SeedIds> {
  return withSystemTx(async (c) => {
    const op = await c.query<{ auth_user_id: string }>(
      `select auth_user_id from platform_operators where email = 'super@luminify.example'`,
    );
    const tenant = await c.query<{ id: string }>(`select id from tenants where slug = 'luminify'`);
    return { superSub: op.rows[0]!.auth_user_id, luminifyTenantId: tenant.rows[0]!.id };
  });
}

export const authHeader = (token: string): Record<string, string> => ({
  authorization: `Bearer ${token}`,
});
