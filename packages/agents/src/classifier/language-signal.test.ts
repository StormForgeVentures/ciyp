import { describe, expect, it, vi } from 'vitest';
import { scanLanguageSignals } from './language-signal.js';
import type { AgentSubstrate } from '../llm/types.js';

/**
 * scanLanguageSignals — 9-state extraction shape, empty-on-failure, trace-wrap, no
 * persistence (the scan only returns structured results).
 */

const SCAN_PROMPT = 'Extract 9-state signals. Return a JSON array.';

function makeSubstrate(opts: {
  llmReturns: string | (() => Promise<string>);
  slot?: { model: string } | null;
}): { substrate: AgentSubstrate; traceEvents: Array<{ eventType: string; modelSlot: unknown }> } {
  const traceEvents: Array<{ eventType: string; modelSlot: unknown }> = [];
  const substrate: AgentSubstrate = {
    getModelSlot: vi.fn(async () =>
      opts.slot === undefined ? { model: 'test/fast-model' } : opts.slot,
    ),
    traceAICall: vi.fn(async (o) => {
      traceEvents.push({ eventType: o.eventType, modelSlot: o.modelSlot });
      return o.call();
    }),
    llm: vi.fn(async () =>
      typeof opts.llmReturns === 'function' ? opts.llmReturns() : opts.llmReturns,
    ),
  };
  return { substrate, traceEvents };
}

describe('scanLanguageSignals', () => {
  it('resolves fast slot, traced as language_signal_extracted, returns validated 9-state signals', async () => {
    const arr = JSON.stringify([
      { signal_kind: 'overwhelmed', confidence: 0.8, excerpt: 'so much to do' },
      { signal_kind: 'avoidant', confidence: 0.6, excerpt: 'I keep putting it off' },
    ]);
    const { substrate, traceEvents } = makeSubstrate({ llmReturns: arr });
    const out = await scanLanguageSignals('I have so much to do and I keep putting it off.', {
      scanPrompt: SCAN_PROMPT,
      substrate,
      memberId: 'm1',
    });
    expect(out).toHaveLength(2);
    expect(out[0]?.signal_kind).toBe('overwhelmed');
    expect(out[0]?.confidence).toBe(0.8);
    expect(traceEvents).toContainEqual({
      eventType: 'language_signal_extracted',
      modelSlot: 'fast',
    });
  });

  it('returns [] for an empty signal array', async () => {
    const { substrate } = makeSubstrate({ llmReturns: '[]' });
    const out = await scanLanguageSignals('the weather is fine', {
      scanPrompt: SCAN_PROMPT,
      substrate,
    });
    expect(out).toEqual([]);
  });

  it('unparseable output → empty array (never throws)', async () => {
    const { substrate } = makeSubstrate({ llmReturns: 'not json' });
    await expect(
      scanLanguageSignals('x', { scanPrompt: SCAN_PROMPT, substrate }),
    ).resolves.toEqual([]);
  });

  it('invalid signal_kind (Zod fail) → empty array', async () => {
    const bad = JSON.stringify([{ signal_kind: 'panicking', confidence: 0.9, excerpt: 'x' }]);
    const { substrate } = makeSubstrate({ llmReturns: bad });
    const out = await scanLanguageSignals('x', { scanPrompt: SCAN_PROMPT, substrate });
    expect(out).toEqual([]);
  });

  it('confidence out of range (Zod fail) → empty array', async () => {
    const bad = JSON.stringify([{ signal_kind: 'aligned', confidence: 1.5, excerpt: 'x' }]);
    const { substrate } = makeSubstrate({ llmReturns: bad });
    const out = await scanLanguageSignals('x', { scanPrompt: SCAN_PROMPT, substrate });
    expect(out).toEqual([]);
  });

  it('LLM transport error → empty array (never throws into the turn)', async () => {
    const { substrate } = makeSubstrate({
      llmReturns: () => Promise.reject(new Error('down')),
    });
    const realSubstrate: AgentSubstrate = {
      ...substrate,
      traceAICall: vi.fn(async (o) => {
        await o.call(); // throws
        throw new Error('unreachable');
      }),
    };
    await expect(
      scanLanguageSignals('x', { scanPrompt: SCAN_PROMPT, substrate: realSubstrate }),
    ).resolves.toEqual([]);
  });

  it('unconfigured fast slot → empty array, still traced', async () => {
    const { substrate, traceEvents } = makeSubstrate({ llmReturns: '[]', slot: null });
    const out = await scanLanguageSignals('x', { scanPrompt: SCAN_PROMPT, substrate });
    expect(out).toEqual([]);
    expect(traceEvents).toContainEqual({
      eventType: 'language_signal_extracted',
      modelSlot: 'fast',
    });
  });
});
