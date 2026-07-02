/**
 * The injectable LLM / substrate boundary for `@ciyp/agents`.
 *
 * Why injection: this package is THE PURE BRAIN, consumed by the text runtime, the
 * voice runtime, and the eval harness (all in `apps/api`, via the Sport assembly
 * layer). It must not import a provider SDK, Supabase, or the Sport runtime. The
 * runtime injects the substrate wrappers (`traceAICall`, `getModelSlot`) and a
 * concrete LLM caller (002b/002c supply the real ones). Tests inject mocks — no
 * live network, no DB. The substrate interface IS the seam.
 *
 * NO default provider caller ships in this package (unlike the EL-OS donor, which
 * shipped an OpenRouter `fetch` caller): a hardcoded provider URL couples the brain
 * to one gateway and does network. The real caller lives in the runtime; here only
 * the caller/streamer TYPES are defined.
 */

import type { ModelSlot } from '../substrate.js';

/** The minimal LLM call the classifier / judge / scan need: prompt-in, text-out. */
export interface LlmCallOpts {
  /** Resolved model name (provider-qualified, e.g. `anthropic/claude-haiku-...`). */
  model: string;
  system: string;
  /** The user/data turn — already framed as data-to-classify by the caller. */
  user: string;
  temperature: number;
  maxTokens: number;
}

/** Returns the raw assistant text. Throws on transport/HTTP failure. */
export type LlmCaller = (opts: LlmCallOpts) => Promise<string>;

/**
 * A STREAMING LLM call. Yields text deltas as they arrive AND resolves the full
 * concatenated text. `onDelta` is the transport-agnostic chunk sink — the
 * orchestrator passes whatever wants the deltas (the SSE adapter, the voice
 * adapter). The streamer itself knows nothing about transport. Returns the full
 * assembled text (so the linter chain can vet it post-stream).
 */
export type LlmStreamer = (
  opts: LlmCallOpts & { onDelta?: (delta: string) => void },
) => Promise<string>;

/**
 * The subset of the runtime's `getModelSlot` signature this package needs. The
 * runtime (002c) injects the real per-tenant slot resolver.
 */
export type GetModelSlot = (
  slot: ModelSlot,
) => Promise<{ model: string; max_tokens?: number; [k: string]: unknown } | null>;

/** Options passed to the injected `traceAICall` wrapper (observability contract subset). */
export interface TraceAICallOpts<T> {
  eventType: string;
  memberId?: string | null;
  threadId?: string | null;
  messageId?: string | null;
  modelSlot?: ModelSlot | null;
  data?: Record<string, unknown>;
  call: () => Promise<T>;
}

/**
 * The injected `traceAICall` wrapper. Resolves `T`, writes the trace
 * fire-and-forget, re-throws the original error on failure.
 */
export type TraceAICall = <T>(opts: TraceAICallOpts<T>) => Promise<T>;

/** The substrate the LLM-touching agents depend on — all injectable. */
export interface AgentSubstrate {
  llm: LlmCaller;
  getModelSlot: GetModelSlot;
  traceAICall: TraceAICall;
}
