/**
 * apps/api Postgres access — the tenant-scope boundary (project-state decision #19 / wave-1 H2).
 *
 * The process connects as `postgres` (bypassrls). Two transaction helpers, and ONLY these two,
 * touch the DB:
 *
 *   withTenantTx(scope, fn)  — drops to the non-bypassrls `authenticated` role and sets the
 *     three RLS GUCs transaction-LOCALLY. `app.context` is HARD-CODED to 'coach' and
 *     `app.member_id` to empty here: this is the coach/admin surface, so there is no code path
 *     that can emit a member context. The ONLY caller-supplied value is `scope.tenantId`, which
 *     the middleware derives from the verified session (never from request body/query/header).
 *     Because GUCs are set LOCAL and the role is reset at COMMIT/ROLLBACK, nothing leaks across
 *     pooled connections.
 *
 *   withSystemTx(fn)  — stays `postgres` (bypassrls). Used ONLY for (a) identity resolution
 *     before any tenant scope exists, and (b) superadmin cross-tenant operations, both of which
 *     are gated in the route layer. These queries scope themselves explicitly in SQL.
 */
import pg from 'pg';
import { env } from './env.js';

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) pool = new Pool({ connectionString: env.databaseUrl(), max: 8 });
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export interface TenantScope {
  /** Derived server-side from the verified session — never client-supplied. */
  tenantId: string;
}

/**
 * Run fn inside a transaction as the app role, scoped to exactly one tenant in coach context.
 * Commits on success, rolls back on throw. The GUC + role reset is guaranteed by SET LOCAL.
 */
export async function withTenantTx<T>(
  scope: TenantScope,
  fn: (c: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('begin');
    await client.query('set local role authenticated');
    // Transaction-local GUCs from the verified scope. context is fixed to 'coach' (admins
    // see tenant-wide coach data); member_id is never set on this surface.
    await client.query(`select set_config('app.tenant_id', $1, true)`, [scope.tenantId]);
    await client.query(`select set_config('app.context', 'coach', true)`);
    await client.query(`select set_config('app.member_id', '', true)`);
    const out = await fn(client);
    await client.query('commit');
    return out;
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

/** Run fn as the bypassrls system role. Route-gated (identity resolution + superadmin only). */
export async function withSystemTx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('begin');
    const out = await fn(client);
    await client.query('commit');
    return out;
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}
