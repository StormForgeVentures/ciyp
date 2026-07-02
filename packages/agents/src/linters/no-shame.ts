/**
 * noShameLinter — guards the no-shame guarantee. Regex layer (synchronous, immediate
 * block) + a fast-slot judge escalation for borderline text + a safe-template
 * fallback that bounds latency.
 *
 * Contract:
 *   - Regex match on obvious shame language ("you failed", "you're behind",
 *     "you should have", …) → immediate `no_shame` block, NO judge call.
 *   - Regex-clean but borderline → fast-slot judge via the injected slot, wrapped in
 *     `traceAICall({ eventType: 'no_shame_block' })` ONLY on block. A score over
 *     threshold blocks.
 *   - On block, the re-prompt-instruction builder returns the stricter-rewrite
 *     template. The CALLER owns the re-prompt loop.
 *   - A second block substitutes the safe template — at most ONE re-prompt, then
 *     substitute (the latency guard).
 *   - Judge unavailable / timeout → FAIL SAFE: never pass un-judged borderline text;
 *     pass regex-clean text only if regex was the sole needed signal, else substitute
 *     the safe template.
 *
 * Purity: the judge prompt, safe template, and re-prompt builder are INJECTED (from
 * `@ciyp/prompts`); the LLM + trace + slot come from the substrate.
 */

import type { LinterResult, LinterBlock } from './types.js';
import type { AgentSubstrate } from '../llm/types.js';

/**
 * The EFFECTIVE production block threshold for the judge-scored (borderline) layer.
 * A judge score STRICTLY ABOVE this blocks (`score > threshold`).
 *
 * Set at 0.8: the judge over-flags legitimately-DIRECT coaching
 * (compassionate-confrontation) at ~0.65–0.70 while genuine shaming scores ~0.95, and
 * BLATANT shaming is caught by the regex layer first (immediate block, no judge — so
 * this cutoff only governs borderline, judge-scored text). 0.8 lets the legit-direct
 * cluster through while still catching ~0.95 shaming with margin and keeping the regex
 * floor intact.
 */
export const DEFAULT_NO_SHAME_THRESHOLD = 0.8;

