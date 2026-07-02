# Contract 05 — Entitlement

**Direction:** platform → UI · **Lives in:** `@stormforgeventures/ciyp-shared` · **Stability:** frozen at v1, additive-only.

What a member is entitled to, derived from **Stripe web checkout** (money flow a: Member → Coach, no native
IAP). The UI gates access on this; the engine checks it at session start (it does **not** put entitlement on
the per-turn hot path — that's the wallet's job, flow b).

## Endpoint

```
GET /v1/entitlement       (auth: member session; tenant + member from token)
→ 200 Entitlement
```

## Schema (zod / TS)

```ts
import { z } from 'zod';

export const Entitlement = z.object({
  memberId: z.string().uuid(),
  tenantId: z.string().uuid(),
  tierKey: z.string().nullable(),        // resolved tenant_tiers.key (ADR-002); null = no active tier
  status: z.enum(['active', 'trialing', 'past_due', 'canceled', 'expired', 'none']),
  features: z.array(z.string()),         // capability flags the tier grants (e.g. "voice", "uploads")
  currentPeriodEnd: z.string().datetime().nullable(),
  trialEnd: z.string().datetime().nullable(),
  source: z.literal('stripe'),           // v1: Stripe checkout only
});
export type Entitlement = z.infer<typeof Entitlement>;
```

## Field table

| Field | Type | Notes |
|---|---|---|
| `tierKey` | string? | the member's tier (de-enumed, ADR-002); drives `features` |
| `status` | enum | mirrors Stripe subscription state; `expired`/`none` → gated UI |
| `features[]` | string[] | capability flags (e.g. `voice`, `uploads`); UI shows/hides affordances |
| `currentPeriodEnd` | datetime? | when access lapses if not renewed |
| `trialEnd` | datetime? | for `trialing` |
| `source` | const `stripe` | v1 single source |

## Derivation & rules

- A Stripe **webhook** (idempotent on event id) updates the member's subscription rows; the entitlement
  read model is projected from those. Webhook handling carries a back-out path (additive; revert deploy).
- The engine checks entitlement **at session start** (chat thread open, voice session start), not per turn.
  An `expired`/`none` member is refused at start with a clear UI state (distinct from `spend_denied`, which
  is the coach's wallet running dry).
- Entitlement (flow a, member's access) and wallet (flow b, coach's AI credits) are **independent**: a member
  can be fully entitled while the coach's wallet is empty → `spend_denied` on spend-heavy calls; or a coach's
  wallet can be full while a member's entitlement lapsed → access refused. The UI distinguishes the two.

## Constraints for downstream

- The UI must distinguish **entitlement-expired** (member must renew with their coach) from **spend_denied**
  (coach's wallet — not the member's problem to fix; surfaced gently).
- No native IAP — checkout is web (Stripe). The Expo client opens web checkout; it does not implement IAP.
- Additive-only evolution; new `status`/`features` values are additive.
