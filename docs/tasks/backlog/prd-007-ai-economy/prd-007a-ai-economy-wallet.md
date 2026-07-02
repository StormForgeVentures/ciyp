# PRD-007a: Wallet, Ledger & Stripe Recharge

> Parent: prd-007-ai-economy-index.md | Module: AI Economy — Wallet, Spend Authorization, Metering

## Goal

Deliver the prepaid wallet itself: one wallet per tenant, an append-only credit ledger that is the billing
authority, Stripe-powered top-ups with idempotent webhook processing and optional auto-recharge, per-tenant
markup/credit-unit configuration, and the coach-facing wallet screens in `apps/web`. This is the substrate
the metering pipeline (007c) debits and the authorization seam (007b) enforces against.

## Functional requirements

1. Exactly one `wallets` row per tenant, created at provisioning; `balance_credits` is derived only by
   materialization from `wallet_ledger` (never written directly by application handlers).
2. `wallet_ledger` is append-only: entry kinds `topup`, `usage_debit`, `adjustment` (compensating row,
   positive or negative, requires an operator `reason` and a reference to the corrected row). No handler
   performs `UPDATE`/`DELETE` on ledger tables; DB grants for the app role exclude both.
3. Stripe top-up: coach picks/enters a credit amount → Stripe Checkout session (web) → webhook
   (`checkout.session.completed`) writes one `wallet_ledger` credit row keyed to the Stripe event id →
   balance re-materializes. Webhook processing is idempotent on the Stripe event id.
4. Auto-recharge (per-tenant, optional, off by default): when materialized balance crosses
   `auto_recharge_threshold_credits`, create an off-session top-up for `auto_recharge_amount_credits`
   using the tenant's saved payment method; failures mark the wallet `recharge_failed` and notify the
   coach admin; retries are operator-triggered in v1 (no dunning automation).
5. Per-tenant economy config: `markup_multiplier` and `credit_micro_value` (ADR-003 §2), superadmin-only
   writes, read by 007c at debit time. Seed carries the OQ-3 placeholder default.
6. Low-balance warning state: wallet UI and an admin notification fire when balance <
   `low_balance_threshold_credits` (per-tenant, default set with the seed); this is the coach-facing
   mitigation for the ADR-003 mid-session-cut UX edge.
7. Coach wallet screens in `apps/web`: balance card (normal / low / paused / recharge_failed states),
   paginated ledger view (kind, credits delta, feature attribution for debits, timestamp, running
   balance), top-up flow, auto-recharge settings.
8. Every ledger write re-materializes `wallets.balance_credits` in the same transaction and invalidates
   the 007b cheap-path balance cache for that tenant.

## Acceptance criteria

| # | Given / When / Then |
|---|---------------------|
| AC-1 | Given a provisioned tenant, then exactly one `wallets` row exists for it and `balance_credits` equals `SUM(wallet_ledger.credits_delta)` for that tenant. |
| AC-2 | Given a completed Stripe test-mode checkout, when the `checkout.session.completed` webhook is processed, then one `wallet_ledger` row with kind `topup` exists referencing the Stripe event id, and the balance increases by the purchased credits. |
| AC-3 | Given that webhook delivered again with the same event id, then no second ledger row is written. |
| AC-4 | Given any ledger table, when the application DB role attempts `UPDATE` or `DELETE` on a row, then the statement is rejected by the database. |
| AC-5 | Given an erroneous debit row, when an operator posts an `adjustment` with a `reason` and `corrects_ledger_id`, then the balance reflects the compensation and the original row is unchanged. |
| AC-6 | Given a tenant with auto-recharge enabled and a balance crossing below its threshold after a debit, then an off-session top-up attempt is recorded; on payment failure the wallet state is `recharge_failed` and an admin notification row exists. |
| AC-7 | Given the seeded Luminify tenant, when the coach opens the wallet screen, then balance, at least one seeded top-up, and at least one seeded usage debit render from ledger rows (no hardcoded values). |
| AC-8 | Given a balance below `low_balance_threshold_credits`, then the balance card renders its low state and a coach notification exists. |

## Data requirements

Schema is created in PRD-001b; this sub-PRD binds behavior to it. Key fields (see 001b for full DDL):

