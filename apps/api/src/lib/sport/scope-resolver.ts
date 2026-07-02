/**
 * CIYP Sport `ScopeResolver` — the decision-#19 enforcement point.
 *
 * RLS tenancy in CIYP is GUC-ASSERTED, not JWT-bound (project-state #19): the DB has
 * NO defense against a backend that sets the wrong `app.tenant_id` / `app.member_id` /
 * `app.context`. This resolver is the ONLY place those values originate, and it derives
 * them from the VERIFIED session claims exclusively — never from a request body.
 *
 * Invariants this module guarantees (each covered by a test):
 *   1. Identity comes only from `session.claims` — there is no body parameter.
 *   2. A member principal can NEVER resolve to `context='coach'` (the H2 spoof).
 *   3. `tenantId` / `subjectId` are validated UUIDs (a malformed claim rejects
 *      pre-turn rather than setting a garbage GUC).
 *   4. `assertNoCredentialsInScope` runs on every resolve (no token leaks to traces).
 *
 * The GUCs are then set transaction-locally from THIS scope by `tenant-context.ts`.
 */
import {
  resolveAndValidateScope,
  type ScopeResolver,
  type ResolvedScope,
  type SessionHandle,
} from '@theamazingwolf/sport-core';
// `assertNoCredentialsInScope` is NOT on the sport-core barrel — it ships only on the
// `/governance` subpath (verified against the installed 0.5.3 dist, not the plan).
import { assertNoCredentialsInScope } from '@theamazingwolf/sport-core/governance';

/** The session context descriptor carried onto the scope (NOT a credential). */
export type SessionContext = 'coach' | 'member';

/**
 * A CIYP resolved scope. `context` is an opaque scope key (the SDK never interprets
 * it); `tenant-context.ts` maps it to `app.context`. It is an identity descriptor —
 * `assertNoCredentialsInScope` passes it (the key name is not credential-shaped).
 */
export interface CiypScope extends ResolvedScope {
  readonly tenantId: string;
  readonly subjectId?: string;
  readonly context: SessionContext;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_RE.test(value.trim())) {
    throw new Error(
      `ciypScopeResolver: claim '${field}' is not a valid UUID — refusing to resolve a scope ` +
        `(a malformed identity claim must reject pre-turn, never set a garbage GUC).`,
    );
  }
  return value.trim();
}

/**
 * Derive the CIYP scope from the verified claims. `kind` decides the context and is the
 * ONLY thing that can grant coach visibility — a `member` kind structurally cannot yield
 * `context='coach'` (invariant 2). `tenant_id` and `sub` are verified-JWT claims, never
 * body values.
 */
export function scopeFromClaims(claims: Readonly<Record<string, unknown>>): CiypScope {
  const tenantId = requireUuid(claims.tenant_id, 'tenant_id');
  const kind = claims.kind;

  if (kind === 'admin') {
    // Coach/admin turn — tenant-wide (no data-subject). Coach context is the ONLY path
    // to tenant-wide member visibility (member fence in the DB is fail-closed).
    return { tenantId, context: 'coach' };
  }

  if (kind === 'member') {
    const subjectId = requireUuid(claims.sub, 'sub');
    return { tenantId, subjectId, context: 'member' };
  }

  throw new Error(
    `ciypScopeResolver: claim 'kind' must be 'admin' or 'member' (got ${JSON.stringify(kind)}) — ` +
      `an unknown principal cannot be scoped.`,
  );
}

/**
 * The CIYP `ScopeResolver`. Reads ONLY `session.claims`. Runs
 * `assertNoCredentialsInScope` (defense-in-depth) before returning.
 */
export const ciypScopeResolver: ScopeResolver = {
  resolveScope(session: SessionHandle): CiypScope {
    const scope = scopeFromClaims(session.claims);
    assertNoCredentialsInScope(scope);
    return scope;
  },
};

/**
 * Resolve + validate at the turn boundary (SDK `resolveAndValidateScope` enforces the
 * tenant floor pre-provider). Narrows to `CiypScope` (the resolver always produces one).
 */
export async function resolveCiypScope(session: SessionHandle): Promise<CiypScope> {
  const scope = await resolveAndValidateScope(ciypScopeResolver, session);
  return scope as CiypScope;
}

/** Build a `SessionHandle` from verified claims (the route has these from the JWT). */
export function sessionForClaims(claims: Record<string, unknown>): SessionHandle {
  return { claims };
}
