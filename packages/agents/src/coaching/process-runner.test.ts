/**
 * ProcessRunner tests — the runner drives the interaction engine UNCHANGED (no new
 * modes/events), injects the prescriptiveness "how much rope" language + the verbatim
 * integrity-rule instruction, pins provenance, brackets the run with started/completed
 * traces, and — the structural integrity rule — fires `process_complete` ONLY after the
 * Goal-gate is met.
 *
 * Uses GENERIC in-test process definitions (no coach-named fixtures). Includes the
 * `source: 'authored'` parity test (002a AC-4): an authored definition runs identically
 * to a code one.
 */
import { describe, it, expect } from 'vitest';
import { ProcessRunner, assembleProcessDirective } from './process-runner.js';
import type { EngineCallbacks } from '../interaction-engine/index.js';
import type { InteractionEvent } from '../interaction-engine/index.js';
import { INTEGRITY_RULE_INSTRUCTION, type CodeProcessDefinition } from './types.js';
import type { TraceAICall } from '../llm/types.js';

/** A generic metric-threshold process (tight rope). */
const metricProcess: CodeProcessDefinition = {
  key: 'metric_loop',
  title: 'A Metric Loop',
  directive: 'Guide the member through a short metric-tracked reset.',
  output_type: 'metric-threshold',
  goal: { kind: 'metric-threshold', metric: 'distress_rating', comparator: '<=', threshold: 3, measured_by: 'member_reported' },
  mode_arc: [
    { id: 'capture', mode: 'free', intent: 'capture the starting rating' },
    { id: 'work', mode: 'call_response', intent: 'run a round', loops: true },
  ],
  prescriptiveness: 'tight',
  agent_kind: 'reset_persona',
  source: 'code',
  version: 1,
};

/** A generic doc-approved process (mid rope). */
const docProcess: CodeProcessDefinition = {
  key: 'reflection_doc',
  title: 'A Reflection Doc',
  directive: 'Co-write a short reflection document with the member.',
  output_type: 'doc-approved',
  goal: { kind: 'doc-approved', requires_doc: true, requires_member_approval: true },
  mode_arc: [{ id: 'draft', mode: 'free', intent: 'draft the reflection together' }],
  prescriptiveness: 'mid',
  agent_kind: 'reflection_persona',
  source: 'code',
  version: 1,
};

/** The SAME metric process but authored (source: 'authored') — for the AC-4 parity test. */
const authoredMetricProcess: CodeProcessDefinition = { ...metricProcess, source: 'authored' };

function makeCallbacks() {
  const events: InteractionEvent[] = [];
  const cb: EngineCallbacks = {
    emit: (e) => {
      events.push(e);
    },
    speak: () => {},
    vetLine: async (t) => t,
  };
  return { cb, events };
}

function makeTrace() {
  const traced: Array<{ eventType: string; data?: Record<string, unknown> }> = [];
  const traceAICall: TraceAICall = async (opts) => {
    traced.push({ eventType: opts.eventType, data: opts.data });
    return opts.call();
  };
  return { traceAICall, traced };
}

describe('assembleProcessDirective (prescriptiveness as ONE dial + integrity rule)', () => {
  it('injects tight rope language and the verbatim integrity instruction', () => {
    const d = assembleProcessDirective(metricProcess);
    expect(d).toContain('HOW MUCH ROPE');
    expect(d).toContain('Follow the protocol beats closely'); // tight
    expect(d).toContain(INTEGRITY_RULE_INSTRUCTION);
    // The beats are rendered as a guide, not a verbatim line array.
    expect(d).toContain('THE BEATS');
  });

  it('injects mid (looser) rope language for a mid-prescriptiveness process', () => {
    const d = assembleProcessDirective(docProcess);
    expect(d).toContain('Follow the beats as a guide'); // mid
  });
});

describe('start(): provenance pin + started trace', () => {
  it('pins source/key/version and writes coaching_process_started', async () => {
    const { cb } = makeCallbacks();
    const { traceAICall, traced } = makeTrace();
    const pinned: unknown[] = [];
    const runner = new ProcessRunner(
      docProcess,
      cb,
      { traceAICall, pinProvenance: (p) => void pinned.push(p) },
      { memberId: 'm1', threadId: 't1' },
    );
    await runner.start();
    expect(pinned).toEqual([{ source: 'code', key: 'reflection_doc', version: 1 }]);
    expect(traced.map((t) => t.eventType)).toContain('coaching_process_started');
  });
});

