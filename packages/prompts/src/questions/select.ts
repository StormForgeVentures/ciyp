/**
 * `selectQuestion` — the stage-aware daily-question SEED selector.
 *
 * ⚠️ NON-ROTE BY DESIGN. This function returns a SEED, not a script. The corpus is the
 * tenant's grounding + voice library, NOT a list of lines the member is READ verbatim. This
 * selector chooses a THEME/SEED for the day — `{ id, text, tags }` — that the daily-check-in
 * agent injects into the `[QUESTION-BANK SAMPLE]` slot as a STYLE + THEME example. The coach
 * (the LLM) then GENERATES the actual question fresh and contextual. Callers MUST treat the
 * returned `text` as a sample to generate FROM, never a verbatim beat string to display.
 *
 * DE-ENUM: `stageFocus` and `frame` are OPAQUE tenant strings (a corpus stage tag / soft
 * lens), not a closed enum naming a coach framework. Phase bias uses generic theme tags.
 *
 * Pure function — no I/O, no DB, web-portable. Lives in `@ciyp/prompts` so "the corpus is
 * the engine": adding/retuning questions is a zero-code content edit.
 */

import { QUESTION_BANK, type CoachingQuestion } from './index.js';

/** Where the member is in their plan window (thirds of the period). */
export type JourneyPhase = 'early' | 'mid' | 'late';

/** The recent-status bias input. Degrades gracefully when absent. */
export type RecentStatus = 'green' | 'yellow' | 'red' | 'overwhelmed' | null;

export interface SelectQuestionInput {
  /** The corpus stage tag to confine the pool to (opaque tenant string). */
  stageFocus?: string | null;
  /** Position in the window (early/mid/late). Defaults to `early`. */
  phase?: JourneyPhase;
  /** Latest member status, for the state bias. Optional; null = no bias. */
  recentStatus?: RecentStatus;
  /** The day's soft lens (opaque tenant string). Optional; soft bias only. */
  frame?: string | null;
  /** Recently-used question ids to drop (anti-repeat). */
  recentQuestionIds?: readonly string[];
  /** Deterministic-pick seed for stability across a same-day re-open. */
  seed?: string;
  /** Inject a custom bank for tests; defaults to the shipped `QUESTION_BANK`. */
  bank?: readonly CoachingQuestion[];
}

/** The SEED the coach generates FROM — NOT a line to display verbatim. */
export interface QuestionSeed {
  id: string;
  text: string;
  tags: string[];
}

/** Tags each phase prefers (soft bias; never a hard filter). Generic phase themes. */
const PHASE_BIAS_TAGS: Record<JourneyPhase, readonly string[]> = {
  early: ['vision', 'alignment'],
  mid: ['action', 'focus'],
  late: ['identity', 'retention'],
};

/** Tags the distress states narrow toward (state-shift first). */
const DISTRESS_BIAS_TAGS: readonly string[] = ['grounding', 'overwhelm', 'rest', 'dysregulated'];

/**
 * Select the daily opening-question SEED. Pure, deterministic for a given input.
 *
 * Pipeline: stage filter → distress narrowing → anti-repeat → phase/frame preference
 * scoring → deterministic seeded pick. Every step widens back if it would empty the pool
 * (never returns nothing when the bank is non-empty). Returns `null` when the bank is empty.
 */
export function selectQuestion(input: SelectQuestionInput = {}): QuestionSeed | null {
  const bank = input.bank ?? QUESTION_BANK;
  if (bank.length === 0) return null;

  const stage = input.stageFocus ?? null;
  const phase = input.phase ?? 'early';
  const recent = new Set(input.recentQuestionIds ?? []);

  // Stage pool. Widen to the whole bank if the stage has no entries (or no stage given).
  const stagePool = stage ? bank.filter((q) => q.tags.includes(stage)) : bank;
  const base = stagePool.length > 0 ? stagePool : bank;

  const phaseTags = PHASE_BIAS_TAGS[phase];
  const distress = input.recentStatus === 'red' || input.recentStatus === 'overwhelmed';

  // Distress state bias is the one HARD narrowing, but widens back if it would empty.
  let pool = base;
  if (distress) {
    const grounded = base.filter((q) => q.tags.some((t) => DISTRESS_BIAS_TAGS.includes(t)));
    if (grounded.length > 0) pool = grounded;
  }

  // Anti-repeat. Drop recently-used ids; widen back if it empties.
  const fresh = pool.filter((q) => !recent.has(q.id));
  if (fresh.length > 0) {
    pool = fresh;
  } else {
    const wholeFresh = bank.filter((q) => !recent.has(q.id));
    if (wholeFresh.length > 0) pool = wholeFresh;
  }

  // Phase + frame are PREFERENCE scores used to order the surviving pool, never to exclude.
  const scored = pool
    .map((q) => ({ q, score: biasScore(q, phaseTags, input.frame ?? null) }))
    .sort((a, b) => b.score - a.score);
  const topScore = scored[0]?.score ?? 0;
  const topTier = scored.filter((s) => s.score === topScore).map((s) => s.q);

  const picked = pickDeterministic(topTier.length > 0 ? topTier : pool, input.seed);
  if (!picked) return null;
  return { id: picked.id, text: picked.text, tags: [...picked.tags] };
}

/** Phase-tag + frame preference score (higher = more preferred). */
function biasScore(
  q: CoachingQuestion,
  phaseTags: readonly string[],
  frame: string | null,
): number {
  let score = 0;
  if (q.tags.some((t) => phaseTags.includes(t))) score += 2;
  if (frame && q.frame?.includes(frame)) score += 2;
  return score;
}

/**
 * Deterministic pick: a tiny stable string hash over the seed (+ pool identity) indexes into
 * the pool. Same seed + same pool → same pick. With no seed, picks the first.
 */
function pickDeterministic(
  pool: readonly CoachingQuestion[],
  seed?: string,
): CoachingQuestion | undefined {
  const fallback = pool[0];
  if (!fallback) return undefined;
  if (pool.length <= 1 || !seed) return fallback;
  const mix = `${seed}|${pool.map((q) => q.id).join(',')}`;
  return pool[hashString(mix) % pool.length] ?? fallback;
}

/** FNV-1a 32-bit string hash — stable, fast, no deps. */
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0; // unsigned
}
