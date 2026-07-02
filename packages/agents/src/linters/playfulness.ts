/**
 * playfulnessLinter — gates lightness (winks / aphorisms / jokes) by state and
 * frequency. SYNCHRONOUS, pure over text (no LLM, no store).
 *
 * Rules:
 *   - State-gate: lightness ONLY when `detectedState ∈ {aligned, focused, energized,
 *     avoidant}`. In distress states (overwhelmed, frozen, dysregulated, burned_out,
 *     disconnected) any wink/quote/joke is BLOCKED. NEVER in distress.
 *   - Frequency cap: when injected `winkCount` is at/over the cap (~1 per 10 turns),
 *     block even in an eligible state. `winkCount` is INJECTED — a pure param.
 *   - Archetype-widening: a configured "lightness-widening" archetype lean widens
 *     lightness tolerance by 1 but NEVER overrides the state-gate or the frequency-cap.
 *     WHICH lean widens is per-tenant config (`lightnessWideningLeans`), never a
 *     coach-named literal.
 *   - On a deployed wink, the CALLER increments the counter + writes a `wink_deployed`
 *     trace (contract documented).
 *   - On block, returns a `playfulness` block + the re-prompt-without-the-joke
 *     instruction. The CALLER owns the re-prompt loop.
 *
 * "Lightness present in the text" is detected heuristically, so when no lightness
 * markers are present the text PASSES untouched — the linter only fires when it sees
 * a wink/quote/joke.
 */

import type { LinterResult, LinterBlock, DetectedState } from './types.js';

/** States where lightness is permitted. */
const LIGHTNESS_ELIGIBLE: ReadonlySet<DetectedState> = new Set<DetectedState>([
  'aligned',
  'focused',
  'energized',
  'avoidant',
]);

/** Default frequency cap — ~1 wink per 10-turn window. */
const DEFAULT_WINK_CAP = 1;

/**
 * Heuristic lightness markers: emoji winks, "just kidding"/"lol", quotation-marked
 * aphorisms, playful hedges. Intentionally a SIGNAL detector — the orchestrator's
 * prompt produces the wink; the linter gates whether it is allowed to stand.
 */
const LIGHTNESS_RE =
  /(\bwink\b|;\)|😉|😄|😂|🙃|\blol\b|\bjust kidding\b|\bjk\b|as above,? so below|\bhaha\b)/i;

export interface PlayfulnessOpts {
  detectedState: DetectedState;
  /** Injected wink count for the thread; pure param here. */
  winkCount: number;
  /** Opaque archetype-lean keys active this turn (tenant config). */
  archetypeLean?: string[];
  /** The frequency cap (default 1 per window). */
  winkCap?: number;
  /**
   * Opaque archetype-lean keys that widen the lightness cap by 1 (tenant config).
   * When any active lean is in this set, the effective cap is `cap + 1` — but the
   * state-gate and the cap itself are NEVER removed.
   */
  lightnessWideningLeans?: string[];
}

function block(reason: string, traceData: Record<string, unknown>): LinterBlock {
  return {
    kind: 'playfulness',
    linter: 'playfulness',
    hard: false,
    repromptInstruction:
      'Your last reply included lightness (a wink, joke, or quote) that does not fit this moment. Rewrite it sincerely, without the joke or quote.',
    traceData: { kind: 'playfulness', reason, ...traceData },
  };
}

/** Detect whether the text carries lightness. Exposed for the chain + tests. */
export function hasLightness(text: string): boolean {
  return LIGHTNESS_RE.test(text);
}

/**
 * Run the playfulness linter. PASSES when there is no lightness OR lightness is
 * permitted (eligible state AND under cap). Blocks lightness in distress states or
 * over the cap.
 */
export function playfulnessLinter(text: string, opts: PlayfulnessOpts): LinterResult {
  const cap = opts.winkCap ?? DEFAULT_WINK_CAP;
  const lightness = hasLightness(text);

  // No lightness in the text → nothing to gate.
  if (!lightness) {
    return { pass: true, blocks: [] };
  }

  const eligibleState = LIGHTNESS_ELIGIBLE.has(opts.detectedState);

  // State-gate — NEVER in distress. A widening lean does NOT override this.
  if (!eligibleState) {
    return {
      pass: false,
      blocks: [block('distress_state', { detectedState: opts.detectedState })],
    };
  }

  // Archetype-widening: a configured lightness-widening lean widens the effective cap
  // by 1 (more permission for lightness), but NEVER overrides the state-gate above and
  // NEVER removes the cap entirely. WHICH leans widen is tenant config.
  const wideningSet = new Set(opts.lightnessWideningLeans ?? []);
  const widened = (opts.archetypeLean ?? []).some((a) => wideningSet.has(a));
  const effectiveCap = widened ? cap + 1 : cap;

  // Frequency cap.
  if (opts.winkCount >= effectiveCap) {
    return {
      pass: false,
      blocks: [
        block('frequency_cap', {
          winkCount: opts.winkCount,
          cap,
          effectiveCap,
          widened,
        }),
      ],
    };
  }

  // Eligible AND under (possibly widened) cap → lightness is permitted.
  return { pass: true, blocks: [] };
}
