/**
 * The generic bounded-thread cadence agent — the platform mechanic behind daily /
 * weekly / monthly_review cadence threads.
 *
 * The donor engine shipped three coach-specific cadence agents each hardwired to a
 * donor-specific output schema. Here the MACHINERY is generalized and the per-cadence
 * content (beats, output schema, directive) is INJECTED by the seed / tenant config —
 * zero coach content ships in this package.
 *
 * Two callables mirror the donor pattern:
 *   - `runCadenceTurn`   — one conversational beat: stream a linter-passed line, advance
 *     the step index for the progress strip. Wrapped in `traceAICall`.
 *   - `finalizeCadence`  — the forced finalize: a structured-output LLM call, validated
 *     against the INJECTED output schema with ONE repair retry, falling back to the
 *     conversation-state draft (via an injected builder) if the emit still fails. NEVER
 *     returns an invalid row.
 *
 * Purity: the substrate (`traceAICall`, `getModelSlot`) + the LLM caller/streamer + the
 * linter wiring + the output schema + the fallback builder are all INJECTED. The package
 * never imports the runtime; the DB write of the finalized row happens in the route.
 */

import type { ZodType } from 'zod';
import type { AgentSubstrate, LlmStreamer, LlmCaller } from '../llm/types.js';
import { runLinterChain, type LinterChainContext } from '../linters/index.js';

export * from './directive.js';

/** The linter wiring the cadence turn threads through (same shape the orchestrator injects). */
type CadenceLinterWiring = Pick<
  LinterChainContext,
  'registeredArchetypeNames' | 'noShame' | 'retention' | 'runRetentionLinter' | 'winkCap'
>;

export interface RunCadenceTurnInput {
  memberId: string;
  threadId: string;
  /** The incoming member message. */
  userMessage: string;
  /** The assembled system prompt (cascade + the bounded cadence directive). */
  systemPrompt: string;
  /** Current step index (0..totalBeats). Advances when a beat is captured. */
  stepIndex: number;
  /** The progress-strip denominator (the number of active beats). */
  totalBeats: number;
  /** Whether THIS turn captured a beat value (the route's parse decides this). */
  beatCaptured: boolean;
  /** A short surface label for the trace (e.g. the cadence key). */
  surface: string;
  substrate: AgentSubstrate;
  streamer: LlmStreamer;
  chatModel: string;
  maxTokens?: number;
  linter: CadenceLinterWiring;
  onTextDelta?: (delta: string) => void;
}

export interface RunCadenceTurnResult {
  assistantMessage: string;
  /** The next step index for the progress strip (clamped to totalBeats). */
  nextStepIndex: number;
}

/**
 * Run ONE cadence beat. Streams an assistant line (chat slot — NEVER `fast`), vets it
 * through the linter chain (voice → no-shame → playfulness → retention), and advances the
 * step index when a beat was captured. The whole run is wrapped in `traceAICall`
 * (`eventType='model_call'`, `modelSlot='chat'`).
 */
export async function runCadenceTurn(input: RunCadenceTurnInput): Promise<RunCadenceTurnResult> {
  const { substrate, streamer, chatModel } = input;

  const rawText = await substrate.traceAICall<string>({
    eventType: 'model_call',
    modelSlot: 'chat',
    memberId: input.memberId,
    threadId: input.threadId,
    data: { surface: input.surface, step_index: input.stepIndex },
    call: () =>
      streamer({
        model: chatModel,
        system: input.systemPrompt,
        user: input.userMessage,
        temperature: 0.6,
        maxTokens: input.maxTokens ?? 512,
        onDelta: input.onTextDelta,
      }),
  });

  // A cadence check-in is a reflective, neutral-state flow; the playfulness gate uses a
  // calm default state and a 0 wink count.
  const chain = await runLinterChain(rawText, {
    registeredArchetypeNames: input.linter.registeredArchetypeNames,
    noShame: input.linter.noShame,
    retention: input.linter.retention,
    runRetentionLinter: input.linter.runRetentionLinter,
    winkCap: input.linter.winkCap,
    detectedState: 'aligned',
    winkCount: 0,
    archetypeLean: [],
    memberId: input.memberId,
    threadId: input.threadId,
  });

  const nextStepIndex = input.beatCaptured
    ? Math.min(input.stepIndex + 1, input.totalBeats)
    : input.stepIndex;

  return { assistantMessage: chain.finalText, nextStepIndex };
}

