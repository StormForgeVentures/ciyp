import { describe, expect, it } from 'vitest';
import { selectQuestion } from './select.js';
import { QUESTION_BANK, type CoachingQuestion } from './index.js';

/**
 * `selectQuestion` — adversarial coverage of the stage/phase/state/frame bias pipeline,
 * anti-repeat, empty-pool widening, and deterministic seeding. The selector returns a SEED
 * — these tests assert on the chosen id/tags, NOT on any verbatim display contract. Uses
 * synthetic banks with GENERIC tags (no coach framework stages).
 */

// A synthetic bank gives precise control over which entry SHOULD win.
const TEST_BANK: readonly CoachingQuestion[] = [
  { id: 'st-vision', text: 'vision q', tags: ['stage_a', 'vision'], placeholder: false },
  { id: 'st-action', text: 'action q', tags: ['stage_a', 'action'], placeholder: false },
  { id: 'st-identity', text: 'identity q', tags: ['stage_a', 'identity'], placeholder: false },
  { id: 'st-energy', text: 'energy q', tags: ['stage_a', 'energy'], placeholder: false },
  { id: 'st-ground', text: 'ground q', tags: ['stage_a', 'grounding', 'overwhelm'], placeholder: false },
  { id: 'st-self', text: 'self q', tags: ['stage_a', 'self-trust'], frame: ['lens_a'], placeholder: false },
  { id: 'other-only', text: 'other q', tags: ['stage_b', 'rest'], placeholder: false },
];

describe('selectQuestion — empty shipped bank', () => {
  it('returns null when the (empty) shipped bank is used', () => {
    expect(QUESTION_BANK).toHaveLength(0);
    expect(selectQuestion({ seed: 'x' })).toBeNull();
  });
});

describe('selectQuestion — stage filter', () => {
  it('confines the pool to the stage tag', () => {
    const s = selectQuestion({ stageFocus: 'stage_b', bank: TEST_BANK, seed: 'm|d' });
    expect(s?.id).toBe('other-only');
  });

  it('uses the whole bank when no stageFocus is given', () => {
    const s = selectQuestion({ bank: TEST_BANK, seed: 'x' });
    expect(s).not.toBeNull();
  });

  it('widens to the whole bank when the stage has zero entries', () => {
    const bank: CoachingQuestion[] = [{ id: 'only', text: 't', tags: ['action'], placeholder: false }];
    const s = selectQuestion({ stageFocus: 'nonexistent', bank, seed: 'x' });
    expect(s?.id).toBe('only');
  });
});

describe('selectQuestion — phase bias', () => {
  it('early prefers vision/alignment tags', () => {
    const s = selectQuestion({ stageFocus: 'stage_a', phase: 'early', bank: TEST_BANK, seed: 'seed-a' });
    expect(s?.id).toBe('st-vision');
  });
  it('mid prefers action/focus tags', () => {
    const s = selectQuestion({ stageFocus: 'stage_a', phase: 'mid', bank: TEST_BANK, seed: 'seed-a' });
    expect(s?.id).toBe('st-action');
  });
  it('late prefers identity/retention tags', () => {
    const s = selectQuestion({ stageFocus: 'stage_a', phase: 'late', bank: TEST_BANK, seed: 'seed-a' });
    expect(s?.id).toBe('st-identity');
  });
});

describe('selectQuestion — state bias', () => {
  it('distress (red) narrows to grounding/rest entries', () => {
    const s = selectQuestion({
      stageFocus: 'stage_a',
      phase: 'mid',
      recentStatus: 'red',
      bank: TEST_BANK,
      seed: 'seed-b',
    });
    expect(s?.id).toBe('st-ground');
  });

  it('overwhelmed is treated as distress', () => {
    const s = selectQuestion({ stageFocus: 'stage_a', recentStatus: 'overwhelmed', bank: TEST_BANK, seed: 'z' });
    expect(s?.id).toBe('st-ground');
  });

  it('green does NOT narrow the pool', () => {
    const s = selectQuestion({ stageFocus: 'stage_a', phase: 'early', recentStatus: 'green', bank: TEST_BANK, seed: 'seed-a' });
    expect(s?.id).toBe('st-vision');
  });

  it('distress widens back when no grounding entry exists (never empty)', () => {
    const bank: CoachingQuestion[] = [{ id: 'a', text: 't', tags: ['stage_a', 'action'], placeholder: false }];
    const s = selectQuestion({ stageFocus: 'stage_a', recentStatus: 'red', bank, seed: 'x' });
    expect(s?.id).toBe('a');
  });
});

