import { describe, expect, it, vi } from 'vitest';
import { classify, type ClassifyOpts } from './index.js';
import type { AgentSubstrate } from '../llm/types.js';

/** A stand-in system prompt; the real one comes from `@ciyp/prompts` at runtime. */
const TEST_SYSTEM_PROMPT = 'Classify the turn. Emit JSON only.';

/**
 * classify(). LLM, getModelSlot, and traceAICall are all INJECTED, so no live
 * network and no DB. Asserts: output-shape validation; opaque-target passthrough;
 * fallback on unparseable / Zod-fail; trace-wrap; `fast`-slot (NOT `chat`);
 * always-resolves with no ordering side effects.
 */

/** A substrate stub: records the slot requested and the trace eventType/modelSlot. */
function makeSubstrate(opts: {
  llmReturns: string | (() => Promise<string>);
  slot?: { model: string } | null;
}): {
  substrate: AgentSubstrate;
  calls: { slotRequested: string[]; traceEvents: Array<{ eventType: string; modelSlot: unknown }> };
  lastTraceData: () => Record<string, unknown> | undefined;
} {
  const slotRequested: string[] = [];
  const traceEvents: Array<{ eventType: string; modelSlot: unknown }> = [];
  let lastData: Record<string, unknown> | undefined;

  const substrate: AgentSubstrate = {
    getModelSlot: vi.fn(async (slot) => {
      slotRequested.push(slot);
      return opts.slot === undefined ? { model: 'test/fast-model' } : opts.slot;
    }),
    traceAICall: vi.fn(async (o) => {
      traceEvents.push({ eventType: o.eventType, modelSlot: o.modelSlot });
      const result = await o.call();
      lastData = o.data;
      return result;
    }),
    llm: vi.fn(async () =>
      typeof opts.llmReturns === 'function' ? opts.llmReturns() : opts.llmReturns,
    ),
  };

  return {
    substrate,
    calls: { slotRequested, traceEvents },
    lastTraceData: () => lastData,
  };
}

function baseOpts(substrate: AgentSubstrate): ClassifyOpts {
  return {
    userMessage: 'I feel completely overwhelmed and behind on everything.',
    recentTurns: [{ role: 'member', content: 'hi' }],
    memberContext: { archetype: 'placeholder_archetype', recentState: 'aligned' },
    memberId: 'm1',
    threadId: 't1',
    systemPrompt: TEST_SYSTEM_PROMPT,
    substrate,
  };
}

