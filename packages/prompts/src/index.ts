/**
 * @ciyp/prompts — the prompt composition machinery + versioned cascade blocks.
 *
 * ZERO runtime dependencies (pure content/composition — enforced by
 * scripts/dependency-lint.mjs). ZERO coach IP: every content surface is either
 * platform-generic (the voice/retention/no-shame/language-signal/classifier blocks + the
 * 9-state fragments) or ships as an EMPTY, backfillable placeholder (archetype voices,
 * question bank, quote corpus). Tenant content lands via the seed / provisioning (ADR-002).
 */

// Archetype voices — the single registered-name source for the voice linter (ships empty).
export * from './archetype-voices/index.js';

// Per-state response fragments (the 9-state taxonomy).
export * from './states/index.js';

// Coaching-question bank + quote corpus + the stage-aware daily selector (ship empty).
export * from './questions/index.js';
export * from './questions/select.js';
export * from './quotes/index.js';

// Cascade blocks.
export * from './voice-rules.js';
export * from './retention.js';
export * from './orchestrator.js';
export * from './classifier.js';
export * from './no-shame-prompt.js';
export * from './doc-distill-prompt.js';
export * from './language-signal.js';

// Prompt-version baseline registry.
export * from './baselines.js';
