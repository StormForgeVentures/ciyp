/**
 * Local mirror of the runtime `ModelSlot` union (the Sport slot taxonomy — 002c
 * resolves it live per tenant). Mirrored — not imported — because `@ciyp/agents`
 * is the pure brain that must not depend on the runtime (`apps/api`) or the Sport
 * assembly layer. The injected `getModelSlot` (002b/002c) resolves this same union.
 */
export type ModelSlot = 'chat' | 'fast' | 'vision' | 'embedding' | 'rerank' | 'stt' | 'tts';
