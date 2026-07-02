/**
 * The coaching-process substrate — the code-first (and authored) process layer on the
 * interaction engine. Barrel for the substrate: types, the deterministic Goal-gate, and
 * the ProcessRunner.
 *
 * DE-ENUM: no flagship coach processes port here — a tenant's processes are authored as
 * `CodeProcessDefinition` data (`source: 'code' | 'authored'`), provided by the seed /
 * tenant config, never as coach-named modules in this package.
 *
 * Re-exports avoid the `InteractionMode` name (already exported via `orchestrator/tools`
 * + `interaction-engine` at the package root).
 */

// Substrate types + constants (NOT re-exporting InteractionMode — root already does).
export type {
  CoachingAgentKind,
  OutputType,
  Prescriptiveness,
  ProcessSource,
  ProcessGoal,
  ModeArcStep,
  PinnedLine,
  CodeProcessDefinition,
} from './types.js';
export { INTEGRITY_RULE_INSTRUCTION, toDbOutputType } from './types.js';

// The deterministic Goal-gate evaluator (the integrity rule, executable).
export {
  evaluateGoal,
  shouldLoop,
  LOOP_GUARD_LIMIT,
} from './goal-gate.js';
export type { ProcessRunState, GoalGateResult, GoalGateDeps } from './goal-gate.js';

// The ProcessRunner — drives a definition on the engine unchanged.
export {
  ProcessRunner,
  assembleProcessDirective,
} from './process-runner.js';
export type {
  ProcessProvenance,
  ProcessRunnerDeps,
  RequestCompletionResult,
} from './process-runner.js';
