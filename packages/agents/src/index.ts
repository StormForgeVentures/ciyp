/**
 * @ciyp/agents — THE PURE BRAIN. Provider-agnostic, coach-agnostic AI agents extracted
 * and generalized from the donor engine (instance #1).
 *
 * PURITY RULE (enforced by scripts/dependency-lint.mjs, ADR-006):
 * runtime dependencies are EXACTLY @stormforgeventures/ciyp-shared + zod. No provider
 * SDK, no Supabase, no Sport runtime, no network. All LLM/DB access arrives via the
 * injected AgentSubstrate; all tenant content (archetypes, processes, prompts, doc kinds)
 * arrives as opaque config — never as coach-named literals in this package.
 */

// The injectable LLM / substrate boundary + the ModelSlot mirror.
export * from './substrate.js';
export * from './llm/types.js';

// Classifier + continuous language-signal scan.
export * from './classifier/index.js';
export * from './classifier/language-signal.js';

// The canonical linter chain.
export * from './linters/index.js';

// Orchestrator: the ToolDispatcher + the transport-agnostic turn callable + the
// deterministic member-doc-reference cue detector.
export * from './orchestrator/tools.js';
export * from './orchestrator/run.js';
export * from './orchestrator/doc-reference.js';

// Utility agents (breathwork_pacer + alignment_prompt).
export * from './utility/index.js';

// The mode-driven interaction engine.
export * from './interaction-engine/index.js';

// Bounded-thread cadence agent (generic machinery; daily / weekly / monthly_review).
export * from './cadence/index.js';

// Coaching-process substrate (CodeProcessDefinition + ProcessRunner + Goal-gate).
export * from './coaching/index.js';

// Artifacts (the deterministic plan-document renderer + fidelity check).
export * from './artifacts/index.js';
