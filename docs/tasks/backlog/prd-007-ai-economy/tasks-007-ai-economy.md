# Tasks — PRD-007 AI Economy (wallet · spend authorization · metering)

> Source: prd-007-ai-economy-index.md + sub-PRDs a–c. Depends on PRD-001 (ledger schema/seed), PRD-002d
> (trace cost columns), PRD-006a (admin shell for screens). Order per index priority: 1.0 → 2.0 (metering)
> → 3.0 (authorization). PRD-004b consumes 3.0 at a wave boundary — never in the same wave (shared
> SpendAuthorizer seam, `Modified here` collision with 002b's stub).

## Relevant Files

- (kept current by build-run)

## Tasks

- [ ] 1.0 Wallet, ledgers, Stripe recharge — the money substrate (maps to: 007a FR-1..8 / AC-007-ai-economy-06..-13, index AC-2/AC-4/AC-5 → -02/-04/-05)
  - [ ] 1.1 Wallet behavior binding: one wallet per tenant, balance materialized-only (same-transaction re-materialize on every ledger write + 007b cache invalidation hook), append-only grants verified, compensating `adjustment` rows (reason + corrects ref) — verify: 007a AC-1/AC-4/AC-5
  - [ ] 1.2 Stripe top-up: checkout session endpoint, signature-verified idempotent webhook (`stripe_events` dedupe), balance re-materialization — verify: AC-2/AC-3 test-mode round-trip
  - [ ] 1.3 Auto-recharge (off by default): threshold trigger post-debit, off-session payment, `recharge_failed` state + admin notification, operator-retriggered retries — verify: AC-6 failure-path test
  - [ ] 1.4 Wallet screens (balance card state machine active/low/paused/recharge_failed, paginated running-balance ledger, top-up flow, auto-recharge settings) + superadmin economy config endpoint (markup, credit unit, low-balance threshold; OQ-3 placeholder) — verify: AC-7/AC-8 seed-rendered Playwright; wire live + seed + Figma self-diff
- [ ] 2.0 Metering pipeline + platform pricebook (maps to: 007c FR-1..7 / AC-007-ai-economy-22..-29, index AC-3 → -03)
  - [ ] 2.1 Emitter: outbox off the trace write, deterministic `idempotencyKey` from trace id, at-least-once redelivery — verify: 007c AC-1
  - [ ] 2.2 Rollup consumer: insert-if-unseen on `idempotencyKey`, replay no-op — verify: AC-2 full-replay test + AC-8 append-only rejection
  - [ ] 2.3 Pricebook: versioned entries + superadmin CRUD; pricing at ledger write (`priced_cost_micros` + `pricebook_version` on the row; pricebook wins over nonzero traced cost per Q-1, variance >20% flagged); zero-cost/unlisted → `pricing_exceptions` (never silent zero-bill) + resolve flow — verify: AC-3/AC-4/AC-5; seed pricebook covers all seed models
  - [ ] 2.4 Debit conversion `ceil(priced × markup / credit_micro_value)` → `usage_debit` ledger row; ops surface (rollup lag, drift, exceptions on superadmin panel) — verify: AC-6 property test + AC-7; module AC-3/AC-4 invariants green on seed
- [ ] 3.0 Spend authorization service — contract 04 real (maps to: 007b FR-1..8 / AC-007-ai-economy-14..-21, index AC-1 → -01)
  - [ ] 3.1 Cheap path: Valkey cached balance (TTL 15s default), optimistic debit, overspend floor (OQ-4 conservative default, config), deny below floor; zero Postgres on the authorize path — verify: 007b AC-5/AC-6 instrumented tests
  - [ ] 3.2 Heavy path: atomic single-statement check-and-reserve (`spend_reservations`), settle/release semantics (Usage Event stays billing truth), TTL sweep for dangling holds — verify: AC-2/AC-3 concurrency + AC-4 sweep
  - [ ] 3.3 `recheck(authToken)` interval hook (PRD-004b's checkpoint consumer), `tenant_suspended` hard deny both paths, every denial traced as governance event — verify: AC-8 + denial-trace test
  - [ ] 3.4 Fill the 002b SpendAuthorizer stub (port + internal HTTP mirror for apps/voice) + reconcile job (cache vs materialized, drift metric) + write-through invalidation from 1.1 — verify: AC-1/AC-7; module AC-1/AC-2 end-to-end (deny → top-up → allow) on seed edge shapes

## Wave candidates

- 1.0 → 2.0 → 3.0 strictly sequential within the module (each enforces against the previous layer's truth).
- 1.4/2.3's screens need PRD-006a's shell (`Required`, not modified) — UI sub-tasks can trail in a later
  wave than their service sub-tasks if shell timing demands.
- Cross-PRD: 3.4 replaces the 002b stub (`Modified here`) — PRD-002 must be merged first and PRD-004b must
  consume in a LATER wave. 2.x depends on 002d's trace columns (`Required`).
- Plan-gate checkbox (007c Q-3): ratify ledger-side pricebook pricing (contract 03 unchanged) with Tim.
