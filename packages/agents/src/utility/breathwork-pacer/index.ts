/**
 * breathwork_pacer — a ~90-second guided breath in one of three modes (Box / 4-7-8 /
 * Coherent), with optional spoken pacing. The voice-led variant runs on the voice
 * runtime (the interaction engine) and emits `breath_cue` events that drive the
 * breath-circle animation.
 *
 * The lived experience IS the output: NO structured-output row, NO memory feed.
 *
 * Optional spoken intro/outro lines are AI-generated, so they pass the SAME linter
 * chain (utilities are not exempt) — the caller runs them through `runLinterChain`
 * before TTS. This module is the deterministic PACING; the line vetting is
 * caller-owned (purity — the package imports no LLM/store).
 */
import type { BreathPhase, UtilityRun, UtilityStep } from '../types.js';

export type BreathMode = 'box' | '478' | 'coherent';

/** Per-mode phase plan (ms). One CYCLE; the run repeats cycles to ~90s. */
interface PhasePlan {
  inhaleMs: number;
  holdAfterInhaleMs: number;
  exhaleMs: number;
  holdAfterExhaleMs: number;
}

const MODE_PLANS: Record<BreathMode, PhasePlan> = {
  // Box breathing: 4-4-4-4.
  box: { inhaleMs: 4000, holdAfterInhaleMs: 4000, exhaleMs: 4000, holdAfterExhaleMs: 4000 },
  // 4-7-8: inhale 4, hold 7, exhale 8, no post-exhale hold.
  '478': { inhaleMs: 4000, holdAfterInhaleMs: 7000, exhaleMs: 8000, holdAfterExhaleMs: 0 },
  // Coherent breathing: ~5.5s in / 5.5s out, no holds.
  coherent: { inhaleMs: 5500, holdAfterInhaleMs: 0, exhaleMs: 5500, holdAfterExhaleMs: 0 },
};

/** Target total run length (90 seconds). */
export const BREATHWORK_TARGET_MS = 90_000;

export interface BreathworkOptions {
  mode?: BreathMode;
  targetMs?: number;
}

/** Build one breath cycle's steps from a phase plan. */
function cycleSteps(plan: PhasePlan): UtilityStep[] {
  const steps: UtilityStep[] = [];
  const push = (phase: BreathPhase, ms: number) => {
    if (ms > 0) steps.push({ kind: 'breath', phase, durationMs: ms });
  };
  push('inhale', plan.inhaleMs);
  push('hold', plan.holdAfterInhaleMs);
  push('exhale', plan.exhaleMs);
  push('hold', plan.holdAfterExhaleMs);
  return steps;
}

/**
 * Build a 90-second breathwork run for the given mode. Pure + deterministic — the
 * sequence the runtime (text or voice) plays. Emits NO structured output.
 */
export function buildBreathworkRun(opts: BreathworkOptions = {}): UtilityRun {
  const mode = opts.mode ?? 'box';
  const target = opts.targetMs ?? BREATHWORK_TARGET_MS;
  const plan = MODE_PLANS[mode];
  const cycleMs =
    plan.inhaleMs + plan.holdAfterInhaleMs + plan.exhaleMs + plan.holdAfterExhaleMs;

  const steps: UtilityStep[] = [];
  let elapsed = 0;
  // Repeat whole cycles until adding another would overshoot the target.
  while (elapsed + cycleMs <= target) {
    steps.push(...cycleSteps(plan));
    elapsed += cycleMs;
  }
  // If no full cycle fits (degenerate target), include at least one.
  if (steps.length === 0) {
    steps.push(...cycleSteps(plan));
    elapsed = cycleMs;
  }

  return {
    agentKind: 'breathwork_pacer',
    steps,
    totalMs: elapsed,
    emitsStructuredOutput: false,
  };
}

/** The breath-cue phases in order (for the voice-led event emission). */
export function breathCueSequence(run: UtilityRun): BreathPhase[] {
  return run.steps
    .filter((s): s is Extract<UtilityStep, { kind: 'breath' }> => s.kind === 'breath')
    .map((s) => s.phase);
}
