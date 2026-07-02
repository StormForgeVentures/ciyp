/**
 * @ciyp/shared — the published surface (contract 06).
 * Consumed by ciyp-template (exact-pinned from the private registry) and by this engine
 * (workspace:*). The UI imports ONLY this package + @ciyp/ui-tokens — never agents/prompts.
 */

// Contract schemas + inferred types (contracts 01–06)
export * from './contracts/index.js';

// Shared generic enums (platform mechanics — ADR-002 "stay" list)
export * from './enums.js';

// Type guards / helpers the UI needs to render parts safely
export * from './guards.js';
