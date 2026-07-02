import { describe, it, expect } from 'vitest';
import { Linter } from 'eslint';
import tsParser from '@typescript-eslint/parser';
// @ts-expect-error — local flat-config plugin (.mjs, no types); shape is validated at runtime.
import plugin from '../../src/eslint-rules/no-jwt-in-resolved-scope.mjs';

/**
 * PRD-002b AC-5: a source file assigning a JWT-bearing value into ResolvedScope
 * construction fails the build with the custom rule id. Proven here with the ESLint
 * `Linter` over planted source strings — the same rule the build wires over lib/sport.
 */
function lint(code: string) {
  const linter = new Linter({ configType: 'flat' });
  return linter.verify(
    code,
    {
      files: ['**/*.ts'],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      languageOptions: { parser: tsParser as any },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      plugins: { 'ciyp-sport': plugin as any },
      rules: { 'ciyp-sport/no-jwt-in-resolved-scope': 'error' },
    },
    'file.ts',
  );
}

const RULE = 'ciyp-sport/no-jwt-in-resolved-scope';

describe('no-jwt-in-resolved-scope', () => {
  it('FAILS a scope annotated CiypScope carrying a jwt', () => {
    const msgs = lint(
      `const scope: CiypScope = { tenantId: t, jwt: session.jwt, context: 'member' };`,
    );
    expect(msgs.some((m) => m.ruleId === RULE)).toBe(true);
  });

  it('FAILS a resolveScope method returning a token-bearing object', () => {
    const msgs = lint(`
      const resolver = {
        resolveScope(session) {
          return { tenantId: session.claims.tenant_id, authToken: session.token };
        },
      };
    `);
    expect(msgs.some((m) => m.ruleId === RULE)).toBe(true);
  });

  it('FAILS a variable named *Scope with an apiKey and an `as ResolvedScope` cast', () => {
    expect(lint(`const s = { tenantId: t, apiKey: k } as ResolvedScope;`).some((m) => m.ruleId === RULE)).toBe(true);
    expect(lint(`const memberScope = { tenantId: t, api_key: k };`).some((m) => m.ruleId === RULE)).toBe(true);
  });

  it('FAILS a scope smuggling raw claims', () => {
    expect(
      lint(`const scope: CiypScope = { tenantId: t, claims: session.claims };`).some(
        (m) => m.ruleId === RULE,
      ),
    ).toBe(true);
  });

  it('PASSES a clean scope (tenantId + subjectId + context only)', () => {
    const msgs = lint(
      `const scope: CiypScope = { tenantId: t, subjectId: m, context: 'member' };`,
    );
    expect(msgs.filter((m) => m.ruleId === RULE)).toHaveLength(0);
  });

  it('does NOT flag a token key on a non-scope object', () => {
    const msgs = lint(`const httpHeaders = { authorization: bearer, jwt: raw };`);
    expect(msgs.filter((m) => m.ruleId === RULE)).toHaveLength(0);
  });
});
