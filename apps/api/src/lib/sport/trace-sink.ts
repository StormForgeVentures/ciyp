/**
 * ai_traces sink (PRD-002b FR-4 / PRD-002d). Every meaningful AI decision writes one
 * row, fire-and-forget (a trace failure NEVER fails the turn), with credential-shaped
 * substrings scrubbed from the two free-text fields that persist (`error`, tool `args`)
 * — the redaction floor. `event_type` is free text in the CIYP schema, so the SDK's
 * `app:*` widening is representable directly. Every row carries the tenant id, the
 * member id (when present), and the turn correlation id (in `data.correlation_id`).
 *
 * Division of labour (so a model-call row always carries tokens — 002d AC-3): the
 * injected `traceAICall` writes decision rows for EVERY event type EXCEPT `model_call`;
 * the single token-bearing `model_call` row is written by the runtime LLM caller
 * (`llm-caller.ts`), which is the only place provider/model/token usage is known.
 */
import type { TraceAICall, TraceAICallOpts } from '@ciyp/agents';
import { withTenantTx } from './tenant-context.js';
import type { CiypScope } from './scope-resolver.js';

/** A credential-shaped substring scrubber for the persisted free-text fields. */
const CREDENTIAL_RE =
  /\b(sk-[a-z0-9-]{8,}|Bearer\s+[A-Za-z0-9._-]{8,}|eyJ[A-Za-z0-9._-]{10,}|[A-Za-z0-9_-]{0,4}(?:api[_-]?key|secret|password|token)[A-Za-z0-9_-]*\s*[:=]\s*\S+)/gi;

export function redactText(input: string): string {
  return input.replace(CREDENTIAL_RE, '[REDACTED]');
}

function redactData(data: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!data) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    out[k] = typeof v === 'string' ? redactText(v) : v;
  }
  return out;
}

/** The columns a decision/metering row can populate. member_id null ⇒ system trace. */
export interface AiTraceInput {
  eventType: string;
  memberId?: string | null;
  threadId?: string | null;
  messageId?: string | null;
  feature?: string | null;
  provider?: string | null;
  model?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  costMicros?: number | null;
  latencyMs?: number | null;
  data?: Record<string, unknown>;
}

// Fire-and-forget bookkeeping so tests can flush before asserting.
const pending = new Set<Promise<void>>();

/** Insert one ai_traces row under the scope's GUC fence. Errors are swallowed + warned. */
export function recordAiTrace(scope: CiypScope, correlationId: string, row: AiTraceInput): void {
  const p = withTenantTx(scope, async (client) => {
    await client.query(
      `insert into ai_traces
         (tenant_id, member_id, thread_id, message_id, event_type, feature,
          provider, model, prompt_tokens, completion_tokens, cost_micros, latency_ms, data)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`,
      [
        scope.tenantId,
        row.memberId ?? null,
        row.threadId ?? null,
        row.messageId ?? null,
        row.eventType,
        row.feature ?? null,
        row.provider ?? null,
        row.model ?? null,
        row.promptTokens ?? null,
        row.completionTokens ?? null,
        row.costMicros ?? null,
        row.latencyMs ?? null,
        JSON.stringify({ ...redactData(row.data), correlation_id: correlationId }),
      ],
    );
  }).catch((err: unknown) => {
    // Fire-and-forget: a trace failure must never fail the turn (FR-4).
    console.warn('[trace-sink] ai_traces write failed (swallowed):', (err as Error)?.message);
  });
  pending.add(p);
  void p.finally(() => pending.delete(p));
}

/** Await all in-flight trace writes (test seam — the user path never awaits). */
export async function flushTraces(): Promise<void> {
  await Promise.all([...pending]);
}

export interface TraceRecorderDeps {
  scope: CiypScope;
  correlationId: string;
  feature?: string;
}

/**
 * Build the `traceAICall` injected into the `@ciyp/agents` substrate. Writes a decision
 * row for every event type EXCEPT `model_call` (the LLM caller owns the token-bearing
 * model_call row). Re-throws the wrapped call's original error after tracing the failure.
 */
export function createTraceAICall(deps: TraceRecorderDeps): TraceAICall {
  return async function traceAICall<T>(opts: TraceAICallOpts<T>): Promise<T> {
    const started = Date.now();
    try {
      const result = await opts.call();
      if (opts.eventType !== 'model_call') {
        recordAiTrace(deps.scope, deps.correlationId, {
          eventType: opts.eventType,
          memberId: opts.memberId,
          threadId: opts.threadId,
          messageId: opts.messageId,
          feature: deps.feature,
          latencyMs: Date.now() - started,
          data: { ...opts.data, model_slot: opts.modelSlot ?? null },
        });
      }
      return result;
    } catch (err) {
      recordAiTrace(deps.scope, deps.correlationId, {
        eventType: opts.eventType,
        memberId: opts.memberId,
        threadId: opts.threadId,
        messageId: opts.messageId,
        feature: deps.feature,
        latencyMs: Date.now() - started,
        data: {
          ...opts.data,
          model_slot: opts.modelSlot ?? null,
          error: redactText((err as Error)?.message ?? String(err)),
        },
      });
      throw err;
    }
  };
}
