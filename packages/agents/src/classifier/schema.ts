import { z } from 'zod';

/**
 * The classifier output contract — the routing JSON the supervisor classifier
 * (fast slot) emits per turn. The orchestrator consumes this shape.
 *
 * DE-ENUM (ADR-002 / 002a FR-4): `target` and `archetype_lean` are OPAQUE
 * tenant-config strings, never TS enums naming coach concepts. A `target` is a
 * coaching-process or utility-agent KEY the tenant defined (validated for existence
 * downstream by the orchestrator/dispatcher, not here). `archetype_lean` are opaque
 * archetype keys (internal voice-coloring; never echoed to the member).
 *
 * The platform-mechanic sets STAY closed: `CLASSIFIER_ACTIONS` (the routing state
 * machine) and `DETECTED_STATES` (the emotional-state taxonomy).
 */

/** The six routing actions the classifier may emit (platform mechanic). */
export const CLASSIFIER_ACTIONS = [
  'respond',
  'respond_and_offer_process',
  'respond_and_offer_utility',
  'respond_and_flag_review',
  'respond_and_offer_library',
  'respond_and_defer_to_self',
] as const;

/** The 9 `signal_kind` states — the platform emotional-state taxonomy. */
export const DETECTED_STATES = [
  'overwhelmed',
  'frozen',
  'dysregulated',
  'avoidant',
  'burned_out',
  'disconnected',
  'aligned',
  'focused',
  'energized',
] as const;

export const ClassifierOutput = z.object({
  action: z.enum(CLASSIFIER_ACTIONS),
  // Accept BOTH an absent field and an explicit JSON `null` — a fast-slot model
  // routinely emits `"target": null` for "no target" rather than omitting the key,
  // and `.optional()` alone rejects null (forcing the `respond` fallback and
  // corrupting routing). `.nullish()` accepts undefined|null; we normalize null ->
  // undefined so every downstream consumer sees the same `string | undefined` shape.
  //
  // DE-ENUM: `target` is an OPAQUE process/utility KEY (tenant config), not a closed
  // enum — the classifier cannot know a tenant's process set at parse time. Existence
  // is validated downstream (the orchestrator only offers a key the tenant defines).
  target: z
    .string()
    .min(1)
    .nullish()
    .transform((v) => v ?? undefined),
  // DE-ENUM: opaque archetype keys (internal voice-coloring only).
  archetype_lean: z.array(z.string().min(1)).default([]),
  detected_state: z.enum(DETECTED_STATES),
  search_terms: z
    .array(z.string())
    .nullish()
    .transform((v) => v ?? undefined),
  reasoning: z.string().max(500),
});

export type ClassifierOutput = z.infer<typeof ClassifierOutput>;

export type ClassifierAction = (typeof CLASSIFIER_ACTIONS)[number];
/** An opaque tenant-defined process/utility key the classifier routed to. */
export type ClassifierTarget = string;
export type DetectedState = (typeof DETECTED_STATES)[number];

/**
 * One turn of the working-memory window the orchestrator passes in. `role` is the
 * speaker; `content` is the verbatim text.
 */
export interface ConversationTurn {
  role: 'member' | 'assistant';
  content: string;
}

/**
 * Optional member context the orchestrator injects: the member's archetype and any
 * recent-state hint. Framed as DATA to be classified, never instructions.
 */
export interface ClassifierMemberContext {
  archetype?: string | null;
  recentState?: DetectedState | null;
}
