import { describe, expect, it } from 'vitest';
import { playfulnessLinter, hasLightness } from './playfulness.js';

/**
 * playfulnessLinter. Distress-state block, frequency-cap block, eligible-state pass,
 * archetype-widening (state-gate/cap not overridden). WHICH lean widens is config —
 * a generic placeholder lean key is used, no coach-named literal.
 */

const WINK = 'You did it 😉 nice work.';
const SINCERE = 'You did it. That took real courage.';
const WIDEN = ['jester_voice']; // opaque tenant-config lean that widens lightness

describe('playfulnessLinter — lightness detection', () => {
  it('detects emoji winks / lol / aphorisms', () => {
    expect(hasLightness('😉')).toBe(true);
    expect(hasLightness('lol that is wild')).toBe(true);
    expect(hasLightness('as above, so below')).toBe(true);
  });

  it('sincere text has no lightness and passes untouched', () => {
    const r = playfulnessLinter(SINCERE, { detectedState: 'overwhelmed', winkCount: 0 });
    expect(r.pass).toBe(true);
    expect(r.blocks).toEqual([]);
  });
});

describe('playfulnessLinter — state-gate', () => {
  it('blocks lightness in a distress state (overwhelmed)', () => {
    const r = playfulnessLinter(WINK, { detectedState: 'overwhelmed', winkCount: 0 });
    expect(r.pass).toBe(false);
    expect(r.blocks[0]?.kind).toBe('playfulness');
    expect(r.blocks[0]?.traceData.reason).toBe('distress_state');
  });

  it('blocks lightness when frozen / burned_out / dysregulated', () => {
    for (const state of ['frozen', 'burned_out', 'dysregulated', 'disconnected'] as const) {
      const r = playfulnessLinter(WINK, { detectedState: state, winkCount: 0 });
      expect(r.pass).toBe(false);
    }
  });

  it('permits lightness in eligible states (aligned/focused/energized/avoidant)', () => {
    for (const state of ['aligned', 'focused', 'energized', 'avoidant'] as const) {
      const r = playfulnessLinter(WINK, { detectedState: state, winkCount: 0 });
      expect(r.pass).toBe(true);
    }
  });
});

describe('playfulnessLinter — frequency cap', () => {
  it('blocks lightness at/over the cap even in an eligible state', () => {
    const r = playfulnessLinter(WINK, { detectedState: 'aligned', winkCount: 1, winkCap: 1 });
    expect(r.pass).toBe(false);
    expect(r.blocks[0]?.traceData.reason).toBe('frequency_cap');
  });

  it('passes under the cap in an eligible state', () => {
    const r = playfulnessLinter(WINK, { detectedState: 'aligned', winkCount: 0, winkCap: 1 });
    expect(r.pass).toBe(true);
  });
});

describe('playfulnessLinter — archetype-widening (config-driven)', () => {
  it('a widening lean widens the cap (allows one more wink)', () => {
    // At winkCount 1 with cap 1: blocked normally, allowed when a widening lean is active.
    const blocked = playfulnessLinter(WINK, {
      detectedState: 'aligned',
      winkCount: 1,
      winkCap: 1,
    });
    expect(blocked.pass).toBe(false);

    const widened = playfulnessLinter(WINK, {
      detectedState: 'aligned',
      winkCount: 1,
      winkCap: 1,
      archetypeLean: WIDEN,
      lightnessWideningLeans: WIDEN,
    });
    expect(widened.pass).toBe(true);
  });

  it('a lean NOT in the widening set does NOT widen', () => {
    const r = playfulnessLinter(WINK, {
      detectedState: 'aligned',
      winkCount: 1,
      winkCap: 1,
      archetypeLean: ['some_other_lean'],
      lightnessWideningLeans: WIDEN,
    });
    expect(r.pass).toBe(false);
  });

  it('a widening lean NEVER overrides the state-gate (distress still blocks)', () => {
    const r = playfulnessLinter(WINK, {
      detectedState: 'overwhelmed',
      winkCount: 0,
      archetypeLean: WIDEN,
      lightnessWideningLeans: WIDEN,
    });
    expect(r.pass).toBe(false);
    expect(r.blocks[0]?.traceData.reason).toBe('distress_state');
  });

  it('a widening lean NEVER removes the cap (still blocks well over the widened cap)', () => {
    const r = playfulnessLinter(WINK, {
      detectedState: 'aligned',
      winkCount: 5,
      winkCap: 1,
      archetypeLean: WIDEN,
      lightnessWideningLeans: WIDEN,
    });
    expect(r.pass).toBe(false);
    expect(r.blocks[0]?.traceData.reason).toBe('frequency_cap');
  });
});

describe('playfulnessLinter — re-prompt', () => {
  it('a block returns the re-prompt-without-the-joke instruction', () => {
    const r = playfulnessLinter(WINK, { detectedState: 'overwhelmed', winkCount: 0 });
    expect(r.blocks[0]?.repromptInstruction).toContain('without the joke');
  });
});
