import { describe, it, expect } from 'vitest';
import {
  scopeFromClaims,
  ciypScopeResolver,
  sessionForClaims,
} from '../../src/lib/sport/scope-resolver.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const MEMBER = '22222222-2222-4222-8222-222222222222';
const OTHER_TENANT = '33333333-3333-4333-8333-333333333333';

describe('ciypScopeResolver — decision #19 enforcement', () => {
  it('resolves an admin principal to a coach, tenant-wide scope (no subject)', () => {
    const scope = scopeFromClaims({ tenant_id: TENANT, sub: 'admin-x', kind: 'admin' });
    expect(scope.tenantId).toBe(TENANT);
    expect(scope.context).toBe('coach');
    expect(scope.subjectId).toBeUndefined();
  });

  it('resolves a member principal to a member-scoped scope with its subject', () => {
    const scope = scopeFromClaims({ tenant_id: TENANT, sub: MEMBER, kind: 'member' });
    expect(scope.context).toBe('member');
    expect(scope.subjectId).toBe(MEMBER);
  });

  it('INVARIANT: a member principal can NEVER resolve to context=coach (H2 spoof)', () => {
    // Even if the claims try to smuggle a coach signal, `kind: member` decides context.
    const scope = scopeFromClaims({
      tenant_id: TENANT,
      sub: MEMBER,
      kind: 'member',
      context: 'coach', // hostile extra claim — must be ignored
      role: 'coach',
    });
    expect(scope.context).toBe('member');
  });

  it('ignores a body-supplied tenant — identity is claims-only (structural)', () => {
    // The resolver has no body parameter; a caller cannot pass a different tenant.
    // Proven structurally: resolveScope's only argument is the session.
    const session = sessionForClaims({ tenant_id: TENANT, sub: MEMBER, kind: 'member' });
    const scope = ciypScopeResolver.resolveScope(session) as { tenantId: string };
    expect(scope.tenantId).toBe(TENANT);
    // There is no code path by which OTHER_TENANT (a "body value") could win.
    expect(scope.tenantId).not.toBe(OTHER_TENANT);
  });

  it('rejects a missing/blank tenant claim (tenant floor)', () => {
    expect(() => scopeFromClaims({ sub: MEMBER, kind: 'member' })).toThrow(/tenant_id/);
    expect(() => scopeFromClaims({ tenant_id: '   ', sub: MEMBER, kind: 'member' })).toThrow(
      /tenant_id/,
    );
  });

  it('rejects a malformed (non-UUID) tenant/subject claim pre-turn', () => {
    expect(() => scopeFromClaims({ tenant_id: 'not-a-uuid', kind: 'admin' })).toThrow(/UUID/);
    expect(() =>
      scopeFromClaims({ tenant_id: TENANT, sub: 'not-a-uuid', kind: 'member' }),
    ).toThrow(/UUID/);
  });

  it('rejects an unknown principal kind', () => {
    expect(() => scopeFromClaims({ tenant_id: TENANT, sub: MEMBER, kind: 'robot' })).toThrow(
      /kind/,
    );
  });

  it('resolver runs assertNoCredentialsInScope — a clean scope passes', () => {
    // The resolver only ever produces {tenantId, subjectId?, context}; no credential key
    // can be present, so the assertion inside resolveScope never throws for real claims.
    expect(() =>
      ciypScopeResolver.resolveScope(sessionForClaims({ tenant_id: TENANT, sub: 'x', kind: 'admin' })),
    ).not.toThrow();
  });
});
