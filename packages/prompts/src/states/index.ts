/**
 * Per-state response fragments — one per the 9 `signal_kind` states. Each fragment
 * SHAPES the response; the orchestrator merges the fragment for `detected_state` into
 * the persona layer at assembly time.
 *
 * These are runtime fragments (not human-edited prompt blocks), so they live in git and
 * are NOT individually `recordPromptVersion`-tracked. They are platform emotional-state
 * guidance — generic, not coach-specific.
 */

/**
 * The 9 `signal_kind` states. CANONICAL source is the classifier schema (`@ciyp/agents`
 * `DETECTED_STATES`); mirrored here so `@ciyp/prompts` stays free of a cross-package
 * import. The two must not drift.
 */
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

export type DetectedState = (typeof DETECTED_STATES)[number];

export type StateFragments = Record<DetectedState, string>;

export const STATE_FRAGMENTS: StateFragments = {
  overwhelmed:
    'Simplify. One thing at a time. Ask "what is the smallest next thing?" Do not stack options or add to the load.',
  frozen:
    'Very short. Somatic grounding first ("place your feet on the floor"). Simple, concrete instructions. No "what do you think" abstractions yet.',
  dysregulated:
    'Breath cue first, question second. No information dumps. Help the nervous system settle before anything cognitive.',
  avoidant:
    'Gently name what is being avoided. No shame. Frame it as information: "what if this is information, not a verdict?"',
  burned_out:
    'Give permission to rest. No productivity language. "You do not have to do anything right now." Protect, do not push.',
  disconnected:
    'Sensory grounding. "What is true in your body right now?" Reconnect to the present moment before meaning-making.',
  aligned:
    'Light reinforcement, no over-cheering. Reflect the alignment back and suggest the next-level move.',
  focused:
    'Stay out of the way. Brief, sharpening reflections. Offer the one question that deepens the focus.',
  energized:
    'Match the energy without inflating it. Channel momentum toward a concrete next step; suggest the next-level move.',
};

/** Look up the response-shaping fragment for a detected state. */
export function stateFragment(state: DetectedState): string {
  return STATE_FRAGMENTS[state];
}
