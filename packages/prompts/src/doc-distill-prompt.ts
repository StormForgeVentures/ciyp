/**
 * Member-doc → AI memory distillation prompts — platform layer.
 *
 * Two `fast`-slot extractors, both recorded as baseline `prompt_versions` rows (the
 * faithfulness eval over these is a downstream obligation — "no eval, no ship").
 *
 * FAITHFULNESS is the hard gate: every distilled claim must be ENTAILED by the source
 * doc. The prompts forbid inference/extrapolation and demand the member's own framing.
 * NO-SHAME is enforced separately by the linter on every output before write; the prompts
 * also instruct supportive, non-evaluative language as the first line of defense.
 *
 * Platform-generic — the doc KINDS are opaque tenant taxonomy; these prompts describe the
 * extraction shape, never coach-specific document types.
 */

export const DOC_DISTILL_ESSENCE_BLOCK_ID = 'doc-distill-essence' as const;
export const DOC_DISTILL_INSIGHTS_BLOCK_ID = 'doc-distill-insights' as const;
export const DOC_DISTILL_LAYER = 'platform' as const;

/**
 * Core-pin essence extractor for a member-written identity document. Produces ONE durable
 * identity-anchor sentence (≤500 chars) the AI carries as `durable`-tier memory.
 */
export const DOC_DISTILL_ESSENCE_PROMPT_BASELINE = [
  'You distill a member-written identity document into ONE short, durable memory anchor for a coaching companion.',
  '',
  'The anchor captures the essence of who this member is becoming / what they most value — in their OWN framing, as a stable identity reference the coach can hold over time.',
  '',
  'Rules:',
  '- FAITHFUL: state only what the document actually says. Never infer, embellish, or add a claim not present in the text. If the document is thin, say less.',
  '- The anchor is one sentence, at most 500 characters, written as a calm third-person statement of the member\'s vision/values (e.g. "Sees themselves as a present, steady leader who leads from calm.").',
  '- SUPPORTIVE + NON-EVALUATIVE: never judgment, never failure/shame framing, never "should". Name the aspiration as information, not a verdict.',
  '- Return ONLY the anchor sentence as plain text — no quotes, no preamble, no JSON.',
].join('\n');

/**
 * Process-output insight extractor. Produces a JSON array of AT MOST 2 salient
 * insight-facts (each ≤500 chars) the AI carries as `contextual`-tier memory, keyed by the
 * originating output's id.
 */
export const DOC_DISTILL_INSIGHTS_PROMPT_BASELINE = [
  'You distill the output of a completed coaching process into AT MOST 2 salient, durable insight-facts for a coaching companion to remember about this member.',
  '',
  'Each fact is one specific, memorable insight or commitment the member surfaced — useful to recall in a future conversation.',
  '',
  'Rules:',
  '- FAITHFUL: extract only what the output actually contains. Never infer, generalize beyond the text, or invent a claim. Fewer faithful facts beat more invented ones — return 0, 1, or 2.',
  '- Each fact is at most 500 characters, written as a calm third-person statement (e.g. "Identified that rushing mornings drives their afternoon anxiety.").',
  '- SUPPORTIVE + NON-EVALUATIVE: information, never failure/shame framing, never "should".',
  '- Return ONLY a JSON array of strings, e.g. ["fact one", "fact two"]. At most 2 elements. An empty array [] is valid when nothing durable stands out.',
].join('\n');
