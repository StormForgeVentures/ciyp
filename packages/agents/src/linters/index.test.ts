import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  runLinterChain,
  CANONICAL_LINTER_ORDER,
  type LinterChainContext,
} from './index.js';
import type { AgentSubstrate } from '../llm/types.js';

/**
 * runLinterChain. Canonical order, purity (no store imports), retention-toggle,
 * block-plus-reprompt return shape. Registered names are generic placeholders.
 */

const NAMES = ['Sage', 'North Star', 'Beacon', 'Atlas', 'Orion'];

function baseCtx(overrides: Partial<LinterChainContext> = {}): LinterChainContext {
  return {
    detectedState: 'aligned',
    archetypeLean: [],
    winkCount: 0,
    registeredArchetypeNames: NAMES,
    ...overrides,
  };
}

function judgeSubstrate(score: number): AgentSubstrate {
  return {
    getModelSlot: vi.fn(async () => ({ model: 'test/fast-model' })),
    traceAICall: vi.fn(async (o) => o.call()),
    llm: vi.fn(async () => JSON.stringify({ score })),
  };
}

describe('runLinterChain — canonical order', () => {
  it('exposes the canonical order in one place', () => {
    expect(CANONICAL_LINTER_ORDER).toEqual(['voice', 'no_shame', 'playfulness', 'retention']);
  });

  it('clean text in an eligible state passes all stages', async () => {
    const r = await runLinterChain('What is true for you right now?', baseCtx());
    expect(r.pass).toBe(true);
    expect(r.blocks).toEqual([]);
  });

  it('voiceLinter runs first — em-dash normalization carried into finalText', async () => {
    const r = await runLinterChain('Breathe — slowly.', baseCtx());
    expect(r.finalText).not.toContain('—');
  });
});

describe('runLinterChain — block aggregation + re-prompt', () => {
  it('a hard archetype-name leak surfaces as a block with a re-prompt instruction', async () => {
    const r = await runLinterChain('like Sage would say', baseCtx());
    const leak = r.blocks.find((b) => b.kind === 'archetype_name_leak');
    expect(leak).toBeDefined();
    expect(leak?.hard).toBe(true);
    expect(leak?.repromptInstruction).toBeTruthy();
    expect(r.pass).toBe(false);
  });

  it('no-shame safe-template substitution is carried into finalText', async () => {
    const r = await runLinterChain('you failed at this', {
      ...baseCtx(),
      isReprompt: true,
      noShame: { regexOnly: true, safeTemplate: 'SAFE RESET' },
    });
    expect(r.finalText).toBe('SAFE RESET');
    expect(r.blocks.some((b) => b.kind === 'no_shame')).toBe(true);
  });

  it('playfulness block in a distress state surfaces with a re-prompt', async () => {
    const r = await runLinterChain('nice work 😉', baseCtx({ detectedState: 'overwhelmed' }));
    const p = r.blocks.find((b) => b.kind === 'playfulness');
    expect(p?.repromptInstruction).toContain('without the joke');
  });

  it('the chain never calls the LLM to rewrite (only judges)', async () => {
    const substrate = judgeSubstrate(0.0);
    await runLinterChain('borderline text', {
      ...baseCtx(),
      noShame: { substrate, judgePrompt: 'score it' },
    });
    // The only llm call allowed is the no-shame JUDGE (score), never a rewrite.
    expect(substrate.llm).toHaveBeenCalledTimes(1);
  });
});

describe('runLinterChain — retention toggle', () => {
  it('retention is SKIPPED by default (no substrate call)', async () => {
    const substrate = judgeSubstrate(0.0);
    const r = await runLinterChain('did a thing', {
      ...baseCtx(),
      retention: { substrate, judgePrompt: 'score' },
      // runRetentionLinter omitted → default off
    });
    expect(substrate.llm).not.toHaveBeenCalled();
    expect(r.blocks.some((b) => b.kind === 'retention')).toBe(false);
  });

  it('retention runs when explicitly enabled; low score → soft block', async () => {
    const substrate = judgeSubstrate(0.2);
    const r = await runLinterChain('did a thing', {
      ...baseCtx(),
      runRetentionLinter: true,
      retention: { substrate, judgePrompt: 'score', threshold: 0.5 },
    });
    expect(r.blocks.some((b) => b.kind === 'retention')).toBe(true);
  });

  it("retention's absence (unwired) does not break the chain even when enabled", async () => {
    const r = await runLinterChain('did a thing', {
      ...baseCtx(),
      runRetentionLinter: true,
      // no retention substrate/prompt → no-op pass
    });
    expect(r.pass).toBe(true);
  });
});

describe('runLinterChain — purity', () => {
  it('no linter module imports a store / SSE / Postgres client', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const forbidden = [
      'valkey',
      'supabase',
      '@supabase',
      'ioredis',
      'redis',
      'pg',
      'hono',
      'ws',
      'eventsource',
      'apps/api',
    ];
    const files = ['index.ts', 'voice.ts', 'no-shame.ts', 'playfulness.ts', 'retention.ts', 'types.ts'];
    for (const f of files) {
      const src = readFileSync(join(here, f), 'utf8');
      // Only inspect import statements.
      const imports = src.match(/^\s*import\s.+from\s+['"][^'"]+['"]/gm) ?? [];
      for (const imp of imports) {
        for (const bad of forbidden) {
          expect(imp.toLowerCase()).not.toContain(bad);
        }
      }
    }
  });
});
