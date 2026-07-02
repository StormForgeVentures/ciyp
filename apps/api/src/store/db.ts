/**
 * Store DB access (PRD-008a). Two connection modes, both matching the wave-1 RLS model
 * (migration 20260702120000): the backend connects and sets `app.tenant_id` /
 * `app.member_id` / `app.context` TRANSACTION-LOCALLY (decision #19 — GUCs come from the
 * verified session only, never client input), and reads run as the non-bypassrls
 * `authenticated` role so RLS is actually exercised.
 *
 *  - withMemberSession: member-facing reads. `set local role authenticated` +
 *    transaction-local member GUCs; the member fence returns only the member's own rows.
 *  - withTenantContext: tenant-system work under an explicit coach context (can touch any
 *    member's rows within the one tenant, tenant-fenced).
 *  - withSystem / withSystemTx: pre-auth routing + trusted webhook projection. Runs as the
 *    connection's default role (postgres locally / service_role in prod → bypasses RLS);
 *    every query still scopes by an explicit tenant_id. Used for endpoint→tenant resolution
 *    and vault reads, which happen BEFORE a tenant fence can be set.
 *
 * DEPLOYMENT NOTE (for DevOps): the production DATABASE_URL role must be able to assume
 * `authenticated` (member reads) AND perform trusted writes (webhook projection). Locally
 * that is the postgres superuser; in prod split pools or a role that can `set role`.
 */
import pg from "pg";
import { databaseUrl } from "./env.js";
import type { MemberSession } from "./auth.js";

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) pool = new pg.Pool({ connectionString: databaseUrl(), max: 8 });
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/** Member-scoped, RLS-enforced. GUCs are transaction-local; the pooled connection is
 *  returned clean (local role + local settings revert on commit/rollback). */
export async function withMemberSession<T>(
  session: MemberSession,
  fn: (c: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    await client.query("set local role authenticated");
    await client.query(`select set_config('app.tenant_id', $1, true)`, [
      session.tenantId,
    ]);
    await client.query(`select set_config('app.member_id', $1, true)`, [
      session.memberId,
    ]);
    await client.query(`select set_config('app.context', 'member', true)`);
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (e) {
    await client.query("rollback").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

/** Tenant-system, coach context (all member rows within the one tenant). */
export async function withTenantContext<T>(
  tenantId: string,
  fn: (c: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    await client.query("set local role authenticated");
    await client.query(`select set_config('app.tenant_id', $1, true)`, [
      tenantId,
    ]);
    await client.query(`select set_config('app.context', 'coach', true)`);
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (e) {
    await client.query("rollback").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

/** Trusted system read (bypasses RLS). Scope by explicit tenant_id in the SQL. */
export async function withSystem<T>(
  fn: (c: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

/** Trusted system transaction (bypasses RLS). Used for atomic webhook dedupe+projection. */
export async function withSystemTx<T>(
  fn: (c: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (e) {
    await client.query("rollback").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}
