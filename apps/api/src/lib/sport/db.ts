/**
 * apps/api Postgres pool — the runtime's DB handle for the Sport ports.
 *
 * The runtime connects as the NON-bypassrls `authenticated` role (never
 * service_role for member-facing turns), so RLS + the GUC fence (decision #19)
 * actually apply. Tenancy is carried on the CONNECTION via `SET LOCAL` GUCs set
 * transaction-locally from the resolved scope only (`tenant-context.ts`).
 *
 * `DATABASE_URL_APP` overrides the connection string for the app role; falls back
 * to `DATABASE_URL` (local Supabase superuser) for dev where a dedicated app-role
 * URL isn't provisioned — the GUC fence is exercised regardless, but production
 * MUST point `DATABASE_URL_APP` at the `authenticated` role (see `withTenantTx`).
 */
import pg from 'pg';

const { Pool } = pg;

function connectionString(): string {
  const app = process.env.DATABASE_URL_APP;
  if (app && app.trim() !== '') return app;
  const base = process.env.DATABASE_URL;
  if (base && base.trim() !== '') return base;
  if (process.env.CI) {
    throw new Error(
      'Missing DATABASE_URL_APP / DATABASE_URL — the Sport runtime needs a DB handle.',
    );
  }
  return 'postgresql://postgres:postgres@127.0.0.1:55322/postgres';
}

let pool: pg.Pool | undefined;

/** The process-wide app pool (lazy). Bounded; the runtime is one Node process. */
export function appPool(): pg.Pool {
  if (!pool) pool = new Pool({ connectionString: connectionString(), max: 8 });
  return pool;
}

/** Test/teardown seam — close the pool so vitest can exit. */
export async function closeAppPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

/** Run a fn with a dedicated client, always released (skill-memory: acquire-try/release-finally). */
export async function withClient<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
  poolOverride?: pg.Pool,
): Promise<T> {
  const client = await (poolOverride ?? appPool()).connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}
