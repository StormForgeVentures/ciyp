# Contract 04 — Spend Authorization

**Direction:** runtime ↔ wallet (internal to the engine) · **Lives in:** `@stormforgeventures/ciyp-shared`
**Stability:** frozen at v1, additive-only. · **Backing design:** ADR-003 §4.

The seam that authorizes every AI turn against the wallet **without** a per-turn round-trip on cheap calls,
while hard-gating spend-heavy calls. Two call shapes share one schema, distinguished by `spendClass`.

## Schema (zod / TS)

```ts
import { z } from 'zod';

export const AuthorizeRequest = z.object({
  tenantId: z.string().uuid(),
  feature: z.string(),                 // mirrors UsageFeature
  spendClass: z.enum(['cheap', 'heavy']),
  estimatedCostMicros: z.number().int().nonnegative(), // best-effort pre-estimate
});

export const AuthorizeResponse = z.object({
  allow: z.boolean(),
  remainingCredits: z.number(),        // post-authorization estimate (may be optimistic for cheap)
  reason: z.enum(['ok', 'insufficient_balance', 'tenant_suspended']).default('ok'),
  // for heavy calls only: a handle to settle/release the reservation
  authToken: z.string().nullable(),
});
export type AuthorizeResponse = z.infer<typeof AuthorizeResponse>;

// heavy calls reconcile actual spend after the call (or release on failure/short session)
export const SettleRequest = z.object({
  authToken: z.string(),
  actualCostMicros: z.number().int().nonnegative(),
});
```

## Behavior by spend class

| spendClass | Source of truth at authorize | Round-trip? | Enforcement |
|---|---|---|---|
| `cheap` (chat, classify, embed) | **per-tenant cached balance** (short TTL) | **No** — hot-path local | optimistic debit; reconciled against ledger; **bounded** overspend tolerated (ADR-003 §4 / OQ-4) |
| `heavy` (voice, transcription, deep model) | **ledger-materialized balance** | **Yes** — synchronous hard check | denied if insufficient; long sessions re-check at interval (OQ-5); cut at checkpoint on drain |

## Methods

```
authorize(req: AuthorizeRequest): AuthorizeResponse
  - cheap : read+debit cache; allow unless bounded floor breached; return remaining (optimistic)
  - heavy : read ledger balance; if >= estimate → reserve, return authToken + allow; else allow=false, reason

settle(req: SettleRequest): void        // heavy only — replace reservation with actual; emits the Usage Event truth
release(authToken: string): void        // heavy only — call never happened / session short; free the reservation
```

## Constraints for downstream

- **Cheap calls never block on the wallet** — authorize against the cache, reconcile async. This protects
  P0 voice and chat latency.
- **Heavy calls always hard-check** before starting and **must** `settle()` or `release()` — a dangling
  reservation must time out and auto-release.
- A `false`/`insufficient_balance` on a heavy call surfaces to the UI as `spend_denied` (contract 02).
- The **ledger is the billing authority**; this contract's `remainingCredits` is advisory for cheap calls.
- `tenant_suspended` is a hard stop independent of balance (e.g. payment dispute) — additive reason, may
  expand.