describe('requestCompletion(): the ENGINE — not the AI — fires process_complete', () => {
  it('does NOT complete while the Goal is unmet (no process_complete event)', async () => {
    const { cb, events } = makeCallbacks();
    const { traceAICall, traced } = makeTrace();
    const runner = new ProcessRunner(metricProcess, cb, { traceAICall }, { memberId: 'm1', threadId: 't1' });
    const r = await runner.requestCompletion({ metricValue: 8 }); // 8 > 3
    expect(r.completed).toBe(false);
    expect(r.loop).toBe(true);
    expect(events.some((e) => e.type === 'process_complete')).toBe(false);
    expect(traced.map((t) => t.eventType)).not.toContain('coaching_process_completed');
  });

  it('completes ONLY when the Goal-gate is met → fires process_complete + completed trace', async () => {
    const { cb, events } = makeCallbacks();
    const { traceAICall, traced } = makeTrace();
    const runner = new ProcessRunner(metricProcess, cb, { traceAICall }, { memberId: 'm1', threadId: 't1' });
    const r = await runner.requestCompletion({ metricValue: 2 }); // 2 <= 3
    expect(r.completed).toBe(true);
    expect(events.some((e) => e.type === 'process_complete')).toBe(true);
    expect(traced.map((t) => t.eventType)).toContain('coaching_process_completed');
  });

  it('a doc-approved process does not complete until doc + approval', async () => {
    const { cb, events } = makeCallbacks();
    const { traceAICall } = makeTrace();
    const runner = new ProcessRunner(docProcess, cb, { traceAICall }, { memberId: 'm1', threadId: 't1' });
    expect((await runner.requestCompletion({ docProduced: true, memberApproved: false })).completed).toBe(false);
    expect((await runner.requestCompletion({ docProduced: true, memberApproved: true })).completed).toBe(true);
    expect(events.filter((e) => e.type === 'process_complete')).toHaveLength(1);
  });

  it('a member stop exits without completing (honored "stop")', async () => {
    const { cb, events } = makeCallbacks();
    const { traceAICall } = makeTrace();
    const runner = new ProcessRunner(metricProcess, cb, { traceAICall }, { memberId: 'm1', threadId: 't1' });
    const r = await runner.requestCompletion({ memberStopped: true, metricValue: 9 });
    expect(r.completed).toBe(false);
    expect(r.loop).toBe(false);
    expect(r.gate.reason).toBe('member_stopped');
    expect(events.some((e) => e.type === 'process_complete')).toBe(false);
  });
});

describe('AC-4: a source:"authored" definition runs identically to a source:"code" one', () => {
  it('assembles the SAME directive (source is not part of the directive)', () => {
    expect(assembleProcessDirective(authoredMetricProcess)).toBe(
      assembleProcessDirective(metricProcess),
    );
  });

  it('gates completion identically (same Goal-gate, no branch on source)', async () => {
    const { cb: cbA, events: evA } = makeCallbacks();
    const { cb: cbB, events: evB } = makeCallbacks();
    const { traceAICall } = makeTrace();
    const codeRunner = new ProcessRunner(metricProcess, cbA, { traceAICall }, { memberId: 'm1', threadId: 't1' });
    const authoredRunner = new ProcessRunner(authoredMetricProcess, cbB, { traceAICall }, { memberId: 'm1', threadId: 't1' });

    // Unmet → neither completes; both loop.
    const rA = await codeRunner.requestCompletion({ metricValue: 8 });
    const rB = await authoredRunner.requestCompletion({ metricValue: 8 });
    expect(rB).toEqual(rA);

    // Met → both complete + fire process_complete.
    const cA = await codeRunner.requestCompletion({ metricValue: 2 });
    const cB = await authoredRunner.requestCompletion({ metricValue: 2 });
    expect(cB.completed).toBe(cA.completed);
    expect(evB.some((e) => e.type === 'process_complete')).toBe(
      evA.some((e) => e.type === 'process_complete'),
    );
  });

  it('the only source-difference is the provenance record (source pinned verbatim)', async () => {
    const { cb } = makeCallbacks();
    const { traceAICall } = makeTrace();
    const pinned: Array<{ source: string }> = [];
    const runner = new ProcessRunner(
      authoredMetricProcess,
      cb,
      { traceAICall, pinProvenance: (p) => void pinned.push(p) },
      { memberId: 'm1', threadId: 't1' },
    );
    await runner.start();
    expect(pinned[0]?.source).toBe('authored');
  });
});

describe('runner drives the engine unchanged', () => {
  it('uses the injected EngineCallbacks; adds no new event types', async () => {
    const { cb, events } = makeCallbacks();
    const { traceAICall } = makeTrace();
    const runner = new ProcessRunner(metricProcess, cb, { traceAICall }, { memberId: 'm1', threadId: 't1' });
    await runner.interactionEngine.deliverLine({ text: 'Even though I feel this, I accept myself.', mode: 'call_response' });
    const known = new Set(['interaction_mode', 'awaiting_response', 'step_advanced', 'process_complete']);
    expect(events.every((e) => known.has(e.type))).toBe(true);
  });
});
