/**
 * Plan-document NARRATIVE directive. The ONLY model-authored span in the plan-document
 * deliverable — a short framing intro + closing around the deterministic structured body
 * (rendered VERBATIM from the plan data, never by a model). Coaching content stays in
 * `@ciyp/agents` (the version-coupling guardrail).
 *
 * The structured plan data (outcomes / commitments / check-in questions / focus / period)
 * is NEVER produced here — it is emitted 1:1 from the data by `renderStructuredSections`
 * so the deterministic fidelity eval can assert exact presence and zero fabrication. The
 * narrative carries the standing anti-sycophancy block (no shame, no hype, no false
 * praise) and is itself guarded UP-FRONT through the guard chain before assembly.
 *
 * Voice-agnostic: the directive references "the member's own coaching voice", never a
 * coach-named persona. The per-tenant voice is composed by the runtime around this block.
 */

/**
 * The system directive a model leg uses to author the {intro, closing} narrative for a
 * member's plan document. The producing leg composes this with the rendered structured
 * body as context; the result is guarded through the guard chain.
 *
 * Free of member PII — names/ids are tokenized by the producing leg's minimizer before any
 * provider call.
 */
export const PLAN_DOCUMENT_NARRATIVE_DIRECTIVE = [
  'You are writing the framing voice around a member’s own plan, in the coaching voice.',
  'You are given the member’s plan (their focus, outcomes, daily commitments, and check-in questions).',
  '',
  'Write exactly two short spans:',
  '  1. an INTRO (2–4 sentences) that frames the plan as the member’s own committed direction, and',
  '  2. a CLOSING (1–3 sentences) that returns agency to the member and invites the next aligned step.',
  '',
  'Hard rules:',
  '  - Do NOT restate, summarize, re-list, invent, or alter any outcome, commitment, or question —',
  '    the plan body is rendered verbatim elsewhere. Your spans are framing ONLY.',
  '  - No shame, no pressure, no fear of "falling behind", no hype, no false praise, no flattery.',
  '  - Steady, warm, grounded. Speak to the person, not at them. Never name an internal archetype.',
  '  - No emojis, no exclamation-point inflation, no "I’m so proud of you" sycophancy.',
].join('\n');

/**
 * The deterministic, voice-safe FALLBACK narrative — used when no model narrative is
 * available (key-free / offline / a degraded narrative leg). It fabricates NO plan data (so
 * the fidelity check is unaffected) and is calm + agency-returning by construction, so the
 * deliverable is always renderable without a model round-trip.
 */
export const PLAN_DOCUMENT_FALLBACK_NARRATIVE: { intro: string; closing: string } = {
  intro:
    'This is your plan — the direction you chose for the next stretch. ' +
    'There is nothing to fall behind on here; it is a record of what matters to you and the small ' +
    'steps that move you toward it.',
  closing:
    'Come back to this whenever you need to reorient. The next aligned step is enough.',
};
