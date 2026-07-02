/**
 * §3.2 rule-2 guard: a planted hardcoded model id (or prohibited pattern) is detected,
 * and the real lib/sport tree is clean.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
// @ts-expect-error — local .mjs guard script, no type declarations.
import { scanSource } from '../../scripts/sport-guards.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const GUARD = resolve(here, '../../scripts/sport-guards.mjs');

describe('sport-guards (rule 2)', () => {
  it('detects a planted hardcoded model literal', () => {
    const findings = scanSource(
      `const bad = { model: "anthropic/claude-sonnet-4.6", provider: "openrouter" };`,
      'planted.ts',
    );
    expect(findings.some((f: { kind: string }) => f.kind === 'hardcoded-model')).toBe(true);
  });

  it('detects the staticSlotConfig prohibited pattern', () => {
    const findings = scanSource(`const r = staticSlotConfig(cfg);`, 'planted.ts');
    expect(findings.some((f: { detail: string }) => f.detail.includes('staticSlotConfig'))).toBe(true);
  });

  it('detects a module-level singleton host', () => {
    const findings = scanSource(`let host: SportHost;`, 'planted.ts');
    expect(findings.some((f: { detail: string }) => f.detail.includes('singleton'))).toBe(true);
  });

  it('passes clean source (config-shaped model strings are not in code)', () => {
    const findings = scanSource(`const slot = await resolver.getModelSlot(scope, 'default');`, 'ok.ts');
    expect(findings).toHaveLength(0);
  });

  it('the real lib/sport tree passes the guard (exit 0)', () => {
    // A plant → temp file scanned via --self-test proves the CLI wiring; the full run over
    // lib/sport must be clean.
    const tmp = resolve(here, '_planted.ts.tmp');
    writeFileSync(tmp, `export const M = "openai/gpt-4o";`);
    try {
      const out = execFileSync('node', [GUARD, '--self-test', tmp], { encoding: 'utf8' });
      expect(JSON.parse(out).length).toBeGreaterThan(0); // detector fires on the plant
    } finally {
      rmSync(tmp, { force: true });
    }
    // Full run over the real tree — throws if non-zero.
    expect(() => execFileSync('node', [GUARD], { encoding: 'utf8' })).not.toThrow();
  });
});
