import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  runCadenceTurn,
  finalizeCadence,
  buildCadenceDirective,
  computeJourneyPhase,
  weaveSignatureQuestions,
  CADENCE_KINDS,
  type CadenceBeatSpec,
} from './index.js';
import type { AgentSubstrate, LlmStreamer, LlmCaller } from '../llm/types.js';

/**
 * Generic bounded-cadence agent — directive assembly, journey-phase math, the streamed
 * linter-passed turn + step advance, and the FORCED FINALIZE (emit → repair →
 * conversation-state fallback → throw when the draft is insufficient). The output schema,
 * beats, and role/intro are all INJECTED — no coach content ships here.
 */

const BEATS: CadenceBeatSpec[] = [
  { key: 'opening', description: 'Opening: a short warm orienting question.', skippable: true },
  { key: 'energy', description: 'Energy: how is their energy today, 1-10?' },
  { key: 'reflection', description: 'Reflection: one thing on their mind.' },
];

const OutputSchema = z.object({
  score: z.number().int().min(1).max(10),
  note: z.string(),
});
type Output = z.infer<typeof OutputSchema>;

interface Draft {
  score?: number;
  note?: string;
}

function buildFallback(draft: Draft): Output {
  if (typeof draft.score !== 'number') {
    throw new Error('cadence finalize failed: no score captured and emit failed');
  }
  return OutputSchema.parse({ score: draft.score, note: draft.note ?? '' });
}

function makeSubstrate(): AgentSubstrate {
  return {
    llm: vi.fn(async () => ''),
    getModelSlot: vi.fn(async () => ({ model: 'test/chat-model' })),
    traceAICall: vi.fn(async (opts) => opts.call()),
  };
}

const baseLinter = { registeredArchetypeNames: ['Sage', 'North Star'] };

describe('CADENCE_KINDS', () => {
  it('are the generic platform cadence keys (daily / weekly / monthly_review)', () => {
    expect([...CADENCE_KINDS]).toEqual(['daily', 'weekly', 'monthly_review']);
  });
});

describe('buildCadenceDirective', () => {
  it('builds a valid directive from injected role/intro/beats with no coach content', () => {
    const d = buildCadenceDirective({
      role: 'a coaching companion',
      intro: 'It should take under 90 seconds and feel like a mirror, not a manager.',
      beats: BEATS,
      displayName: 'Sam',
    });
    expect(d).toContain('a coaching companion');
    expect(d).toContain('Sam');
    expect(d).toContain('Energy: how is their energy');
    expect(d).toContain('mirror, not a manager');
  });

  it('quick mode strips skippable beats but keeps the rest', () => {
    const d = buildCadenceDirective({
      role: 'a coaching companion',
      intro: 'x',
      beats: BEATS,
      quickMode: true,
    });
    expect(d).not.toContain('Opening: a short warm orienting question');
    expect(d).toContain('Energy: how is their energy');
    expect(d).toContain('Reflection: one thing');
  });

  it('weaves a signature question pinned to its beat', () => {
    const d = buildCadenceDirective({
      role: 'a coaching companion',
      intro: 'x',
      beats: BEATS,
      signatureQuestions: [{ id: 'q1', text: 'Did you protect your deep-work block?', beat: 'energy' }],
    });
    expect(d).toContain('Did you protect your deep-work block?');
  });
});

describe('weaveSignatureQuestions', () => {
  it('pins to a recognized beat and folds unknown-beat questions to the default', () => {
    const m = weaveSignatureQuestions(
      BEATS,
      [
        { id: 'q1', text: 'A', beat: 'energy' },
        { id: 'q2', text: 'B', beat: 'nonsense' },
      ],
      'reflection',
    );
    expect(m.energy).toEqual(['A']);
    expect(m.reflection).toEqual(['B']);
  });
});

describe('computeJourneyPhase', () => {
  it('early / mid / late across the window thirds', () => {
    expect(computeJourneyPhase('2026-06-01', 90, '2026-06-10')).toBe('early');
    expect(computeJourneyPhase('2026-06-01', 90, '2026-07-15')).toBe('mid');
    expect(computeJourneyPhase('2026-06-01', 90, '2026-08-20')).toBe('late');
  });
  it('a date past the window clamps to late; before-start clamps to early', () => {
    expect(computeJourneyPhase('2026-06-01', 90, '2027-01-01')).toBe('late');
    expect(computeJourneyPhase('2026-06-10', 90, '2026-06-01')).toBe('early');
  });
  it('missing/invalid start degrades to early', () => {
    expect(computeJourneyPhase(null, 90, '2026-06-10')).toBe('early');
    expect(computeJourneyPhase('not-a-date', 90, '2026-06-10')).toBe('early');
  });
  it('respects a non-default window length', () => {
    expect(computeJourneyPhase('2026-06-01', 30, '2026-06-05')).toBe('early');
    expect(computeJourneyPhase('2026-06-01', 30, '2026-06-15')).toBe('mid');
    expect(computeJourneyPhase('2026-06-01', 30, '2026-06-25')).toBe('late');
  });
});