describe('selectQuestion — frame bias', () => {
  it('prefers a frame-tagged entry over a neutral one at equal phase', () => {
    const bank: CoachingQuestion[] = [
      { id: 'neutral', text: 't', tags: ['stage_a', 'vision'], placeholder: false },
      { id: 'framed', text: 't', tags: ['stage_a', 'vision'], frame: ['lens_a'], placeholder: false },
    ];
    const s = selectQuestion({ stageFocus: 'stage_a', phase: 'early', frame: 'lens_a', bank, seed: 'k' });
    expect(s?.id).toBe('framed');
  });

  it('frame never EXCLUDES neutral entries', () => {
    const bank: CoachingQuestion[] = [{ id: 'neutral', text: 't', tags: ['stage_a', 'vision'], placeholder: false }];
    const s = selectQuestion({ stageFocus: 'stage_a', frame: 'lens_a', bank, seed: 'k' });
    expect(s?.id).toBe('neutral');
  });
});

describe('selectQuestion — anti-repeat', () => {
  it('drops recently-used ids', () => {
    const s = selectQuestion({
      stageFocus: 'stage_a',
      phase: 'early',
      recentQuestionIds: ['st-vision'],
      bank: TEST_BANK,
      seed: 'seed-a',
    });
    expect(s?.id).not.toBe('st-vision');
  });

  it('widens to the whole bank (minus recent) when anti-repeat empties the stage pool', () => {
    const bank: CoachingQuestion[] = [
      { id: 'stage-a', text: 't', tags: ['stage_x'], placeholder: false },
      { id: 'other', text: 't', tags: ['stage_y'], placeholder: false },
    ];
    const s = selectQuestion({ stageFocus: 'stage_x', recentQuestionIds: ['stage-a'], bank, seed: 'x' });
    expect(s?.id).toBe('other');
  });

  it('allows a repeat only when EVERY entry is recently used (never returns nothing)', () => {
    const bank: CoachingQuestion[] = [{ id: 'only', text: 't', tags: ['stage_x'], placeholder: false }];
    const s = selectQuestion({ stageFocus: 'stage_x', recentQuestionIds: ['only'], bank, seed: 'x' });
    expect(s?.id).toBe('only');
  });
});

describe('selectQuestion — determinism', () => {
  it('same seed + same inputs → same pick', () => {
    const a = selectQuestion({ stageFocus: 'stage_a', phase: 'mid', bank: TEST_BANK, seed: 'member-1|2026-06-10' });
    const b = selectQuestion({ stageFocus: 'stage_a', phase: 'mid', bank: TEST_BANK, seed: 'member-1|2026-06-10' });
    expect(a?.id).toBe(b?.id);
  });

  it('different seeds can rotate the pick within a tied tier', () => {
    const bank: CoachingQuestion[] = [
      { id: 'a', text: 't', tags: ['stage_a', 'vision'], placeholder: false },
      { id: 'b', text: 't', tags: ['stage_a', 'vision'], placeholder: false },
      { id: 'c', text: 't', tags: ['stage_a', 'vision'], placeholder: false },
    ];
    const ids = new Set<string>();
    for (const seed of ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8']) {
      ids.add(selectQuestion({ stageFocus: 'stage_a', phase: 'early', bank, seed })?.id ?? '');
    }
    expect(ids.size).toBeGreaterThan(1);
  });

  it('the returned tags are a copy, not a reference to the corpus entry (no mutation leak)', () => {
    const s = selectQuestion({ stageFocus: 'stage_a', bank: TEST_BANK, seed: 'm|d' });
    const original = TEST_BANK.find((q) => q.id === s?.id)!;
    s?.tags.push('MUTATED');
    expect(original.tags).not.toContain('MUTATED');
  });
});
