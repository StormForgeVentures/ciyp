# PRD-007: AI Economy — Wallet, Spend Authorization, Metering

> Source: docs/project-brief.md + docs/architecture.md | Folder location = lifecycle status (do not add a Status field)

## Overview

### Goals

This module makes money flow (b) real: coaches prepay AI credits into a per-tenant wallet, every AI
decision the platform executes is metered from `ai_traces` into append-only ledgers, and spend is
enforced — hard-gated on spend-heavy calls, cache-authorized on cheap ones. It addresses three distinct
concerns: (1) an auditable, replay-safe money trail (wallet + ledgers + Stripe recharge), (2) a
spend-authorization seam that enforces balance without putting the wallet on the P0 voice/chat hot path,
and (3) a metering pipeline that converts traced usage into correctly-priced credit debits. It unblocks
hard enforcement in PRD-004b (voice) and gives coaches the funding/monitoring surface the v1 success
criteria require.

### Scope

| In scope | Out of scope |
|----------|--------------|
| Per-tenant wallet with materialized credit balance | Post-paid / invoice billing (prepaid only — brief non-goal) |
| Append-only `wallet_ledger` + `usage_ledger` with compensating-row corrections | Native IAP or any member-facing payment (flow (a) is PRD-008) |
| Stripe top-up checkout + idempotent webhook + optional auto-recharge | Member-visible credits or member billing UX (flow (c): members never see credits) |
| Spend-authorization service implementing contract 04 (cheap cache path + heavy hard check) | Per-member spend limits (v1 enforces at tenant level only) |
| Usage-event pipeline implementing contract 03 (`ai_traces` → `usage_ledger` → `wallet_ledger`) | Editing frozen contract 03/04 schemas (additive-only; pricing is ledger-side) |
| Platform pricebook for re-pricing off-table (zero-cost-traced) models | Usage analytics dashboards (P1, classification #17) |
| Per-tenant markup / credit-unit configuration | Dunning, refunds-to-card, tax handling (operator handles manually in v1) |
| Coach wallet screens in `apps/web` (balance, ledger, top-up) | Superadmin cross-tenant finance reporting (P1) |

## Sub-PRDs

| Sub-PRD | File | Scope (one line) |
|---------|------|------------------|
| 007a | `prd-007a-ai-economy-wallet.md` | Wallet + append-only ledger + Stripe recharge + markup config + coach wallet UI |
| 007b | `prd-007b-ai-economy-spend-authorization.md` | Contract 04 service: cheap cached authorize, heavy hard check/reserve/settle, reconcile |
| 007c | `prd-007c-ai-economy-metering.md` | Contract 03 pipeline: usage events, idempotent rollup, pricebook pricing, credit debit |

## Personas

- **Coach** — admin of one tenant; funds the wallet, monitors balance and burn, sets auto-recharge. Never
  touches raw provider cost; sees credits only.
- **Luminify operator** — platform superadmin; sets per-tenant markup and credit unit value, maintains the
  platform pricebook, investigates metering drift.
- **Member** — never sees credits or billing. Experiences enforcement only as the contract-02
  `spend_denied` / wallet-paused UX. (Asserted as a non-goal; no member surface exists in this module.)
- **Developer agents** — build against contracts 03/04 and the Sport `SpendAuthorizer` port; consume the
  deterministic enforcement tests as the module's verification bar.

## Module-level acceptance criteria

| # | Given / When / Then |
|---|---------------------|
| AC-1 | Given the seeded near-zero-wallet tenant, when a voice session start requests heavy authorization (contract 04), then the response is `allow=false, reason='insufficient_balance'` and no session starts. |
| AC-2 | Given that same tenant, when a Stripe test-mode top-up checkout completes and its webhook is processed, then a `wallet_ledger` credit row exists, `wallets.balance_credits` re-materializes, and a retried heavy authorize returns `allow=true`. |
| AC-3 | Given the seed's `ai_traces` rows, when the usage-event emitter runs twice over the same traces (replay), then `usage_ledger` contains exactly one row per `idempotencyKey` and total debited credits are unchanged by the replay. |
| AC-4 | Given any point after pipeline processing, when `wallets.balance_credits` is compared to `SUM(wallet_ledger)` for every tenant, then the values are equal (materialization invariant). |
| AC-5 | Given a Stripe webhook delivered twice with the same event id, then exactly one `wallet_ledger` credit row exists for that event. |

## Core UX per Surface

- **apps/web (coach admin)** — a Wallet section: balance card (credits, low-balance warning state),
  append-only transaction ledger (top-ups, debits by feature, compensating adjustments), a top-up flow that
  hands off to Stripe Checkout and returns to a confirmation state, and auto-recharge settings
  (threshold + amount). Dense data-table feel; no charts in v1 (analytics is P1).
- **apps/web (superadmin)** — per-tenant economy panel: markup multiplier, credit unit value, pricebook
  table (per-model rates, versioned), reconcile-drift readout.
- **Member surfaces** — none. Enforcement reaches members only through contract-02 error parts rendered by
  the template app.

## Technical Considerations

This module implements ADR-003 verbatim; the decisions below are the ones downstream agents can silently
break.

### Ledger is truth; balance is a cache

`wallets.balance_credits` is derived exclusively by materialization from `wallet_ledger` (ADR-003 §3).
Any code path writing the balance directly is a defect. Corrections are compensating rows — `UPDATE`/
`DELETE` on either ledger table is prohibited and should be revoked at the DB-grant level (001b schema).

### Pricebook pricing at the ledger, not the wire (plan-gate decision)

Sport traces honest zero `cost_micros` for models Pi has no price row for (e.g. OpenRouter-routed models —
architecture §5.4, OQ-A). Contract 03 stays frozen: `costMicros` remains "raw cost as traced" on the wire
and is treated as **advisory**. The ledger re-prices every event from token/unit counts against a
**versioned platform pricebook**, recording `priced_cost_micros` + `pricebook_version` on the
`usage_ledger` row. Credits are computed from `priced_cost_micros`. See 007c; flagged for the plan gate per
the 2026-07-02 architecture reconciliation.

### The wallet stays off the hot path

Cheap-call authorization is cache-local with optimistic debit and a bounded overspend tolerance (OQ-4);
only spend-heavy operations pay a synchronous ledger read (ADR-003 §4). Anyone "simplifying" cheap calls
into a synchronous check re-introduces the latency ADR-003 explicitly rejected.

### Security

All wallet/ledger/pricebook endpoints are coach-admin- or superadmin-gated within the tenant fence (RLS,
two-layer per architecture §4.1); markup/pricebook writes are superadmin-only. Stripe webhooks verify
signatures and dedupe on event id. No raw provider cost or pricebook rates are exposed to coach-facing
endpoints (coaches see credits only). Spend-authorization endpoints are internal-only (service-to-service
within the engine; never exposed to clients). Rate-limit top-up creation per tenant.

## Dependencies

| Dependency | Source | Status |
|------------|--------|--------|
| `wallets`, `wallet_ledger`, `usage_ledger`, `stripe_*` tables | PRD-001b schema | Required |
| Seed wallet/ledger rows + near-zero-wallet member edge shape | PRD-001c seed | Required |
| `ai_traces` cost columns (`provider`, `model`, tokens, `cost_micros`, `feature`) | PRD-002d | Required |
| Sport `SpendAuthorizer` port shape | ADR-006 / PRD-002b (stub consumer) | Modified here (real implementation) |
| Contract 03 / 04 zod schemas in `@ciyp/shared` | PRD-001a | Required |
| Valkey (cheap-path balance cache) | PRD-002 infra | Available |
| Heavy-check consumer (voice session start / checkpoint) | PRD-004b | Consumer (builds against 007b) |

## Non-Goals

- Members never see, hold, or pay credits (flow (c): the coach's wallet funds all member usage).
- No post-paid billing, invoicing, or collections in v1.
- No per-member or per-feature budget caps in v1 (tenant-level enforcement only).
- No changes to frozen contracts 03/04 (pricing fields live on ledger rows, not the wire event).
- No usage analytics dashboards (P1, classification #17).

## Success Metrics

- 100% of seed `ai_traces` rows produce exactly one `usage_ledger` row (idempotent under replay).
- Zero balance/ledger drift after the reconcile job on the seed dataset.
- Heavy-call enforcement demonstrated end-to-end on the seed (deny → top-up → allow), matching v1 success
  criterion #4.
- Cheap-call authorization adds no wallet round-trip on the chat path (verified by trace timing, not
  adjectives: authorize is cache-local).

## Implementation Priority

1. **007a wallet + ledgers + Stripe recharge** — the substrate everything debits into; unblocks seed
   verification and the materialization invariant.
2. **007c metering pipeline + pricebook** — turns already-flowing traces (PRD-002d) into debits; proves
   idempotency before any enforcement depends on balances.
3. **007b spend authorization** — last because it needs real balances (007a) and real debits (007c) to
   enforce against; PRD-004b consumes it at the wave boundary.

## Related

- Task list: `tasks-007-ai-economy.md` (this folder — generate-tasks output)
- QA report: `qa/qa-007-ai-economy.md` (authored by the qa-reviewer, NOT the PM)
- Acceptance ledger: `handoff/acceptance-ledger.md` (`AC-007-ai-economy-NN` rows)
