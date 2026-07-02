# Contract 03 — Usage Event

**Direction:** runtime → ledger (internal to the engine) · **Lives in:** `@stormforgeventures/ciyp-shared`
**Delivery:** at-least-once + **idempotent** (dedupe on `idempotencyKey`). · **Stability:** frozen at v1, additive-only.

Emitted by the AI runtime for **every** billable AI decision (sourced from the extended `ai_traces` row,
ADR-003 §1). Flows into `usage_ledger`, then debits `wallet_ledger`. Because delivery is at-least-once, the
ledger upserts on `idempotencyKey` so a retried emit never double-debits.

## Schema (zod / TS)

```ts
import { z } from 'zod';

export const UsageFeature = z.enum([
  'chat', 'voice', 'transcription', 'embedding', 'rerank', 'classify', 'cadence', 'memory_recall', 'tts',
]);

export const UsageEvent = z.object({
  idempotencyKey: z.string(),        // deterministic from trace id; the dedupe key
  tenantId: z.string().uuid(),       // whose wallet gets debited (the member's coach — flow c)
  memberId: z.string().uuid().nullable(), // null for tenant-level/system calls
  traceId: z.string().uuid(),        // the ai_traces row this came from
  feature: UsageFeature,
  provider: z.string(),              // e.g. "openrouter" | "voyage" | "deepgram" | "fish-audio"
  model: z.string(),                 // resolved model name from the tenant's slot
  promptTokens: z.number().int().nonnegative().default(0),
  completionTokens: z.number().int().nonnegative().default(0),
  units: z.number().nonnegative().default(0),   // non-token meters (audio seconds, chars) where applicable
  costMicros: z.number().int().nonnegative(),   // RAW provider cost, micro-units
  occurredAt: z.string().datetime(),
  spendClass: z.enum(['cheap', 'heavy']),       // routes enforcement (ADR-003 §4)
});
export type UsageEvent = z.infer<typeof UsageEvent>;
```

## Field table

| Field | Type | Notes |
|---|---|---|
| `idempotencyKey` | string | **dedupe key**; deterministic from `traceId` (+ retry-safe). Ledger upserts on it. |
| `tenantId` | uuid | the wallet to debit (flow c: always the member's coach) |
| `memberId` | uuid? | the member who triggered it; null for system/tenant calls |
| `traceId` | uuid | back-reference to the `ai_traces` row (audit join) |
| `feature` | enum | what was spent on; drives reporting + spend class |
| `provider` / `model` | string | resolved from the tenant's `app_config` slot |
| `promptTokens` / `completionTokens` | int | LLM token meters |
| `units` | number | non-token meters (e.g. audio seconds for STT/TTS) |
| `costMicros` | int | **raw** provider cost; credit conversion happens at ledger write (markup is per-tenant config) |
| `occurredAt` | datetime | event time |
| `spendClass` | enum | `cheap` (cache-authorized) vs `heavy` (hard-checked) — ADR-003 |

## Processing rules

1. Emit one event per billable trace. **No AI call bypasses this** (ADR-003 constraint).
2. Consumer upserts into `usage_ledger` on `idempotencyKey` (append-only; the upsert is "insert if key
   unseen", never an update of a prior row).
3. Convert to credits at write time:
   `creditsDebited = ceil(costMicros × tenant.markupMultiplier / tenant.creditMicroValue)`.
4. Write a `wallet_ledger` debit (append-only) referencing the `usage_ledger` row; re-materialize
   `wallets.balance_credits`.

## Constraints for downstream

- **Idempotent on `idempotencyKey`** — at-least-once delivery must never double-debit.
- `costMicros` is **raw provider cost**; credit/markup conversion is a ledger-side concern, not the emitter's.
- Events are append-only downstream; corrections are compensating ledger rows (ADR-003).
- Additive-only evolution (new optional fields OK; new `feature`/`spendClass` values are additive).