describe('classify', () => {
  it('resolves fast slot, wraps in traceAICall classify, validates output', async () => {
    const valid = JSON.stringify({
      action: 'respond_and_offer_utility',
      target: 'breathing_util', // opaque tenant key
      archetype_lean: ['calm_voice'],
      detected_state: 'overwhelmed',
      reasoning: 'member reports overwhelm; offer breathing',
    });
    const { substrate, calls } = makeSubstrate({ llmReturns: valid });
    const out = await classify(baseOpts(substrate));

    expect(out.action).toBe('respond_and_offer_utility');
    expect(out.target).toBe('breathing_util');
    expect(out.detected_state).toBe('overwhelmed');
    expect(out.archetype_lean).toEqual(['calm_voice']);
    // fast slot, NOT chat.
    expect(calls.slotRequested).toContain('fast');
    expect(calls.slotRequested).not.toContain('chat');
    // traced as classify with fast modelSlot.
    expect(calls.traceEvents).toContainEqual({ eventType: 'classify', modelSlot: 'fast' });
  });

  it('defaults archetype_lean to [] and allows omitted optional target', async () => {
    const valid = JSON.stringify({
      action: 'respond',
      detected_state: 'aligned',
      reasoning: 'general chat',
    });
    const { substrate } = makeSubstrate({ llmReturns: valid });
    const out = await classify(baseOpts(substrate));
    expect(out.action).toBe('respond');
    expect(out.target).toBeUndefined();
    expect(out.archetype_lean).toEqual([]);
  });

  it('de-enum: an arbitrary opaque target string passes through (tenant config, not a closed enum)', async () => {
    const valid = JSON.stringify({
      action: 'respond_and_offer_process',
      target: 'any_tenant_defined_process_key',
      detected_state: 'focused',
      reasoning: 'offer a process',
    });
    const { substrate } = makeSubstrate({ llmReturns: valid });
    const out = await classify(baseOpts(substrate));
    expect(out.action).toBe('respond_and_offer_process');
    expect(out.target).toBe('any_tenant_defined_process_key');
  });

  it('unparseable JSON → respond fallback, parse_failed in trace data', async () => {
    const { substrate, lastTraceData } = makeSubstrate({ llmReturns: 'not json at all' });
    const out = await classify(baseOpts(substrate));
    expect(out.action).toBe('respond');
    expect(out.reasoning).toContain('classifier fallback');
    expect(lastTraceData()?.parse_failed).toBe(true);
  });

  it('bad action (Zod enum fail) → respond fallback', async () => {
    const badAction = JSON.stringify({
      action: 'do_something_undefined',
      detected_state: 'aligned',
      reasoning: 'x',
    });
    const { substrate, lastTraceData } = makeSubstrate({ llmReturns: badAction });
    const out = await classify(baseOpts(substrate));
    expect(out.action).toBe('respond');
    expect(lastTraceData()?.parse_failed).toBe(true);
    expect(String(lastTraceData()?.cause)).toContain('zod');
  });

  it('Zod validation error (missing required field) → respond fallback', async () => {
    const missingState = JSON.stringify({ action: 'respond', reasoning: 'x' });
    const { substrate } = makeSubstrate({ llmReturns: missingState });
    const out = await classify(baseOpts(substrate));
    expect(out.action).toBe('respond');
    expect(out.reasoning).toContain('classifier fallback');
  });

  it('uses recentState as best-effort detected_state on fallback', async () => {
    const { substrate } = makeSubstrate({ llmReturns: 'garbage' });
    const opts = baseOpts(substrate);
    opts.memberContext = { recentState: 'frozen' };
    const out = await classify(opts);
    expect(out.detected_state).toBe('frozen');
  });

  it('LLM transport error → resolves fallback (never rejects)', async () => {
    const { substrate } = makeSubstrate({
      llmReturns: () => Promise.reject(new Error('network down')),
    });
    // traceAICall re-throws; classify must still resolve.
    const realSubstrate: AgentSubstrate = {
      ...substrate,
      traceAICall: vi.fn(async (o) => {
        await o.call(); // throws
        throw new Error('unreachable');
      }),
    };
    const opts = baseOpts(realSubstrate);
    await expect(classify(opts)).resolves.toMatchObject({ action: 'respond' });
  });

  it('unconfigured fast slot → fallback, still traced', async () => {
    const { substrate, calls } = makeSubstrate({ llmReturns: '{}', slot: null });
    const out = await classify(baseOpts(substrate));
    expect(out.action).toBe('respond');
    expect(calls.traceEvents).toContainEqual({ eventType: 'classify', modelSlot: 'fast' });
  });

  it('strips ```json fences and extracts embedded object', async () => {
    const fenced =
      'Here is the classification:\n```json\n' +
      JSON.stringify({ action: 'respond', detected_state: 'focused', reasoning: 'ok' }) +
      '\n```';
    const { substrate } = makeSubstrate({ llmReturns: fenced });
    const out = await classify(baseOpts(substrate));
    expect(out.action).toBe('respond');
    expect(out.detected_state).toBe('focused');
  });

  it('returns an independently-awaitable promise (concurrent-safe)', async () => {
    const valid = JSON.stringify({ action: 'respond', detected_state: 'aligned', reasoning: 'x' });
    const { substrate } = makeSubstrate({ llmReturns: valid });
    const [a, b] = await Promise.all([classify(baseOpts(substrate)), classify(baseOpts(substrate))]);
    expect(a.action).toBe('respond');
    expect(b.action).toBe('respond');
  });
});
