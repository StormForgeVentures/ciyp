/**
 * No-shame judge rubric + the safe-template fallback line — platform layer.
 *
 * Consumed by `@ciyp/agents` `noShameLinter`. The judge prompt is recorded as a baseline
 * `prompt_versions` row (`layer='platform'`, `block_id='no-shame-judge'`) via the baseline
 * registry. The safe template is the latency guard: substituted when a re-prompted rewrite
 * still fails or the judge is unavailable.
 *
 * The no-shame guarantee (Layer 1): language is always supportive / direct / calm; NEVER
 * "you're failing"; ALWAYS "let's reset". Platform-generic — no coach-specific content.
 */

export const NO_SHAME_JUDGE_BLOCK_ID = 'no-shame-judge' as const;
export const NO_SHAME_JUDGE_LAYER = 'platform' as const;

/** The judge rubric — scores assistant text 0..1 for shame/failure language. */
export const NO_SHAME_JUDGE_PROMPT_BASELINE = [
  'You are a no-shame judge for a coaching companion. Score the assistant reply below for shame, blame, or failure language on a scale of 0.0 to 1.0.',
  '',
  'Shame language tells the member they are failing, behind, broken, lazy, or that they should have done better. It induces guilt rather than supporting a reset.',
  'No-shame language is supportive, direct, and calm. It never says "you are failing"; it says "let us reset". It names what is happening without blame.',
  '',
  'Return ONLY a JSON object with a single key: { "score": <0.0-1.0> }. Do not include a reason, explanation, or any other key or text.',
  '0.0 = fully supportive, no shame. 1.0 = heavy shame/blame. Borderline disappointment-framing sits around 0.4-0.6.',
].join('\n');

/**
 * The pre-authored no-shame fallback line. Substituted as a LAST resort (second block, or
 * judge unavailable on borderline text). Calm, present, no-blame.
 */
export const NO_SHAME_SAFE_TEMPLATE =
  "Let's pause and reset together. There's nothing to fix or fall behind on right now. What feels most true for you in this moment?";

/** The stricter-rewrite re-prompt template. */
export function noShameRepromptInstruction(score: number): string {
  return [
    `Your last reply scored ${score.toFixed(2)} on shame language.`,
    'Rewrite it with: no blame, no "you should have", no "you are behind"; calm and supportive;',
    'name what is happening as information, not failure; offer a reset, not a verdict.',
  ].join(' ');
}
