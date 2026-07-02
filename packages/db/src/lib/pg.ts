import pg from 'pg';
import { databaseUrl } from './env.js';

const { Pool } = pg;

// pg parses NUMERIC (oid 1700) and BIGINT (oid 20) as strings by default to avoid
// precision loss. For the seed's small integer-range ledger sums we want numbers so
// the balance-sum assertions compare cleanly. BIGINT stays a string on read; we
// coerce explicitly where summed (verify uses ::bigint casts + Number()).

export function makePool(): pg.Pool {
  return new Pool({ connectionString: databaseUrl(), max: 4 });
}

/** Run a fn with a dedicated client, always released. */
export async function withClient<T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}
