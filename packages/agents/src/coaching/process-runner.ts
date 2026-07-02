/**
 * The `ProcessRunner` — drives a `CodeProcessDefinition` on the interaction engine
 * UNCHANGED. It supplies the directive + `mode_arc` + Goal; the AI generates the lines
 * live; the engine applies per-mode turn-taking and emits the custom UI-sync events. The
 * runner adds NO new engine, NO new mode set, NO new event types.
 *
 * What the runner OWNS:
 *   1. Directive assembly — injects the prescriptiveness "how much rope" language and the
 *      verbatim integrity-rule instruction into the process directive.
 *   2. The completion authority — the SINGLE place `engine.complete()` is called, and
 *      ONLY after the deterministic Goal-gate returns `met`. This is the structural
 *      enforcement of the integrity rule.
 *   3. Provenance + tracing — pins `source`/`key`/`version` (via the injected
 *      `pinProvenance`), and brackets the run with `coaching_process_started` /
 *      `coaching_process_completed` traces.
 *
 * A `source: 'authored'` definition runs IDENTICALLY to a `source: 'code'` one — the
 * runner never branches on source except to record provenance.
 *
 * Purity: every side effect (trace, provenance pin, the engine callbacks, the AI
 * verifier) is INJECTED. No runtime import.
 */
import { InteractionEngine } from '../interaction-engine/index.js';
import type { EngineCallbacks } from '../interaction-engine/index.js';
import type { TraceAICall } from '../llm/types.js';
import { evaluateGoal, shouldLoop } from './goal-gate.js';
import type { GoalGateDeps, GoalGateResult, ProcessRunState } from './goal-gate.js';
import {
  INTEGRITY_RULE_INSTRUCTION,
  type CodeProcessDefinition,
  type Prescriptiveness,
  type ProcessSource,
} from './types.js';

/** The "how much rope" language injected per prescriptiveness value (one dial). */
const PRESCRIPTIVENESS_LANGUAGE: Record<Prescriptiveness, string> = {
  tight:
    'Follow the protocol beats closely and in order. This is a real method; do not skip or improvise the core mechanics. You may adjust pacing and wording, but keep the structure.',
  mid: 'Follow the beats as a guide. You may reorder, dwell, or soften to follow the member, as long as the work still lands.',
  loose:
    'Hold the beats lightly. Depart freely to follow the member wherever they need to go; the structure is a backdrop, not a track.',
};

/**
 * Assemble the process directive fragment (a cascade layer). Combines the definition's
 * directive, the prescriptiveness "how much rope" language, and the verbatim
 * integrity-rule instruction. A PURE string build; the runtime composes it with the
 * platform/tenant/coach cascade layers.
 */
export function assembleProcessDirective(
  definition: Pick<CodeProcessDefinition, 'directive' | 'prescriptiveness' | 'mode_arc'>,
): string {
  const arc = definition.mode_arc
    .map((s, i) => `  ${i + 1}. [${s.mode}] ${s.intent}${s.loops ? ' (this beat may repeat until the goal is met)' : ''}`)
    .join('\n');

  return [
    definition.directive.trim(),
    '',
    `HOW MUCH ROPE: ${PRESCRIPTIVENESS_LANGUAGE[definition.prescriptiveness]}`,
    '',
    'THE BEATS (a guide, not a script — you generate every line live):',
    arc,
    '',
    `INTEGRITY: ${INTEGRITY_RULE_INSTRUCTION}`,
  ].join('\n');
}

/** Provenance pinned for traces. Carries the definition's source (`code`/`authored`). */
export interface ProcessProvenance {
  source: ProcessSource;
  key: string;
  version: number;
}

export interface ProcessRunnerDeps {
  /** The trace wrapper (brackets the run). */
  traceAICall: TraceAICall;
  /**
   * Pin the process provenance (the runtime supplies the DB write; the runner just hands
   * it the provenance object). Optional — when absent the runner only traces.
   */
  pinProvenance?: (provenance: ProcessProvenance) => void | Promise<void>;
  /** The Goal-gate dependencies (e.g. the injected ai-verified verifier). */
  goalGate?: GoalGateDeps;
}

export interface RequestCompletionResult {
  /** Whether the engine fired `process_complete` (only when the Goal was met). */
  completed: boolean;
  /** Whether the engine should loop (re-enter the loop body beat). */
  loop: boolean;
  /** The Goal-gate decision that drove the outcome. */
  gate: GoalGateResult;
}

/**
 * Drives a `CodeProcessDefinition` on the `InteractionEngine`. Construct one per process
 * run with the engine callbacks + the definition + the runner deps.
 */
export class ProcessRunner<TOutput = unknown> {
  private readonly engine: InteractionEngine;

  constructor(
    private readonly definition: CodeProcessDefinition<TOutput>,
    callbacks: EngineCallbacks,
    private readonly deps: ProcessRunnerDeps,
    private readonly ctx: { memberId: string; threadId: string },
  ) {
    // Drives the engine UNCHANGED — same callbacks, no new modes/events.
    this.engine = new InteractionEngine(callbacks);
  }

  /** The assembled directive (prescriptiveness + integrity rule injected). */
  get directive(): string {
    return assembleProcessDirective(this.definition);
  }

  /** Expose the underlying engine (the runtime delivers AI lines through it). */
  get interactionEngine(): InteractionEngine {
    return this.engine;
  }

  /**
   * Start the run: pin provenance and write the `coaching_process_started` trace. Call
   * once after `process_offer` acceptance creates the bounded thread. Provenance carries
   * the definition's `source` verbatim (`code` OR `authored`).
   */
  async start(): Promise<void> {
    const provenance: ProcessProvenance = {
      source: this.definition.source,
      key: this.definition.key,
      version: this.definition.version,
    };
    if (this.deps.pinProvenance) await this.deps.pinProvenance(provenance);

    await this.deps.traceAICall<void>({
      eventType: 'coaching_process_started',
      memberId: this.ctx.memberId,
      threadId: this.ctx.threadId,
      data: { key: this.definition.key, agent_kind: this.definition.agent_kind, source: this.definition.source },
      call: async () => undefined,
    });
  }

  /**
   * The AI requests advance-past-Goal (completion). The runner consults the deterministic
   * Goal-gate; the ENGINE — never the AI — fires `process_complete`, and ONLY when the
   * gate returns `met`. This is the structural integrity rule.
   *
   * Returns whether it completed and/or should loop, plus the gate decision.
   */
  async requestCompletion(runState: ProcessRunState): Promise<RequestCompletionResult> {
    const gate = await evaluateGoal(this.definition, runState, this.deps.goalGate);

    if (gate.met) {
      await this.engine.complete();
      await this.deps.traceAICall<void>({
        eventType: 'coaching_process_completed',
        memberId: this.ctx.memberId,
        threadId: this.ctx.threadId,
        data: { key: this.definition.key, reason: gate.reason },
        call: async () => undefined,
      });
      return { completed: true, loop: false, gate };
    }

    return { completed: false, loop: shouldLoop(gate), gate };
  }
}