export interface FinalizeCadenceInput<TOutput, TDraft> {
  memberId: string;
  threadId: string;
  /** The assembled finalize prompt instructing a strict-JSON emit. */
  finalizePrompt: string;
  /** The transcript (or summary) the model emits the structured row from. */
  transcript: string;
  /** The conversation-state accumulator — the fallback source. */
  draft: TDraft;
  /** The INJECTED Zod schema the emitted row must satisfy (per-cadence output shape). */
  outputSchema: ZodType<TOutput>;
  /**
   * Build a valid row from the conversation-state `draft` when both emits fail. MUST
   * throw (no row fabricated) if the draft is insufficient — the route surfaces the error
   * and does NOT render the completion screen.
   */
  buildFallback: (draft: TDraft) => TOutput;
  /** Optional repair instruction appended on the retry (schema-shape reminder). */
  repairInstruction?: string;
  /** A short surface label for the trace (e.g. `<cadence>_finalize`). */
  surface: string;
  substrate: AgentSubstrate;
  /** A non-streaming caller for the structured-output emit. */
  llm: LlmCaller;
  chatModel: string;
  maxTokens?: number;
}

export interface FinalizeCadenceResult<TOutput> {
  output: TOutput;
  /** How the row was produced: a clean emit, a repaired emit, or the fallback. */
  source: 'emit' | 'repair' | 'fallback';
}

/**
 * Force the structured-output finalize. Calls the LLM for a strict-JSON row, validates
 * against the INJECTED `outputSchema`, retries ONCE with a repair instruction on failure,
 * and falls back to the conversation-state `draft` (via `buildFallback`) if the emit still
 * fails. ALWAYS returns a valid `TOutput` OR throws (when the fallback builder cannot
 * produce a valid row — no row is fabricated).
 */
export async function finalizeCadence<TOutput, TDraft>(
  input: FinalizeCadenceInput<TOutput, TDraft>,
): Promise<FinalizeCadenceResult<TOutput>> {
  const { substrate, llm, chatModel } = input;

  const emit = (system: string): Promise<string> =>
    substrate.traceAICall<string>({
      eventType: 'model_call',
      modelSlot: 'chat',
      memberId: input.memberId,
      threadId: input.threadId,
      data: { surface: input.surface },
      call: () =>
        llm({
          model: chatModel,
          system,
          user: input.transcript,
          temperature: 0,
          maxTokens: input.maxTokens ?? 384,
        }),
    });

  const tryParse = (raw: string | null): TOutput | null => {
    if (raw === null) return null;
    let json: unknown;
    try {
      json = JSON.parse(extractJson(raw));
    } catch {
      return null;
    }
    const parsed = input.outputSchema.safeParse(json);
    return parsed.success ? parsed.data : null;
  };

  // First attempt.
  const first = tryParse(await safe(() => emit(input.finalizePrompt)));
  if (first !== null) return { output: first, source: 'emit' };

  // One repair retry.
  const repairSuffix = input.repairInstruction
    ? `\n\n[REPAIR] Your previous output was not valid JSON matching the schema. ${input.repairInstruction}`
    : '\n\n[REPAIR] Your previous output was not valid JSON matching the schema. Return ONLY a JSON object matching the required shape.';
  const second = tryParse(await safe(() => emit(input.finalizePrompt + repairSuffix)));
  if (second !== null) return { output: second, source: 'repair' };

  // Fallback: build the row from the conversation-state draft. Throws if the draft is
  // insufficient (no row fabricated).
  const fallback = input.buildFallback(input.draft);
  return { output: fallback, source: 'fallback' };
}

/** Pull the first {...} block out of a possibly fenced/explained LLM response. */
function extractJson(raw: string): string {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) return raw.slice(start, end + 1);
  return raw;
}

async function safe(fn: () => Promise<string>): Promise<string | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}