/** Obvious shame / failure language — immediate block, no judge call. */
const SHAME_PATTERNS: RegExp[] = [
  /\byou (?:have )?failed\b/i,
  /\byou'?re (?:falling )?behind\b/i,
  /\byou are (?:falling )?behind\b/i,
  /\byou should(?:'?ve| have)\b/i,
  /\byou (?:are|'?re) (?:lazy|broken|a failure|hopeless)\b/i,
  /\bwhat'?s wrong with you\b/i,
  /\byou keep (?:failing|messing up|screwing up)\b/i,
  /\byou never\b.*\b(?:follow through|finish|commit)\b/i,
  /\byou'?re not trying hard enough\b/i,
];

export interface NoShameOpts {
  /** Injected substrate (`llm`, `getModelSlot`, `traceAICall`). Optional: a pure
   *  regex-only invocation may omit it (no borderline escalation). */
  substrate?: AgentSubstrate;
  /** The judge rubric prompt (from `@ciyp/prompts#NO_SHAME_JUDGE_PROMPT_BASELINE`). */
  judgePrompt?: string;
  /** The safe-template fallback line (from `@ciyp/prompts#NO_SHAME_SAFE_TEMPLATE`). */
  safeTemplate?: string;
  /** Builds the stricter-rewrite re-prompt (from `@ciyp/prompts`). */
  repromptBuilder?: (score: number) => string;
  /** Shame-score block threshold (default `DEFAULT_NO_SHAME_THRESHOLD` = 0.8). */
  threshold?: number;
  /** Is this the SECOND pass (a re-prompted rewrite)? If so, a block substitutes the
   *  safe template instead of returning another re-prompt instruction. */
  isReprompt?: boolean;
  /** Skip the judge entirely (regex-only mode). Used by callers with no substrate. */
  regexOnly?: boolean;
  memberId?: string | null;
  threadId?: string | null;
  messageId?: string | null;
}

const DEFAULT_REPROMPT = (score: number): string =>
  `Your last reply scored ${score.toFixed(2)} on shame language. Rewrite with no blame, calm and supportive, offering a reset rather than a verdict.`;

const DEFAULT_SAFE_TEMPLATE =
  "Let's pause and reset together. There's nothing to fix or fall behind on right now. What feels most true for you in this moment?";

function regexMatch(text: string): { matched: boolean; position: number } {
  for (const re of SHAME_PATTERNS) {
    const m = re.exec(text);
    if (m) return { matched: true, position: m.index };
  }
  return { matched: false, position: -1 };
}

function block(opts: {
  hard: boolean;
  reprompt?: string;
  traceData: Record<string, unknown>;
}): LinterBlock {
  return {
    kind: 'no_shame',
    linter: 'no_shame',
    hard: opts.hard,
    repromptInstruction: opts.reprompt,
    traceData: opts.traceData,
  };
}

/**
 * Run the no-shame linter. `pass=false` means the chain must re-prompt (first pass)
 * or substitute the safe template (second pass / judge-unavailable). When the safe
 * template is substituted, `rewritten` carries it.
 */
export async function noShameLinter(text: string, opts: NoShameOpts = {}): Promise<LinterResult> {
  const threshold = opts.threshold ?? DEFAULT_NO_SHAME_THRESHOLD;
  const safeTemplate = opts.safeTemplate ?? DEFAULT_SAFE_TEMPLATE;
  const reprompt = opts.repromptBuilder ?? DEFAULT_REPROMPT;

  // 1. Regex layer — obvious shame language blocks immediately, no judge call.
  const rx = regexMatch(text);
  if (rx.matched) {
    if (opts.isReprompt) {
      // Second block → substitute the safe template (latency guard).
      return {
        pass: false,
        rewritten: safeTemplate,
        blocks: [
          block({
            hard: true,
            traceData: { kind: 'no_shame', signal: 'regex', position: rx.position, substituted: true },
          }),
        ],
      };
    }
    return {
      pass: false,
      blocks: [
        block({
          hard: true,
          reprompt: reprompt(1.0),
          traceData: { kind: 'no_shame', signal: 'regex', position: rx.position },
        }),
      ],
    };
  }

  // 2. Regex-clean. If regex-only mode (or no substrate), the text passes — regex was
  //    the sole signal needed.
  if (opts.regexOnly || !opts.substrate || !opts.judgePrompt) {
    return { pass: true, blocks: [] };
  }

  // 3. Borderline → fast-slot judge. Trace ONLY on block. Fail safe on any judge
  //    error: never pass un-judged borderline text — substitute the safe template.
  let score: number;
  try {
    score = await runJudge(text, opts);
  } catch {
    return {
      pass: false,
      rewritten: safeTemplate,
      blocks: [
        block({
          hard: true,
          traceData: { kind: 'no_shame', signal: 'judge_unavailable', substituted: true },
        }),
      ],
    };
  }

  if (score > threshold) {
    // Block. Emit the trace ONLY on block.
    await emitBlockTrace(opts, { signal: 'judge', score });
    if (opts.isReprompt) {
      return {
        pass: false,
        rewritten: safeTemplate,
        blocks: [
          block({
            hard: true,
            traceData: { kind: 'no_shame', signal: 'judge', score, substituted: true },
          }),
        ],
      };
    }
    return {
      pass: false,
      blocks: [
        block({
          hard: true,
          reprompt: reprompt(score),
          traceData: { kind: 'no_shame', signal: 'judge', score },
        }),
      ],
    };
  }

  return { pass: true, blocks: [] };
}

/** Call the fast-slot judge (NOT traced here — traced only on block). */
async function runJudge(text: string, opts: NoShameOpts): Promise<number> {
  const substrate = opts.substrate;
  if (!substrate || !opts.judgePrompt) throw new Error('no judge configured');
  const slot = await substrate.getModelSlot('fast');
  if (!slot || typeof slot.model !== 'string') throw new Error('fast slot unconfigured');
  const raw = await substrate.llm({
    model: slot.model,
    system: opts.judgePrompt,
    user: text,
    // SCORE-ONLY contract: the judge returns `{ "score": <0..1> }` and nothing else,
    // so the output is tiny and cannot self-truncate. 64 is far more than ample.
    temperature: 0,
    maxTokens: 64,
  });
  return parseJudgeScore(raw);
}

/**
 * Recover the judge's numeric `score` from its raw output. Truncation-proof by
 * design: tries strict JSON first, then a tolerant scan that pulls the first
 * `"score": <number>` even from a partial / unclosed object — so a judge that emits
 * extra text or gets cut off can NEVER masquerade as judge-unavailable. Only a
 * genuinely score-less / empty response throws → the fail-safe degrade.
 */
function parseJudgeScore(raw: string): number {
  const t = (raw ?? '').trim();
  // 1. Happy path — strict JSON object.
  try {
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start !== -1 && end > start) {
      const parsed = JSON.parse(t.slice(start, end + 1)) as { score?: unknown };
      if (typeof parsed.score === 'number' && Number.isFinite(parsed.score)) {
        return Math.max(0, Math.min(1, parsed.score));
      }
    }
  } catch {
    // Fall through to the tolerant scan (truncated / unclosed object).
  }
  // 2. Tolerant scan — pull the first numeric `score` even without a closing brace.
  const m = /"score"\s*:\s*(-?\d+(?:\.\d+)?)/i.exec(t);
  if (m) {
    const n = Number(m[1]);
    if (Number.isFinite(n)) return Math.max(0, Math.min(1, n));
  }
  // 3. No recoverable score → genuinely unavailable → fail safe.
  throw new Error('judge returned no recoverable score');
}

/** Write the `no_shame_block` trace via the substrate (fire-and-forget upstream). */
async function emitBlockTrace(
  opts: NoShameOpts,
  data: Record<string, unknown>,
): Promise<void> {
  if (!opts.substrate) return;
  try {
    await opts.substrate.traceAICall<void>({
      eventType: 'no_shame_block',
      modelSlot: 'fast',
      memberId: opts.memberId,
      threadId: opts.threadId,
      messageId: opts.messageId,
      data,
      call: async () => undefined,
    });
  } catch {
    // Never let a trace failure affect the block decision.
  }
}
