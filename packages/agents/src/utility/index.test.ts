/**
 * Utility-agent tests — breathwork pacer modes, the alignment-prompt question + 60s
 * silence, the NO-structured-output invariant, and the linter-chain-applies assertion
 * (utilities are NOT exempt).
 */
import { describe, it, expect } from 'vitest';
import {
  buildBreathworkRun,
  breathCueSequence,
  BREATHWORK_TARGET_MS,
} from './breathwork-pacer/index.js';
import {
  buildAlignmentPromptRun,
  ALIGNMENT_SILENCE_MS,
} from './alignment-prompt/index.js';
import { runLinterChain } from '../linters/index.js';

describe('breathwork_pacer', () => {
  it('builds a ~90s run for box / 4-7-8 / coherent modes', () => {
    for (const mode of ['box', '478', 'coherent'] as const) {
      const run = buildBreathworkRun({ mode });
      expect(run.agentKind).toBe('breathwork_pacer');
      expect(run.totalMs).toBeLessThanOrEqual(BREATHWORK_TARGET_MS);
      // At least one full cycle fits in 90s for every mode.
      expect(run.steps.length).toBeGreaterThan(0);
    }
  });

  it('box mode uses 4-4-4-4 phases', () => {
    const run = buildBreathworkRun({ mode: 'box' });
    const firstCycle = run.steps.slice(0, 4);
    expect(firstCycle.map((s) => s.kind === 'breath' && s.phase)).toEqual([
      'inhale',
      'hold',
      'exhale',
      'hold',
    ]);
    expect(firstCycle.every((s) => s.durationMs === 4000)).toBe(true);
  });

  it('voice-led variant exposes a breath-cue sequence', () => {
    const run = buildBreathworkRun({ mode: 'coherent' });
    const cues = breathCueSequence(run);
    expect(cues).toContain('inhale');
    expect(cues).toContain('exhale');
  });

  it('emits NO structured output (lived experience IS the output)', () => {
    expect(buildBreathworkRun().emitsStructuredOutput).toBe(false);
  });
});

describe('alignment_prompt', () => {
  it('presents a single question + a 60s silence', () => {
    const run = buildAlignmentPromptRun({ question: 'What is true beneath the story?' });
    expect(run.agentKind).toBe('alignment_prompt');
    expect(run.steps[0]).toMatchObject({ kind: 'line', text: 'What is true beneath the story?' });
    const silence = run.steps.find((s) => s.kind === 'silence');
    expect(silence?.durationMs).toBe(ALIGNMENT_SILENCE_MS);
  });

  it('emits NO structured output', () => {
    expect(buildAlignmentPromptRun({ question: 'q' }).emitsStructuredOutput).toBe(false);
  });
});

describe('utilities are NOT exempt from the linter chain', () => {
  it('a utility line still runs through runLinterChain (no-shame state-gated)', async () => {
    const result = await runLinterChain('Let us take three slow breaths together.', {
      registeredArchetypeNames: [],
      detectedState: 'aligned',
      archetypeLean: [],
      winkCount: 0,
    });
    expect(result.pass).toBe(true);
    expect(result.finalText).toContain('three slow breaths');
  });

  it('em-dash normalization applies to utility lines too (voice linter not bypassed)', async () => {
    const result = await runLinterChain('Breathe in—then out.', {
      registeredArchetypeNames: [],
      detectedState: 'aligned',
      archetypeLean: [],
      winkCount: 0,
    });
    expect(result.finalText).not.toContain('—');
  });
});
