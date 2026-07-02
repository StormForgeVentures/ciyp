/**
 * The deterministic Goal-gate evaluator — the HEART of the integrity rule. This is the
 * code that decides "is the Goal met?" so the AI never does. It is what makes the
 * integrity rule executable: the engine calls `evaluateGoal` before ANY
 * `process_complete`; the AI's text never substitutes.
 *
 * One branch per `output_type` (the closed set):
 *   - metric-threshold : compare the captured metric to the threshold.
 *   - doc-approved     : the structured doc exists AND the member confirmed it.
 *   - ai-verified      : an LLM verifier judges the Goal met (traced).
 *   - none             : no gate (always met).
 *
 * THE LOOP IS GOAL-GATED, NEVER COUNTER-GATED. For a metric-threshold goal the engine
 * re-enters the loop body while `met === false`. The ONLY count in the system is the
 * LOOP GUARD: a bounded number of UNPRODUCTIVE re-asks (no metric captured / no
 * progress) before a graceful exit. The guard surfaces via the gate's `reason`
 * (`'loop_guard_tripped'`) — NOT the AI's discretion. A guard-tripped gate returns
 * `met: false` (the Goal was never met) so the engine exits to `free` without faking
 * completion.
 *
 * Purity: a pure function over `definition` + `runState`. The `ai-verified` branch takes
 * an injected (traced) verifier so tests run without a live LLM.
 */
import type { CodeProcessDefinition } from './types.js';

/**
 * The runtime accumulator the engine maintains across a process run. The runner
 * populates it from parsed member turns (the metric value, doc draft, member approval)
 * — NEVER from raw AI text claiming completion.
 */
export interface ProcessRunState {
  /** The latest member-reported metric value, if captured. */
  metricValue?: number | null;
  /** Whether the structured output doc has been produced (doc-approved). */
  docProduced?: boolean;
  /** Whether the member explicitly confirmed/approved the doc (doc-approved). */
  memberApproved?: boolean;
  /** The member explicitly asked to stop (a universal invariant exit). */
  memberStopped?: boolean;
  /**
   * Count of consecutive UNPRODUCTIVE rounds (member refused to rate / no progress).
   * Drives the loop GUARD only — never the loop itself. Reset whenever a metric is
   * captured or progress is made.
   */
  unproductiveRounds?: number;
}

/** The bounded loop-guard limit: unproductive re-asks before a graceful exit. */
export const LOOP_GUARD_LIMIT = 3;

/** The gate result: whether the Goal is met + a machine-readable reason. */
export interface GoalGateResult {
  met: boolean;
  /**
   * Why the gate decided as it did. Drives the engine's next move:
   *   - 'goal_met'            : the Goal is genuinely satisfied → engine may complete.
   *   - 'metric_above_threshold' / 'metric_not_captured' : loop again (re-enter).
   *   - 'doc_missing' / 'awaiting_approval'              : not yet complete.
   *   - 'member_stopped'      : graceful exit, Goal NOT met (honored "stop").
   *   - 'loop_guard_tripped'  : bounded unproductive rounds → graceful exit, NOT met.
   *   - 'no_gate'             : output_type 'none' — always met.
   */
  reason:
    | 'goal_met'
    | 'metric_above_threshold'
    | 'metric_not_captured'
    | 'doc_missing'
    | 'awaiting_approval'
    | 'member_stopped'
    | 'loop_guard_tripped'
    | 'no_gate';
}

/** Optional verifier injection for the `ai-verified` branch (traced by the runner). */
export interface GoalGateDeps {
  /** Returns true when the LLM verifier judges the criterion met. */
  aiVerify?: (criterion: string, runState: ProcessRunState) => Promise<boolean>;
}

/** Compare two numbers under a goal comparator. */
function compare(
  value: number,
  comparator: '<=' | '>=' | '<' | '>' | '==',
  threshold: number,
): boolean {
  switch (comparator) {
    case '<=':
      return value <= threshold;
    case '>=':
      return value >= threshold;
    case '<':
      return value < threshold;
    case '>':
      return value > threshold;
    case '==':
      return value === threshold;
  }
}

/**
 * Evaluate whether a process's Goal is met. The engine calls this before any
 * `process_complete`. Returns `{ met, reason }`. The AI's text is NEVER an input.
 *
 * Universal short-circuit: member explicitly stopped → `{ met: false, reason:
 * 'member_stopped' }` (the "stop" invariant — graceful exit, never a faked Goal).
 *
 * `ai-verified` is async (injected verifier); the other three branches are sync but the
 * function is async-uniform so the engine has one call shape.
 */
export async function evaluateGoal(
  definition: Pick<CodeProcessDefinition, 'output_type' | 'goal'>,
  runState: ProcessRunState,
  deps: GoalGateDeps = {},
): Promise<GoalGateResult> {
  // Universal invariant: an explicit "stop" exits gracefully, Goal NOT met.
  if (runState.memberStopped) {
    return { met: false, reason: 'member_stopped' };
  }

  const goal = definition.goal;
  switch (goal.kind) {
    case 'none':
      return { met: true, reason: 'no_gate' };

    case 'metric-threshold': {
      // The loop guard: bounded unproductive rounds → graceful exit, NOT met. Checked
      // BEFORE the metric so a refuse-to-rate member never loops forever.
      if ((runState.unproductiveRounds ?? 0) >= LOOP_GUARD_LIMIT) {
        return { met: false, reason: 'loop_guard_tripped' };
      }
      if (typeof runState.metricValue !== 'number') {
        // No metric captured this round → loop again (or trip the guard next round).
        return { met: false, reason: 'metric_not_captured' };
      }
      const met = compare(runState.metricValue, goal.comparator, goal.threshold);
      return met
        ? { met: true, reason: 'goal_met' }
        : { met: false, reason: 'metric_above_threshold' };
    }

    case 'doc-approved': {
      if (!runState.docProduced) return { met: false, reason: 'doc_missing' };
      if (!runState.memberApproved) return { met: false, reason: 'awaiting_approval' };
      return { met: true, reason: 'goal_met' };
    }

    case 'ai-verified': {
      if (!deps.aiVerify) {
        // No verifier wired — fail safe (Goal NOT met) rather than fake completion.
        return { met: false, reason: 'awaiting_approval' };
      }
      const judged = await deps.aiVerify(goal.criterion, runState);
      return judged
        ? { met: true, reason: 'goal_met' }
        : { met: false, reason: 'awaiting_approval' };
    }
  }
}

/**
 * Whether a metric-threshold gate result means "loop again" (re-enter the loop body) vs
 * "stop". Only `met: false` with a non-terminal reason loops; `member_stopped` /
 * `loop_guard_tripped` exit.
 */
export function shouldLoop(result: GoalGateResult): boolean {
  return (
    !result.met &&
    (result.reason === 'metric_above_threshold' || result.reason === 'metric_not_captured')
  );
}
