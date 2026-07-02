/**
 * retentionLinter — the optional 4th stage. Judges whether the assistant reply
 * translates behavior → identity (retention pillar #3). Pure over text; may call the
 * fast slot via the injected substrate.
 *
 * Optional + deferrable: the chain skips it unless `runRetentionLinter` is set. When
 * unwired (no substrate / no judge prompt) it is a no-op pass — its absence never
 * breaks the chain. It does NOT block hard; a low translation score returns a soft
 * re-prompt suggestion the caller may act on.
 *
 * Observability: the judge call is wrapped in the injected `traceAICall` with
 * `eventType: 'eval_judge_call'`, `modelSlot: 'fast'`, `data.judge: 'retention'`. The
 * trace is fire-and-forget; a trace-write failure never changes the fail-open judgment.
 */

import type { LinterResult, LinterBlock } from './types.js';
import type { AgentSubstrate } from '../llm/types.js';

export interface RetentionOpts {
  substrate?: AgentSubstrate;
  /** The retention-pillar judge prompt (from `@ciyp/prompts#RETENTION_JUDGE_PROMPT`). */
  judgePrompt?: string;
  /** Translation-score threshold below which a soft re-prompt is suggested. */
  threshold?: number;
  memberId?: string | null;
  threadId?: string | null;
  messageId?: string | null;
}

function block(score: number): LinterBlock {
  return {
    kind: 'retention',
    linter: 'retention',
    hard: false,
    repromptInstruction:
      'Your last reply described behavior without translating it into identity. Add a line that reflects who the member is becoming through this action (behavior → identity).',
    traceData: { kind: 'retention', score },
  };
}

export async function retentionLinter(text: string, opts: RetentionOpts = {}): Promise<LinterResult> {
  // Unwired → no-op pass (the stage is optional/deferrable).
  if (!opts.substrate || !opts.judgePrompt) {
    return { pass: true, blocks: [] };
  }
  const threshold = opts.threshold ?? 0.5;

  let score: number;
  try {
    const slot = await opts.substrate.getModelSlot('fast');
    if (!slot || typeof slot.model !== 'string') {
      return { pass: true, blocks: [] }; // fail open — retention is a nudge, not a gate
    }
    const model = slot.model;
    // The judge IS an LLM call — wrap it in traceAICall (eval_judge_call).
    const raw = await opts.substrate.traceAICall<string>({
      eventType: 'eval_judge_call',
      modelSlot: 'fast',
      memberId: opts.memberId,
      threadId: opts.threadId,
      messageId: opts.messageId,
      data: { judge: 'retention' },
      call: () =>
        opts.substrate!.llm({
          model,
          system: opts.judgePrompt!,
          user: text,
          temperature: 0,
          maxTokens: 64,
        }),
    });
    const t = raw.trim();
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start === -1 || end === -1) return { pass: true, blocks: [] };
    const parsed = JSON.parse(t.slice(start, end + 1)) as { score?: unknown };
    if (typeof parsed.score !== 'number') return { pass: true, blocks: [] };
    score = Math.max(0, Math.min(1, parsed.score));
  } catch {
    // Fail open — retention is a quality nudge, never blocks the turn.
    return { pass: true, blocks: [] };
  }

  if (score < threshold) {
    return { pass: false, blocks: [block(score)] };
  }
  return { pass: true, blocks: [] };
}
