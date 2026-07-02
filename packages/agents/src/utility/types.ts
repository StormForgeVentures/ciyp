/**
 * Utility-agent shared types. The two v1 utility agents (`breathwork_pacer`,
 * `alignment_prompt`) produce a deterministic SEQUENCE of timed cues/lines — the
 * lived experience IS the output (NO structured-output row, NO memory feed). Any
 * AI-generated line passes the SAME linter chain (utilities are NOT exempt).
 *
 * These utilities are generic wellness primitives (paced breathing + a single
 * reflective prompt with silence), not coach-specific content.
 */

/** The closed utility-agent kind set. */
export type UtilityAgentKind = 'breathwork_pacer' | 'alignment_prompt';

/** A breath cue phase the voice-led pacer emits over the event bus. */
export type BreathPhase = 'inhale' | 'hold' | 'exhale';

/**
 * One step in a utility sequence: either a spoken/displayed LINE (passed through the
 * linter chain when AI-generated) or a timed HOLD (silent action), optionally with a
 * breath cue. Durations are in milliseconds.
 */
export type UtilityStep =
  | { kind: 'line'; text: string; durationMs: number }
  | { kind: 'breath'; phase: BreathPhase; durationMs: number }
  | { kind: 'silence'; durationMs: number };

/** A built utility run — the sequence + metadata. Carries NO structured output. */
export interface UtilityRun {
  agentKind: UtilityAgentKind;
  steps: UtilityStep[];
  /** Total run duration (ms). */
  totalMs: number;
  /**
   * Invariant marker: utilities emit NO structured output. Always false; a test
   * asserts it so a future change that adds a structured-output write trips.
   */
  emitsStructuredOutput: false;
}
