/**
 * Runtime LLM caller (ADR-007: real model calls route through OpenRouter). This is the
 * SINGLE writer of the token-bearing `model_call` ai_traces row (trace-sink delegates
 * model_call here): it is the only place provider / model / token usage is known, so
 * 002d AC-3 (a model-call row carries prompt_tokens/completion_tokens/provider/model) is
 * satisfied structurally.
 *
 * `cost_micros` is left honest-null — the pricing authority is PRD-007's pricebook
 * (002d FR-4 / OQ-A), never this table alone.
 *
 * `no placeholder replies` (002d FR-6): an empty/whitespace completion RAISES loudly,
 * it never degrades to a placeholder string in a live turn.
 */
import type { LlmCaller, LlmStreamer, LlmCallOpts } from '@ciyp/agents';
import { recordAiTrace } from './trace-sink.js';
import type { CiypScope } from './scope-resolver.js';

export interface LlmWiring {
  llm: LlmCaller;
  streamer: LlmStreamer;
}

export class EmptyCompletionError extends Error {
  constructor(model: string) {
    super(`model '${model}' returned an empty completion — refusing to emit a placeholder reply (002d FR-6).`);
    this.name = 'EmptyCompletionError';
  }
}

interface TraceCtx {
  scope: CiypScope;
  correlationId: string;
  memberId?: string | null;
  threadId?: string | null;
  messageId?: string | null;
}

function traceModelCall(
  ctx: TraceCtx,
  opts: LlmCallOpts,
  usage: { prompt_tokens?: number; completion_tokens?: number } | undefined,
  latencyMs: number,
): void {
  recordAiTrace(ctx.scope, ctx.correlationId, {
    eventType: 'model_call',
    memberId: ctx.memberId,
    threadId: ctx.threadId,
    messageId: ctx.messageId,
    feature: 'coaching_chat',
    provider: 'openrouter',
    model: opts.model,
    promptTokens: usage?.prompt_tokens ?? null,
    completionTokens: usage?.completion_tokens ?? null,
    costMicros: null, // pricebook authority = PRD-007
    latencyMs,
    data: { surface: 'llm-caller' },
  });
}

/** Real OpenRouter caller. Requires OPENROUTER_API_KEY. */
export function createOpenRouterCaller(ctx: TraceCtx): LlmWiring {
  const call = async (opts: LlmCallOpts, onDelta?: (d: string) => void): Promise<string> => {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key || key.trim() === '') {
      throw new Error('createOpenRouterCaller: OPENROUTER_API_KEY is unset (inject a mock caller for tests).');
    }
    const started = Date.now();
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: opts.model,
        messages: [
          { role: 'system', content: opts.system },
          { role: 'user', content: opts.user },
        ],
        temperature: opts.temperature,
        max_tokens: opts.maxTokens,
      }),
    });
    if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json = (await res.json()) as {
      choices: { message: { content: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = json.choices?.[0]?.message?.content ?? '';
    traceModelCall(ctx, opts, json.usage, Date.now() - started);
    if (text.trim() === '') throw new EmptyCompletionError(opts.model);
    if (onDelta) onDelta(text); // OpenRouter non-stream: deliver as one delta
    return text;
  };
  return {
    llm: (opts) => call(opts),
    streamer: (opts) => call(opts, opts.onDelta),
  };
}

/**
 * Mock caller for the deterministic integration test: returns `reply(opts)` and writes
 * the SAME token-bearing model_call trace (fake usage). No network, no spend — proves the
 * full turn wiring without a live model.
 */
export function createMockCaller(
  ctx: TraceCtx,
  reply: (opts: LlmCallOpts) => string,
  usage: { prompt_tokens: number; completion_tokens: number } = { prompt_tokens: 42, completion_tokens: 17 },
): LlmWiring {
  const call = async (opts: LlmCallOpts, onDelta?: (d: string) => void): Promise<string> => {
    const started = Date.now();
    const text = reply(opts);
    traceModelCall(ctx, opts, usage, Date.now() - started);
    if (text.trim() === '') throw new EmptyCompletionError(opts.model);
    if (onDelta) onDelta(text);
    return text;
  };
  return { llm: (opts) => call(opts), streamer: (opts) => call(opts, opts.onDelta) };
}
