/**
 * scanLanguageSignals — the continuous fast-slot language-signal scan. Co-located
 * with the classifier. Extracts zero-or-more 9-state language signals (each with
 * confidence + verbatim excerpt) from member text.
 *
 * Hard rules:
 *   - Resolves the model via `getModelSlot('fast')`; wrapped in
 *     `traceAICall({ eventType: 'language_signal_extracted', modelSlot: 'fast' })`
 *     FROM THE FIRST COMMIT (routing-call-gap discipline).
 *   - Validates against the Zod result-array schema. Parse failure → empty array +
 *     the trace captures the failure. NEVER throws into the turn.
 *   - This scan does NOT persist `language_signals` rows (the write path + clustering
 *     is owned downstream); the scan returns structured results only.
 *
 * Purity: the substrate (`traceAICall`, `getModelSlot`, `llm`) and the scan prompt
 * are INJECTED.
 */

import { z } from 'zod';
import { DETECTED_STATES } from './schema.js';
import type { AgentSubstrate } from '../llm/types.js';

/** One extracted language signal — one of the 9 states + confidence + excerpt. */
export const LanguageSignal = z.object({
  signal_kind: z.enum(DETECTED_STATES),
  confidence: z.number().min(0).max(1),
  excerpt: z.string(),
});
export type LanguageSignal = z.infer<typeof LanguageSignal>;

/** The scan returns a (possibly empty) array of signals. */
export const LanguageSignalResultArray = z.array(LanguageSignal);
export type LanguageSignalResult = LanguageSignal;

export interface ScanLanguageSignalsOpts {
  /** The scan prompt (from `@ciyp/prompts#LANGUAGE_SIGNAL_PROMPT_BASELINE`). */
  scanPrompt: string;
  substrate: AgentSubstrate;
  memberId?: string | null;
  threadId?: string | null;
  messageId?: string | null;
}

function extractJsonArray(raw: string): unknown {
  const t = raw.trim();
  try {
    return JSON.parse(t);
  } catch {
    // fall through
  }
  const start = t.indexOf('[');
  const end = t.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('no JSON array in language-signal output');
  }
  return JSON.parse(t.slice(start, end + 1));
}

/**
 * Scan member text for 9-state language signals. ALWAYS resolves — returns `[]` on
 * any failure (parse error, LLM error, unconfigured slot) and the trace captures the
 * failure. Never throws into the turn.
 */
export async function scanLanguageSignals(
  text: string,
  opts: ScanLanguageSignalsOpts,
): Promise<LanguageSignalResult[]> {
  const { substrate, memberId, threadId, messageId } = opts;
  const traceData: Record<string, unknown> = {};

  try {
    const slot = await substrate.getModelSlot('fast');
    if (!slot || typeof slot.model !== 'string') {
      traceData.parse_failed = true;
      traceData.cause = 'fast slot unconfigured';
      await traceEmpty(opts, traceData);
      return [];
    }
    const model = slot.model;

    return await substrate.traceAICall<LanguageSignalResult[]>({
      eventType: 'language_signal_extracted',
      modelSlot: 'fast',
      memberId,
      threadId,
      messageId,
      data: traceData,
      call: async () => {
        const raw = await substrate.llm({
          model,
          system: opts.scanPrompt,
          user: text,
          temperature: 0,
          maxTokens: 256,
        });
        let parsed: unknown;
        try {
          parsed = extractJsonArray(raw);
        } catch (err) {
          traceData.parse_failed = true;
          traceData.cause = err instanceof Error ? err.message : 'unparseable';
          return [];
        }
        const validated = LanguageSignalResultArray.safeParse(parsed);
        if (!validated.success) {
          traceData.parse_failed = true;
          traceData.cause = `zod: ${validated.error.issues[0]?.message ?? 'validation error'}`;
          return [];
        }
        traceData.signal_count = validated.data.length;
        return validated.data;
      },
    });
  } catch {
    // LLM transport error / trace re-throw — resolve empty, never throw.
    return [];
  }
}

/** Emit a trace for a pure-failure path (no LLM call made). */
async function traceEmpty(
  opts: ScanLanguageSignalsOpts,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    await opts.substrate.traceAICall<LanguageSignalResult[]>({
      eventType: 'language_signal_extracted',
      modelSlot: 'fast',
      memberId: opts.memberId,
      threadId: opts.threadId,
      messageId: opts.messageId,
      data,
      call: async () => [],
    });
  } catch {
    // never throw into the turn
  }
}
