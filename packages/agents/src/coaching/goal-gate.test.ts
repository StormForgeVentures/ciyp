/**
 * Goal-gate evaluator tests — the deterministic completion gate that makes the
 * integrity rule executable. One branch per `output_type`:
 *   - metric-threshold: met / unmet / at-boundary; a stricter sub-threshold; the loop
 *     guard; the never-loop-forever case.
 *   - doc-approved: the doc-exists × member-approved matrix.
 *   - ai-verified: the injected (mocked) verifier; fail-safe when unwired.
 *   - none: always passes.
 * Plus the universal "stop" invariant and the integrity-rule assertion: the AI's text is
 * NEVER an input — only the parsed runState drives `met`. The metric key is an opaque
 * tenant string.
 */
import { describe, it, expect, vi } from 'vitest';
import { evaluateGoal, shouldLoop, LOOP_GUARD_LIMIT } from './goal-gate.js';
import type { ProcessGoal } from './types.js';

const metricGoal = (threshold = 3): { output_type: 'metric-threshold'; goal: ProcessGoal } => ({
  output_type: 'metric-threshold',
  goal: { kind: 'metric-threshold', metric: 'distress_rating', comparator: '<=', threshold, measured_by: 'member_reported' },
});
const docGoal = { output_type: 'doc-approved' as const, goal: { kind: 'doc-approved', requires_doc: true, requires_member_approval: true } as ProcessGoal };
const noneGoal = { output_type: 'none' as const, goal: { kind: 'none' } as ProcessGoal };

describe('metric-threshold (opaque metric ≤ 3)', () => {
  it('met when the metric is below the threshold', async () => {
    const r = await evaluateGoal(metricGoal(3), { metricValue: 1 });
    expect(r).toEqual({ met: true, reason: 'goal_met' });
  });

  it('met at the boundary (value === threshold)', async () => {
    const r = await evaluateGoal(metricGoal(3), { metricValue: 3 });
    expect(r.met).toBe(true);
  });

  it('NOT met when the metric is above the threshold → loop again', async () => {
    const r = await evaluateGoal(metricGoal(3), { metricValue: 7 });
    expect(r).toEqual({ met: false, reason: 'metric_above_threshold' });
    expect(shouldLoop(r)).toBe(true);
  });

  it('honors a stricter sub-threshold (≤ 2): 3 is not met, 2 is', async () => {
    expect((await evaluateGoal(metricGoal(2), { metricValue: 3 })).met).toBe(false);
    expect((await evaluateGoal(metricGoal(2), { metricValue: 2 })).met).toBe(true);
  });

  it('no metric captured → loop again (not yet a guard trip)', async () => {
    const r = await evaluateGoal(metricGoal(3), { metricValue: null });
    expect(r).toEqual({ met: false, reason: 'metric_not_captured' });
    expect(shouldLoop(r)).toBe(true);
  });
});

describe('the loop guard (never loops forever)', () => {
  it('trips after LOOP_GUARD_LIMIT unproductive rounds → graceful exit, NOT met', async () => {
    const r = await evaluateGoal(metricGoal(3), { unproductiveRounds: LOOP_GUARD_LIMIT, metricValue: null });
    expect(r).toEqual({ met: false, reason: 'loop_guard_tripped' });
    // A guard-tripped result does NOT loop (it exits to free).
    expect(shouldLoop(r)).toBe(false);
  });

  it('does not trip below the limit', async () => {
    const r = await evaluateGoal(metricGoal(3), { unproductiveRounds: LOOP_GUARD_LIMIT - 1, metricValue: null });
    expect(r.reason).toBe('metric_not_captured');
  });
});

describe('the "stop" invariant (universal)', () => {
  it('a member stop exits gracefully with Goal NOT met, regardless of output_type', async () => {
    for (const g of [metricGoal(3), docGoal, noneGoal]) {
      const r = await evaluateGoal(g, { memberStopped: true, metricValue: 1, docProduced: true, memberApproved: true });
      expect(r).toEqual({ met: false, reason: 'member_stopped' });
    }
  });
});

describe('doc-approved', () => {
  it('matrix: only doc-exists AND member-approved is met', async () => {
    expect((await evaluateGoal(docGoal, { docProduced: false, memberApproved: false })).reason).toBe('doc_missing');
    expect((await evaluateGoal(docGoal, { docProduced: true, memberApproved: false })).reason).toBe('awaiting_approval');
    expect((await evaluateGoal(docGoal, { docProduced: false, memberApproved: true })).reason).toBe('doc_missing');
    expect(await evaluateGoal(docGoal, { docProduced: true, memberApproved: true })).toEqual({ met: true, reason: 'goal_met' });
  });
});

describe('ai-verified (substrate supports it)', () => {
  const aiGoal = { output_type: 'ai-verified' as const, goal: { kind: 'ai-verified', criterion: 'the member named a next step' } as ProcessGoal };

  it('uses the injected verifier', async () => {
    const aiVerify = vi.fn().mockResolvedValue(true);
    const r = await evaluateGoal(aiGoal, {}, { aiVerify });
    expect(r.met).toBe(true);
    expect(aiVerify).toHaveBeenCalledWith('the member named a next step', {});
  });

  it('fails safe (NOT met) when no verifier is wired — never fakes completion', async () => {
    const r = await evaluateGoal(aiGoal, {});
    expect(r.met).toBe(false);
  });
});

describe('none (no gate)', () => {
  it('always met', async () => {
    expect(await evaluateGoal(noneGoal, {})).toEqual({ met: true, reason: 'no_gate' });
  });
});

describe('integrity rule: AI text is NEVER an input', () => {
  it('evaluateGoal takes only the definition + parsed runState — no text field exists', async () => {
    // The runState shape has no "aiClaimedComplete" / text field. Even a runState that
    // is otherwise "complete-looking" but with the metric unmet returns met:false.
    const r = await evaluateGoal(metricGoal(3), { metricValue: 9 });
    expect(r.met).toBe(false);
  });
});
