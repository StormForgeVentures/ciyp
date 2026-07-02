/**
 * The archetype-voice registry — the SINGLE source of registered archetype names.
 *
 * The voice linter (`@ciyp/agents` `voiceLinter`) sources its archetype-name-leak block
 * list from `archetypeNames()` here. This is MACHINERY ONLY: the registry ships EMPTY.
 * Real archetypes are per-tenant content (ADR-002) — the seed / provisioning backfills
 * `ALL_ARCHETYPE_VOICES` (or the runtime hydrates it from tenant config) with zero code
 * change. No coach archetype content ships in this package.
 *
 * Empty registry ⇒ `archetypeNames()` returns `[]` ⇒ the voice linter blocks nothing until
 * a tenant registers archetypes. The mechanic is fully generic; the content is injected.
 */

import type { ArchetypeVoice } from './types.js';

export type { ArchetypeVoice } from './types.js';

/**
 * Every registered archetype voice. SHIPS EMPTY — tenant archetypes land here via the seed
 * / provisioning (backfillable content, not engine logic).
 */
export const ALL_ARCHETYPE_VOICES: readonly ArchetypeVoice[] = [];

/** Lookup by classifier `archetype_lean` id. */
export function archetypeVoiceById(id: string): ArchetypeVoice | undefined {
  return ALL_ARCHETYPE_VOICES.find((a) => a.id === id);
}

/**
 * The canonical archetype-name strings the voice linter blocks from user-facing output. The
 * single registered-name source. Empty until a tenant registers archetypes.
 */
export function archetypeNames(): string[] {
  return ALL_ARCHETYPE_VOICES.map((a) => a.name);
}

/** True while no archetype content has been registered (the shipped default). */
export function archetypesArePlaceholder(): boolean {
  return ALL_ARCHETYPE_VOICES.length === 0;
}
