# PRD-008a: Program-Access Store (Stripe checkout → entitlement)

> Parent: prd-008-store-provisioning-index.md | Module: Program-Access Store & Instance Provisioning

## Goal

Let a buyer purchase program access from a coach through Stripe web checkout and have that purchase become
an entitlement the whole system honors: the member UI gates screens on it (contract 05), and the engine
refuses non-entitled members at session start. This is money flow (a) — member → coach — end to end, with
no native IAP anywhere (binding decision #3) and a single program-access SKU per tenant in v1.

## Functional requirements

1. Each tenant has exactly one program-access product/price pair in Stripe (created at provisioning, 008b)
   — **on the coach's own Stripe account, accessed via the coach-Stripe connector (ADR-008: restricted
   API key on the PRD-005c framework)**; the store exposes a checkout-session creation endpoint that
   resolves the tenant's SKU — the client never passes a price id.
2. Checkout runs as Stripe **web** checkout (hosted page) created **on the coach's account through the
   connector port** (funds settle to the coach; no platform fee; member money never touches the platform
   account — ADR-008). Success/cancel URLs return the member to the client surface. The Expo client opens
   it in a browser; no IAP code paths exist. Webhooks: a per-tenant endpoint is created on the coach's
   account at connect time; events are signature-verified with that tenant's vault-held signing secret and
   resolve to the tenant by endpoint identity.
3. A Stripe webhook receiver verifies signatures, deduplicates on Stripe event id, and persists relevant
   subscription/checkout events; the entitlement read model is **projected** from those rows (rebuildable).
4. Entitlement resolution implements contract 05 exactly: `tierKey` from `tenant_tiers` (ADR-002),
   `status` mirroring Stripe subscription state, `features[]` from the tier's `entitlements_jsonb`,
   `currentPeriodEnd`/`trialEnd`, `source: 'stripe'`.
5. `GET /v1/entitlement` (member session auth) returns the member's entitlement; tenant + member always
   derive from the token.
6. The engine checks entitlement at **session start only** (chat thread open, voice session start): status
   `expired`/`none`/`canceled` → refusal with the entitlement-expired state, which the wire distinguishes
   from `spend_denied` (contract 05 constraint).
7. Expiry and revocation: subscription lapse (`currentPeriodEnd` passed without renewal) and Stripe
   cancellation both transition the projection so the next session-start check refuses; no live-session
   termination on entitlement change in v1.
8. All rows are tenant-scoped with RLS; entitlement reads for a member never expose another member's rows.
9. **External enrollment API (plan-gate addition, Tim 2026-07-02):** a tenant-scoped, API-key-authenticated
   endpoint (`POST /v1/external/entitlements`) grants or revokes an entitlement for a member by
   email/external ref — the hook for coaches enrolling members from outside systems (e.g. GoHighLevel
   workflows). Grants carry `source: 'api'` (enum extended from `stripe_checkout | manual`), an idempotency
   key, and land in the same projection the session-start gate reads. Per-tenant API keys are
   operator-issued at provisioning, revocable, and never member-scoped.

## Acceptance criteria

Each verifiable by an agent. These become `AC-008-store-provisioning-NN` rows at generate-tasks time.

| # | Given / When / Then |
|---|---------------------|
| AC-1 | Given a seeded member with no entitlement, when a Stripe test-mode checkout session is created for them, then the session references the member's tenant's single program-access price and carries the member id in metadata. |
| AC-2 | Given a completed test-mode checkout, when the `checkout.session.completed` webhook is delivered, then an entitlement projection exists with `status: 'active'` and the tenant's `tierKey`. |
| AC-3 | Given the same webhook event delivered twice, when both are processed, then exactly one set of subscription rows exists (event-id dedupe) and the entitlement is unchanged by the replay. |
| AC-4 | Given an entitled member, when `GET /v1/entitlement` is called with their session, then the response validates against the contract 05 zod schema. |
| AC-5 | Given the seed's expired-entitlement member, when they open a chat thread, then the open is refused with the entitlement-expired state and no AI turn executes (no `ai_traces` row for the attempt). |
| AC-6 | Given the seed's expired-entitlement member and a fully funded tenant wallet, when they start a voice session, then the refusal is entitlement-expired, not `spend_denied`. |
| AC-7 | Given an active subscription whose `currentPeriodEnd` is moved into the past (test fixture), when the member next opens a session, then the start is refused and `GET /v1/entitlement` returns `status: 'expired'`. |
| AC-8 | Given a member of tenant A, when they request `/v1/entitlement`, then no tenant-B row is readable even with a forged `tenant_id` parameter (tenant derives from token; RLS test). |
| AC-9 | Given a valid tenant API key, when `POST /v1/external/entitlements` grants access for a member, then the member's next `GET /v1/entitlement` returns `status: 'active'` with `source: 'api'`; given the same request replayed with the same idempotency key, then exactly one grant exists; given tenant A's key used against a tenant-B member ref, then the request is rejected with no row written. |

