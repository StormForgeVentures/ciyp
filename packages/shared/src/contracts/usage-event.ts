/**
 * Contract 03 — Usage Event (runtime → ledger, engine-internal).
 * At-least-once delivery + idempotent rollup (dedupe on idempotencyKey).
 * Frozen at v1, additive-only. Source: docs/contracts/03-usage-event.md.
 *
 * NOTE (ADR-008 / decision #13): costMicros is RAW provider cost as traced and is treated
 * as ADVISORY by the consumer — the ledger re-prices from token/unit counts against the
 * platform pricebook (priced_cost_micros + pricebook_version are ledger columns, not wire
 * fields). Credit/markup conversion is a ledger-side concern, never the emitter's.
 */
import { z } from 'zod';

export const UsageFeature = z.enum([
  'chat',
  'voice',
  'transcription',
  'embedding',
  'rerank',
  'classify',
  'cadence',
  'memory_recall',
  'tts',
]);
export type UsageFeature = z.infer<typeof UsageFeature>;

export const UsageEvent = z.object({
  /** Deterministic from the trace id; the dedupe key the ledger upserts on. */
  idempotencyKey: z.string(),
  /** Whose wallet gets debited — always the member's coach (flow c). */
  tenantId: z.string().uuid(),
  /** Null for tenant-level/system calls. */
  memberId: z.string().uuid().nullable(),
  /** The ai_traces row this came from (audit join). */
  traceId: z.string().uuid(),
  feature: UsageFeature,
  /** e.g. "openrouter" | "voyage" | "deepgram" | "fish-audio". */
  provider: z.string(),
  /** Resolved model name from the tenant's slot — never a hardcoded literal. */
  model: z.string(),
  promptTokens: z.number().int().nonnegative().default(0),
  completionTokens: z.number().int().nonnegative().default(0),
  /** Non-token meters (audio seconds, chars) where applicable. */
  units: z.number().nonnegative().default(0),
  /** RAW provider cost in micro-units — advisory (see header note). */
  costMicros: z.number().int().nonnegative(),
  occurredAt: z.string().datetime(),
  /** Routes enforcement (ADR-003 §4). */
  spendClass: z.enum(['cheap', 'heavy']),
});
export type UsageEvent = z.infer<typeof UsageEvent>;
