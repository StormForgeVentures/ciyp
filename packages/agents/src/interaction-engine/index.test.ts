/**
 * Interaction-engine tests — AI-driven mode switching (the engine reacts to mode
 * signals, NOT a pre-authored line array); per-mode turn-taking (call_response waits
 * + the barge-in override scoped to call_response; hold timer/continue; instruct
 * auto-advance after TTS; free normal turn-taking); the UI-sync event emission +
 * ordering; AI-generated lines DO pass the linter chain; only pinned lines bypass; the
 * breathwork-pacer runs as a caller.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  InteractionEngine,
  bargeInPolicyFor,
  type InteractionEvent,
  type EngineCallbacks,
} from './index.js';
import { runLinterChain } from '../linters/index.js';
import { buildBreathworkRun, breathCueSequence } from '../utility/breathwork-pacer/index.js';

function makeEngine(overrides: Partial<EngineCallbacks> = {}) {
  const events: InteractionEvent[] = [];
  const spoken: string[] = [];
  const vetted: string[] = [];
  const cb: EngineCallbacks = {
    emit: (e) => {
      events.push(e);
    },
    speak: (t) => {
      spoken.push(t);
    },
    vetLine: async (t) => {
      vetted.push(t);
      // Mimic the real linter pass-through (em-dash normalization).
      const r = await runLinterChain(t, {
        registeredArchetypeNames: [],
        detectedState: 'aligned',
        winkCount: 0,
      });
      return r.finalText;
    },
    ...overrides,
  };
  return { engine: new InteractionEngine(cb), events, spoken, vetted };
}

describe('barge-in override scoping', () => {
  it('call_response overrides to wait_for_repeat; every other mode keeps finish_sentence', () => {
    expect(bargeInPolicyFor('call_response')).toBe('wait_for_repeat');
    expect(bargeInPolicyFor('free')).toBe('finish_sentence');
    expect(bargeInPolicyFor('instruct')).toBe('finish_sentence');
    expect(bargeInPolicyFor('hold')).toBe('finish_sentence');
  });
});

describe('per-mode turn-taking', () => {
  it('instruct auto-advances after TTS', async () => {
    const { engine, events } = makeEngine();
    const signal = await engine.deliverLine({ text: 'Sit tall.', mode: 'instruct' });
    expect(signal).toBe('tts_complete');
    // mode entry + step_advanced emitted.
    expect(events.map((e) => e.type)).toEqual(['interaction_mode', 'step_advanced']);
  });

  it('call_response WAITS (emits awaiting_response, advances on turn-end)', async () => {
    const { engine, events } = makeEngine();
    const signal = await engine.deliverLine({ text: 'I am safe.', mode: 'call_response' });
    expect(signal).toBe('vad_turn_end');
    expect(events.map((e) => e.type)).toEqual(['interaction_mode', 'awaiting_response']);
  });

  it('free uses normal conversational turn-taking', async () => {
    const { engine } = makeEngine();
    const signal = await engine.deliverLine({ text: 'What do you notice?', mode: 'free' });
    expect(signal).toBe('vad_turn_end');
  });

  it('hold advances on the timer / explicit continue', async () => {
    const { engine } = makeEngine();
    const signal = await engine.deliverLine({ text: '', mode: 'hold' });
    expect(signal).toBe('timer');
  });
});

describe('AI-driven mode switching, not a line array', () => {
  it('emits interaction_mode on each switch the AI signals', async () => {
    const { engine, events } = makeEngine();
    await engine.setMode('instruct');
    await engine.setMode('call_response');
    const modes = events.filter((e) => e.type === 'interaction_mode');
    expect(modes).toEqual([
      { type: 'interaction_mode', mode: 'instruct' },
      { type: 'interaction_mode', mode: 'call_response' },
    ]);
  });
});

describe('linter pass-through + pinned bypass', () => {
  it('AI-generated lines DO pass the linter chain (em-dash normalized)', async () => {
    const { engine, vetted, spoken } = makeEngine();
    await engine.deliverLine({ text: 'Breathe in—then out.', mode: 'instruct' });
    expect(vetted).toContain('Breathe in—then out.');
    // The vetted/spoken text is normalized (no em-dash).
    expect(spoken[0]).not.toContain('—');
  });

  it('ONLY pinned lines bypass the linters (verbatim)', async () => {
    const vetLine = vi.fn(async (t: string) => t);
    const { engine, spoken } = makeEngine({ vetLine });
    await engine.deliverLine({ text: 'I trust myself—fully.', mode: 'call_response', pinned: true });
    // vetLine was NOT called for the pinned line; it is spoken verbatim (em-dash kept).
    expect(vetLine).not.toHaveBeenCalled();
    expect(spoken[0]).toBe('I trust myself—fully.');
  });
});

describe('process_complete event', () => {
  it('emits process_complete on finish', async () => {
    const { engine, events } = makeEngine();
    await engine.complete();
    expect(events.at(-1)).toEqual({ type: 'process_complete' });
  });
});

describe('breathwork-pacer is a caller of the engine', () => {
  it('drives the engine with hold steps (one breath cue per phase)', async () => {
    const run = buildBreathworkRun({ mode: 'coherent' });
    const cues = breathCueSequence(run);
    const { engine, events } = makeEngine();
    // The breathwork caller signals `hold` per breath phase (silent timed action).
    expect(cues.length).toBeGreaterThan(0);
    for (let i = 0; i < cues.length; i++) {
      await engine.setMode('hold');
      const signal = await engine.deliverLine({ text: '', mode: 'hold' });
      expect(signal).toBe('timer');
    }
    await engine.complete();
    expect(events.at(-1)).toEqual({ type: 'process_complete' });
  });
});
