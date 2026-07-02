/**
 * Tenant-context binder — sets the RLS GUCs transaction-locally from the resolved
 * scope ONLY (decision #19). The DB's `current_tenant_id()` / `current_member_id()` /
 * `current_context()` readers (migration 20260702120000) read these.
 *
 * Uses `set_config(name, value, is_local => true)` — the parameterized form of
 * `SET LOCAL`. The value is bound as a parameter (never string-interpolated), so a
 * hostile value can't inject SQL; and `is_local => true` scopes it to the current
 * transaction, so it cannot leak to the next checkout of a pooled connection.
 *
 * The scope's values already came from the verified session (`scope-resolver.ts`).
 * This module NEVER accepts a raw tenant/member id from anywhere else — the ONLY input
 * is a `CiypScope`.
 */
import type { PoolClient } from 'pg';
import { withClient } from './db.js';
import type { CiypScope } from './scope-resolver.js';

/**
 * The non-bypassrls role the runtime reaches tenant data as (decision #19). When the
 * pool connects as a superuser (local dev / test — `postgres` bypasses RLS), we drop to
 * this role transaction-locally so the GUC fence actually applies. In production the
 * connection role IS the app role; set `SPORT_DB_ROLE=''` to skip the `SET LOCAL ROLE`.
 * The value is a fixed allow-listed identifier (never user input) — no injection surface.
 */
const APP_ROLE = (() => {
  const configured = process.env.SPORT_DB_ROLE;
  const role = configured === undefined ? 'authenticated' : configured.trim();
  if (role !== '' && !/^[a-z_][a-z0-9_]*$/i.test(role)) {
    throw new Error(`SPORT_DB_ROLE must be a bare SQL identifier; got ${JSON.stringify(role)}`);
  }
  return role;
})();

/** Drop to the app role for the current transaction (no-op when SPORT_DB_ROLE=''). */
export async function enterAppRole(client: PoolClient): Promise<void> {
  if (APP_ROLE !== '') await client.query(`set local role ${APP_ROLE}`);
}

/**
 * Set `app.tenant_id` / `app.member_id` / `app.context` on `client` for the current
 * transaction, from the resolved scope. `member_id` is set to '' (→ reads as unset,
 * fail-closed) for a coach/tenant-wide turn. Must be called INSIDE a `begin`.
 */
export async function applyScopeGucs(client: PoolClient, scope: CiypScope): Promise<void> {
  await client.query('select set_config($1, $2, true)', ['app.tenant_id', scope.tenantId]);
  await client.query('select set_config($1, $2, true)', [
    'app.member_id',
    scope.subjectId ?? '',
  ]);
  await client.query('select set_config($1, $2, true)', ['app.context', scope.context]);
}

/**
 * Run `fn` inside a transaction with the scope's GUCs applied (SET LOCAL semantics).
 * Every member-facing DB access in a turn goes through this — the GUC fence is the
 * enforcement, so there is no path that touches tenant data without the scope set.
 * Rolls back on error; commits on success.
 */
export async function withTenantTx<T>(
  scope: CiypScope,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return withClient(async (client) => {
    await client.query('begin');
    try {
      await enterAppRole(client);
      await applyScopeGucs(client, scope);
      const result = await fn(client);
      await client.query('commit');
      return result;
    } catch (err) {
      await client.query('rollback');
      throw err;
    }
  });
}

/**
 * Read-only variant — same GUC fence, wrapped in a read-only transaction (retrieval,
 * slot reads). Rolls back at the end (nothing to commit).
 */
export async function withTenantReadTx<T>(
  scope: CiypScope,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return withClient(async (client) => {
    await client.query('begin read only');
    try {
      await enterAppRole(client);
      await applyScopeGucs(client, scope);
      return await fn(client);
    } finally {
      await client.query('rollback');
    }
  });
}