| Table | Fields (behavioral contract) |
|---|---|
| `wallets` | `tenant_id` (pk/fk), `balance_credits` (derived), `state` (`active/paused/recharge_failed`), `low_balance_threshold_credits`, `auto_recharge_enabled/threshold/amount`, `markup_multiplier`, `credit_micro_value` |
| `wallet_ledger` | `id`, `tenant_id`, `kind` (`topup/usage_debit/adjustment`), `credits_delta` (signed), `usage_ledger_id?`, `stripe_event_id?` (unique where present), `corrects_ledger_id?`, `reason?`, `created_at` |
| `stripe_events` | raw event archive, `event_id` unique — the webhook dedupe backstop |

## Endpoints

- `POST /admin/wallet/topup-session` — coach-admin; body `{credits}`; creates Stripe Checkout session;
  returns redirect URL. Errors: `invalid_amount`, `stripe_unavailable`.
- `POST /webhooks/stripe` — public, signature-verified; routes `checkout.session.completed` (top-up) and
  payment-failure events (auto-recharge); idempotent on event id; 2xx-always after durable receipt.
- `GET /admin/wallet` — coach-admin; balance card payload (balance, state, thresholds, auto-recharge
  config).
- `GET /admin/wallet/ledger?cursor=` — coach-admin; paginated ledger rows with running balance.
- `PUT /admin/wallet/auto-recharge` — coach-admin; `{enabled, threshold, amount}`.
- `PUT /superadmin/tenants/:id/economy` — superadmin; `{markup_multiplier, credit_micro_value,
  low_balance_threshold_credits}`.
All tenant-fenced via RLS + role middleware; superadmin route additionally role-gated.

## UI/UX

**Wallet screen (`apps/web` → Wallet)** — coach lands on the balance card with primary actions Top up and
Auto-recharge settings; ledger table below.

```
┌──────────────────────────────────────────────────────┐
│ Wallet                                                │
│ ┌──────────────────────┐  ┌────────────────────────┐ │
│ │ 12,450 credits       │  │ Auto-recharge: ON      │ │
│ │ state: ● active      │  │ below 2,000 → +10,000  │ │
│ │ [Top up credits]     │  │ [Edit settings]        │ │
│ └──────────────────────┘  └────────────────────────┘ │
│ Ledger                                                │
│ ┌────────────────────────────────────────────────────┐│
│ │ date       kind        feature   Δcredits  balance ││
│ │ 07-01      usage_debit voice       -320    12,450  ││
│ │ 07-01      topup       —        +10,000    12,770  ││
│ │ ...                                                ││
│ └────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────┘
```

Key behaviors: balance card state machine (`active` → `low` when below threshold → `paused` at zero →
`recharge_failed` on failed auto-recharge); Top up hands off to Stripe Checkout and returns to a
confirmation banner; ledger is read-only.

## Hybrid Interface

Not applicable — Traditional lane (classification #12).

## Dependencies

| Dependency | Source | Status |
|------------|--------|--------|
| `wallets` / `wallet_ledger` / `stripe_events` DDL | PRD-001b | Required |
| Seeded wallet + ledger rows, near-zero-wallet edge shape | PRD-001c | Required |
| Stripe account + test keys | Operator env | Required |
| Cheap-path cache invalidation hook | PRD-007b | Created here (invoked on ledger write) |
| Admin app shell + auth/roles | PRD-006a | Required |

## Open questions

| # | Question | Why it matters | Resolution |
|---|----------|----------------|------------|
| Q-1 | Default `markup_multiplier` / `credit_micro_value` (architecture OQ-3)? | Pricing is Tim's business knob; seed needs a number. | **Decided (Tim, plan gate 2026-07-02): default markup = 1.1×** (1 credit = 1,000 micros stands). Rationale: coaches may later stack their own margin (parked passthrough PRD). Per-tenant, changeable anytime. |
| Q-2 | Is `paused` wallet state coach-visible only, or also surfaced to members proactively? | Contract 02 already carries `spend_denied`; a pre-emptive member banner is template-side scope. | Deferred to ciyp-template build; engine exposes wallet state on Instance Config already-frozen fields only. |