## Data requirements

Per `../../../.claude/references/pm/data-model-and-api-specs.md`; tables created in PRD-001b, consumed/populated here.

- **`stripe_webhook_events`** — `id` (uuid pk), `stripe_event_id` (text, unique — the dedupe key),
  `tenant_id` (uuid, fk, indexed), `type` (text), `payload` (jsonb), `processed_at` (timestamptz).
  Append-only; the replay/rebuild source.
- **`member_subscriptions`** — `id` (uuid pk), `tenant_id` (uuid, fk, indexed), `member_id` (uuid, fk,
  indexed), `stripe_customer_id` / `stripe_subscription_id` (text), `tier_id` (uuid fk → `tenant_tiers`),
  `status` (text — Stripe status verbatim), `current_period_end` / `trial_end` (timestamptz, nullable),
  `updated_from_event_id` (text — audit join to webhook events). Unique on `(tenant_id, member_id,
  stripe_subscription_id)`.
- **Entitlement** is computed (projection) — no separate table in v1; resolution reads
  `member_subscriptions` + `tenant_tiers` and maps to the contract 05 shape. If P95 requires it later, a
  materialized projection is an additive change.

## Endpoints

- `POST /v1/checkout-session` — auth: member session. Body: none (SKU resolved from tenant). Returns
  `{ url }` (Stripe-hosted checkout). Errors: `409` if already active, `503` if tenant Stripe objects
  missing (unprovisioned).
- `POST /webhooks/stripe` — public route, Stripe signature verified; 2xx on handled AND on
  deduped-replay; non-2xx only on signature failure or persist error (Stripe retries). Handles
  `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`.
- `GET /v1/entitlement` — contract 05 verbatim (member session auth; tenant + member from token).
- Internal: `checkEntitlementAtSessionStart(memberId, tenantId) → { allowed, status }` — library function
  used by PRD-003a (thread open) and PRD-004b (voice session start); not an HTTP endpoint.

## UI/UX

No frontend changes in this repo's surfaces beyond admin read-only status (member list column, PRD-006a
owns that screen). The purchase/renewal UX renders in `ciyp-template` against contract 05; this sub-PRD
supplies the states it binds to: `active | trialing | past_due | canceled | expired | none`, and the
constraint that entitlement-expired copy names the coach and never mentions credits/wallet.

## Hybrid Interface

Not applicable — Traditional lane (feature #14; no generation in the loop).

## Dependencies

| Dependency | Source | Status |
|------------|--------|--------|
| `member_subscriptions`, `stripe_webhook_events`, `tenant_tiers` | PRD-001b migration | Required |
| Contract 05 zod schema | `@ciyp/shared` (PRD-001a) | Required |
| Seed expired-entitlement member | PRD-001c | Required |
| Session-start hook points (thread open / voice start) | PRD-003a / PRD-004b | Modified here (they call the gate) |
| Tenant Stripe product/price objects | PRD-008b provisioning step 4 | Required |

## Open questions

| # | Question | Why it matters | Resolution |
|---|----------|----------------|------------|
| Q-1 | Is v1's SKU a subscription or a one-time purchase (or per-tenant choice)? | Drives which Stripe objects provisioning creates and how `currentPeriodEnd` behaves for one-time buys. | **Decided (Tim, plan gate 2026-07-02): subscription is the built-in default; coaches may also sell flat-fee or grant access free (manual/API grant covers both). External enrollment API added as FR-9.** Coach→member token-cost passthrough (coach's own markup on usage) is PARKED as a post-v1 PRD — schema must not preclude it. |
| Q-2 | Does `past_due` retain access? | Grace-period behavior is coach-visible policy. | Interim: `past_due` retains access until `currentPeriodEnd`; revisit with real dunning data. |
