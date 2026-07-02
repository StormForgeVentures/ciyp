/**
 * Test helpers for the admin surface. Mints session JWTs signed with the SAME HS256 secret
 * Supabase Auth uses locally — apps/api verifies signature + resolves the principal by `sub`,
 * so a minted token is indistinguishable from a GoTrue-issued one at the verification boundary
 * (the real GoTrue sign-in is covered by the Playwright E2E). Ids are looked up from the live
 * seed, never hard-coded.
 */
import { SignJWT } from 'jose';
import { env } from '../src/lib/env.js';
import { withSystemTx } from '../src/lib/pool.js';

const secret = () => new TextEncoder().encode(env.supabaseJwtSecret());

export async function mintToken(sub: string, email: string): Promise<string> {
  return new SignJWT({ email, role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(secret());
}

export interface SeedIds {
  ownerSub: string;
  teamSub: string;
  superSub: string;
  luminifyTenantId: string;
}

export async function loadSeedIds(): Promise<SeedIds> {
  return withSystemTx(async (c) => {
    const admins = await c.query<{ email: string; auth_user_id: string }>(
      `select email, auth_user_id from admins where email in ('owner@luminify.example','team@luminify.example')`,
    );
    const op = await c.query<{ auth_user_id: string }>(
      `select auth_user_id from platform_operators where email = 'super@luminify.example'`,
    );
    const tenant = await c.query<{ id: string }>(`select id from tenants where slug = 'luminify'`);
    const byEmail = (e: string) => admins.rows.find((r) => r.email === e)!.auth_user_id;
    return {
      ownerSub: byEmail('owner@luminify.example'),
      teamSub: byEmail('team@luminify.example'),
      superSub: op.rows[0]!.auth_user_id,
      luminifyTenantId: tenant.rows[0]!.id,
    };
  });
}

export const authHeader = (token: string): Record<string, string> => ({
  authorization: `Bearer ${token}`,
});
