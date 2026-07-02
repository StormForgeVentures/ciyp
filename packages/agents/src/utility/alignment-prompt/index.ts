/**
 * alignment_prompt — presents a SINGLE reflective question + a 60-second silence + an
 * optional reflection. The lived experience IS the output: NO structured-output row,
 * NO memory feed.
 *
 * The question text is INJECTED (the caller supplies it from the tenant's question
 * corpus; a pinned, admin-vetted bank may be treated as verbatim). If the runtime
 * GENERATES the framing line, that generated line passes the SAME linter chain. This
 * module is the pure sequence builder — the package imports no prompt store.
 */
import type { UtilityRun, UtilityStep } from '../types.js';

/** The silent reflection window after the question (60 seconds). */
export const ALIGNMENT_SILENCE_MS = 60_000;
/** How long the question line is shown/spoken before the silence begins. */
export const ALIGNMENT_QUESTION_MS = 6_000;

export interface AlignmentPromptOptions {
  /** The single reflective question (injected from the tenant question corpus). */
  question: string;
  silenceMs?: number;
}

/**
 * Build a single-question alignment-prompt run: the question line, then a 60s
 * silence. Pure + deterministic. Emits NO structured output.
 */
export function buildAlignmentPromptRun(opts: AlignmentPromptOptions): UtilityRun {
  const silenceMs = opts.silenceMs ?? ALIGNMENT_SILENCE_MS;
  const steps: UtilityStep[] = [
    { kind: 'line', text: opts.question, durationMs: ALIGNMENT_QUESTION_MS },
    { kind: 'silence', durationMs: silenceMs },
  ];
  return {
    agentKind: 'alignment_prompt',
    steps,
    totalMs: ALIGNMENT_QUESTION_MS + silenceMs,
    emitsStructuredOutput: false,
  };
}
