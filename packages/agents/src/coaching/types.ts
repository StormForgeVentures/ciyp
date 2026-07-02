/**
 * The code-first coaching-process substrate types.
 *
 * A `CodeProcessDefinition` is the IN-CODE ANALOG of a `coaching_process_definitions`
 * row: it carries the same `directive` / `goal` / `output_type` / `mode_arc` /
 * `prescriptiveness` / `source` fields the authored path reads from a DB row — so a
 * process can GRADUATE code → authored against the same schema (`source` is the seam).
 * v1 may ship processes as TypeScript constants (`source: 'code'`); the seed/tenant may
 * author processes (`source: 'authored'`) — the runner treats both identically.
 *
 * THE MODEL — three layers with opposite determinism needs:
 *   - Steps  (deterministic) — the `mode_arc`: the ordered beats. The engine holds one
 *             step/mode at a time.
 *   - Goal   (stable)        — `output_type` + `goal`. Evaluated by the deterministic
 *             Goal-gate evaluator (`goal-gate.ts`), NEVER by the AI.
 *   - Words+Focus (free)     — every member-facing line is AI-generated live and passes
 *             the cascade + linter chain.
 *
 * THE INTEGRITY RULE (non-negotiable): the AI may deviate, modify, or exit — but it may
 * NOT claim the process is complete unless the Goal is genuinely met.
 *
 * DE-ENUM: `agent_kind` is an OPAQUE tenant-config string (a coaching persona key),
 * never a closed enum naming coach concepts. The metric-threshold goal's `metric` is
 * an opaque metric key.
 *
 * Purity: this module is types + constants only — no I/O, no LLM, web-portable.
 */
import type { CoachingProcessSource } from '@stormforgeventures/ciyp-shared';
import type { InteractionMode } from '../orchestrator/tools.js';
import type { ZodType } from 'zod';

export type { InteractionMode } from '../orchestrator/tools.js';

/**
 * The persona a coaching process runs under. DE-ENUM: an OPAQUE tenant-config key (the
 * `chat_threads.agent_kind`), never a closed union naming coach concepts.
 */
export type CoachingAgentKind = string;

/**
 * The closed `output_type` set (the per-process completion-marker kind — a platform
 * mechanic). Hyphenated at the TS layer; the DB enum uses underscores — `toDbOutputType()`
 * maps between them.
 */
export type OutputType = 'metric-threshold' | 'doc-approved' | 'ai-verified' | 'none';

/** The single prescriptiveness dial — one value per process, NOT a per-step rule. */
export type Prescriptiveness = 'tight' | 'mid' | 'loose';

/** The `source` seam: `code` = hand-built; `authored` = tenant/DB-row. */
export type ProcessSource = CoachingProcessSource;

/**
 * The Goal-as-data, shaped per `output_type` (a discriminated union). The Goal-gate
 * evaluator branches on this. NOTE: this is NOT a runtime loop counter — a metric loop is
 * goal-gated (engine re-entry while the metric is unmet), never counter-gated.
 */
export type ProcessGoal =
  | {
      kind: 'metric-threshold';
      /** DE-ENUM: an opaque captured-metric key the gate compares (tenant config). */
      metric: string;
      comparator: '<=' | '>=' | '<' | '>' | '==';
      threshold: number;
      /** How the metric is obtained — member-reported in v1. */
      measured_by: 'member_reported';
    }
  | {
      kind: 'doc-approved';
      requires_doc: true;
      requires_member_approval: true;
    }
  | {
      kind: 'ai-verified';
      /** A natural-language description of what the verifier must judge met. */
      criterion: string;
    }
  | { kind: 'none' };

/** A rough ordered interaction-mode phase (the "Steps"; the engine holds one). */
export interface ModeArcStep {
  /** A short internal label for the beat. */
  id: string;
  /** The interaction mode this beat runs in. */
  mode: InteractionMode;
  /** A one-line intent the directive expands (NOT a verbatim line). */
  intent: string;
  /** True when this beat is the loop body the Goal re-enters. */
  loops?: boolean;
}

/** An exact-wording, linter-bypassed line (a mantra / precise instruction). */
export interface PinnedLine {
  id: string;
  text: string;
  mode: InteractionMode;
}

/**
 * The in-code analog of a `coaching_process_definitions` row. The ProcessRunner drives
 * this on the interaction engine unchanged.
 */
export interface CodeProcessDefinition<TOutput = unknown> {
  /** Stable process key (opaque tenant string). */
  key: string;
  /** Member-facing title. */
  title: string;
  /**
   * The high-level directive (a cascade layer) the AI follows: scope, tone, scoring
   * rules, safety route, and the verbatim integrity-rule instruction. NOT a verbatim
   * per-line script.
   */
  directive: string;
  /** The per-process completion marker (the Goal kind). */
  output_type: OutputType;
  /** The Goal-as-data the Goal-gate evaluates. `output_type` and `goal.kind` match. */
  goal: ProcessGoal;
  /** The ordered beats (Steps). The engine holds one at a time. */
  mode_arc: ModeArcStep[];
  /** Optional exact-wording lines read verbatim + linter-bypassed (admin-vetted). */
  pinned_lines?: PinnedLine[];
  /** The single prescriptiveness dial. */
  prescriptiveness: Prescriptiveness;
  /** The persona this process runs under (opaque tenant `agent_kind`). */
  agent_kind: CoachingAgentKind;
  /**
   * The graduation seam. `'code'` for hand-built processes, `'authored'` for
   * tenant/DB-authored ones — the runner runs both identically (no branch on source
   * except provenance).
   */
  source: ProcessSource;
  /** Definition version pinned into provenance. */
  version: number;
  /** The Zod schema validating this process's structured output (if any). */
  outputSchema?: ZodType<TOutput>;
}

/**
 * The verbatim integrity-rule instruction. EVERY process directive includes this line
 * — the one non-negotiable. The runner also enforces it structurally (only the
 * Goal-gate can authorize `engine.complete()`).
 */
export const INTEGRITY_RULE_INSTRUCTION =
  'You may adapt freely, but you may not claim or imply the process is complete unless the goal is genuinely met.';

/**
 * Map the hyphenated TS `OutputType` to the underscored DB enum value
 * (`coaching_process_output_type`). The substrate ships all four.
 */
export function toDbOutputType(
  t: OutputType,
): 'metric_threshold' | 'doc_approved' | 'ai_verified' | 'none' {
  switch (t) {
    case 'metric-threshold':
      return 'metric_threshold';
    case 'doc-approved':
      return 'doc_approved';
    case 'ai-verified':
      return 'ai_verified';
    case 'none':
      return 'none';
  }
}