describe('runCadenceTurn', () => {
  it('streams a linter-passed line and advances the step when a beat is captured', async () => {
    const substrate = makeSubstrate();
    const streamer: LlmStreamer = async ({ onDelta }) => {
      onDelta?.('How is your energy today?');
      return 'How is your energy today?';
    };
    const deltas: string[] = [];
    const res = await runCadenceTurn({
      memberId: 'm1',
      threadId: 't1',
      userMessage: 'starting',
      systemPrompt: '[SYS]',
      stepIndex: 0,
      totalBeats: BEATS.length,
      beatCaptured: true,
      surface: 'daily',
      substrate,
      streamer,
      chatModel: 'test/chat-model',
      linter: baseLinter,
      onTextDelta: (d) => deltas.push(d),
    });
    expect(res.assistantMessage).toBe('How is your energy today?');
    expect(res.nextStepIndex).toBe(1);
    expect(deltas).toContain('How is your energy today?');
    expect(substrate.traceAICall).toHaveBeenCalledOnce();
  });

  it('does not advance the step when no beat was captured, and clamps at totalBeats', async () => {
    const substrate = makeSubstrate();
    const streamer: LlmStreamer = async () => 'Say more?';
    const noAdvance = await runCadenceTurn({
      memberId: 'm1', threadId: 't1', userMessage: 'hmm', systemPrompt: '[SYS]',
      stepIndex: 2, totalBeats: BEATS.length, beatCaptured: false, surface: 'daily',
      substrate, streamer, chatModel: 'x', linter: baseLinter,
    });
    expect(noAdvance.nextStepIndex).toBe(2);

    const clamped = await runCadenceTurn({
      memberId: 'm1', threadId: 't1', userMessage: 'x', systemPrompt: '[SYS]',
      stepIndex: BEATS.length, totalBeats: BEATS.length, beatCaptured: true, surface: 'daily',
      substrate, streamer, chatModel: 'x', linter: baseLinter,
    });
    expect(clamped.nextStepIndex).toBe(BEATS.length);
  });

  it('vets the streamed line through the linter chain (em-dash normalized)', async () => {
    const substrate = makeSubstrate();
    const streamer: LlmStreamer = async () => 'Breathe in—then out.';
    const res = await runCadenceTurn({
      memberId: 'm1', threadId: 't1', userMessage: 'x', systemPrompt: '[SYS]',
      stepIndex: 0, totalBeats: BEATS.length, beatCaptured: false, surface: 'daily',
      substrate, streamer, chatModel: 'x', linter: baseLinter,
    });
    expect(res.assistantMessage).not.toContain('—');
  });
});

describe('finalizeCadence (the forced finalize)', () => {
  const draft: Draft = { score: 7, note: 'steady' };

  const call = (llm: LlmCaller, d: Draft = draft) =>
    finalizeCadence<Output, Draft>({
      memberId: 'm1',
      threadId: 't1',
      finalizePrompt: '[FINALIZE]',
      transcript: 'energy 7, steady',
      draft: d,
      outputSchema: OutputSchema,
      buildFallback,
      surface: 'daily_finalize',
      substrate: makeSubstrate(),
      llm,
      chatModel: 'x',
    });

  it('emits a clean schema-validated row', async () => {
    const llm: LlmCaller = async () => JSON.stringify({ score: 7, note: 'steady' });
    const r = await call(llm);
    expect(r.source).toBe('emit');
    expect(r.output.score).toBe(7);
  });

  it('strips prose/fences and extracts the JSON block', async () => {
    const llm: LlmCaller = async () => 'Here is the row:\n```json\n{ "score": 5, "note": "ok" }\n```';
    const r = await call(llm);
    expect(r.source).toBe('emit');
    expect(r.output.score).toBe(5);
  });

  it('repairs on a first malformed emit', async () => {
    let n = 0;
    const llm: LlmCaller = async () => {
      n++;
      return n === 1 ? 'not json at all' : JSON.stringify({ score: 4, note: 'ok' });
    };
    const r = await call(llm);
    expect(r.source).toBe('repair');
    expect(r.output.score).toBe(4);
    expect(n).toBe(2);
  });

  it('falls back to the conversation-state draft when both emits fail (forced finalize)', async () => {
    const llm: LlmCaller = async () => 'still not json';
    const r = await call(llm, { score: 9, note: 'from draft' });
    expect(r.source).toBe('fallback');
    expect(r.output.score).toBe(9);
    expect(r.output.note).toBe('from draft');
  });

  it('throws when emits fail AND the draft is insufficient (no row fabricated)', async () => {
    const llm: LlmCaller = async () => 'nope';
    await expect(call(llm, {})).rejects.toThrow(/no score captured/);
  });

  it('handles an LLM caller that throws by repairing/falling back', async () => {
    const llm: LlmCaller = async () => {
      throw new Error('llm down');
    };
    const r = await call(llm);
    expect(r.source).toBe('fallback');
    expect(r.output.score).toBe(7);
  });
});
