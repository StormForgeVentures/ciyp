/**
 * Utility agents — `breathwork_pacer` + `alignment_prompt`. The two v1 utilities
 * whose lived experience IS the output (no structured outputs). Both are
 * deterministic sequence builders; the runtime plays the sequence in text or on the
 * voice runtime. AI-generated lines pass the SAME linter chain (the caller runs
 * `runLinterChain`).
 */
export * from './types.js';
export {
  buildBreathworkRun,
  breathCueSequence,
  BREATHWORK_TARGET_MS,
  type BreathMode,
  type BreathworkOptions,
} from './breathwork-pacer/index.js';
export {
  buildAlignmentPromptRun,
  ALIGNMENT_SILENCE_MS,
  ALIGNMENT_QUESTION_MS,
  type AlignmentPromptOptions,
} from './alignment-prompt/index.js';
