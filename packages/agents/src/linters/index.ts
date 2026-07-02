/**
 * The linter chain — `voiceLinter → noShameLinter → playfulnessLinter →
 * retentionLinter`, in CANONICAL ORDER.
 *
 * This single runner is the ONLY path that vets assistant text for BOTH the text
 * runtime and the voice runtime. Reordering / bypassing on any assistant-text
 * emission is a High finding. The canonical order is verifiable in this one file.
 *
 * Purity: NO imports of SSE / WebSocket / cache / Postgres. Store-backed values
 * (`winkCount`) are injected via `LinterContext`; side effects (the trace emission
 * and the re-prompt LLM call) are CALLER-OWNED — the chain returns judgments +
 * re-prompt instructions, never performs the rewrite itself.
 */

import { voiceLinter } from './voice.js';
import { noShameLinter, type NoShameOpts } from './no-shame.js';
import { playfulnessLinter } from './playfulness.js';
import { retentionLinter, type RetentionOpts } from './retention.js';
import type {
  LinterContext,
  LinterChainResult,
  LinterBlock,
  LinterResult,
} from './types.js';

// Re-export the shared types + individual linters so callers compose them identically.
export * from './types.js';
export { voiceLinter, stripEmDashes, archetypeNameRegex, stripArchetypeNames } from './voice.js';
export { noShameLinter, DEFAULT_NO_SHAME_THRESHOLD } from './no-shame.js';
export { playfulnessLinter, hasLightness } from './playfulness.js';
export { retentionLinter } from './retention.js';
export type { NoShameOpts } from './no-shame.js';
export type { RetentionOpts } from './retention.js';
export type { PlayfulnessOpts } from './playfulness.js';

/**
 * Extra wiring the async stages need, threaded through the context. All optional and
 * injected — keeping the chain pure (no store/LLM imports of its own).
 */
export interface LinterChainContext extends LinterContext {
  /** No-shame judge wiring (substrate + prompt + safe template + reprompt builder). */
  noShame?: Pick<
    NoShameOpts,
    'substrate' | 'judgePrompt' | 'safeTemplate' | 'repromptBuilder' | 'threshold' | 'regexOnly'
  >;
  /** Is this pass a re-prompted rewrite? Threaded to the no-shame stage. */
  isReprompt?: boolean;
  /** Retention judge wiring (only consulted when `runRetentionLinter`). */
  retention?: Pick<RetentionOpts, 'substrate' | 'judgePrompt' | 'threshold'>;
  memberId?: string | null;
  threadId?: string | null;
  messageId?: string | null;
}

/**
 * Run the canonical chain over `text`. Default: retention is SKIPPED unless
 * `ctx.runRetentionLinter === true` (optional/deferrable, default off). Returns the
 * aggregate `pass`, the (possibly substituted/normalized) `finalText`, and every
 * block with its re-prompt instruction.
 */
export async function runLinterChain(
  text: string,
  ctx: LinterChainContext,
): Promise<LinterChainResult> {
  const blocks: LinterBlock[] = [];
  let finalText = text;

  // 1. voiceLinter (synchronous). Carries em-dash normalization forward.
  const voice: LinterResult = voiceLinter(finalText, ctx.registeredArchetypeNames);
  if (voice.rewritten !== undefined) finalText = voice.rewritten;
  blocks.push(...voice.blocks);

  // 2. noShameLinter (async — regex + optional fast-slot judge).
  const noShame: LinterResult = await noShameLinter(finalText, {
    ...ctx.noShame,
    isReprompt: ctx.isReprompt,
    memberId: ctx.memberId,
    threadId: ctx.threadId,
    messageId: ctx.messageId,
  });
  if (noShame.rewritten !== undefined) finalText = noShame.rewritten; // safe-template substitution
  blocks.push(...noShame.blocks);

  // 3. playfulnessLinter (synchronous — state-gate + frequency-cap).
  const playful: LinterResult = playfulnessLinter(finalText, {
    detectedState: ctx.detectedState,
    winkCount: ctx.winkCount,
    archetypeLean: ctx.archetypeLean,
    winkCap: ctx.winkCap,
    lightnessWideningLeans: ctx.lightnessWideningLeans,
  });
  blocks.push(...playful.blocks);

  // 4. retentionLinter (async, OPTIONAL — skipped unless explicitly enabled).
  if (ctx.runRetentionLinter) {
    const retention: LinterResult = await retentionLinter(finalText, {
      ...ctx.retention,
      memberId: ctx.memberId,
      threadId: ctx.threadId,
      messageId: ctx.messageId,
    });
    blocks.push(...retention.blocks);
  }

  return {
    pass: blocks.length === 0,
    finalText,
    blocks,
  };
}

/** The canonical order, exported so a governance grep can verify it in one place. */
export const CANONICAL_LINTER_ORDER = [
  'voice',
  'no_shame',
  'playfulness',
  'retention',
] as const;
