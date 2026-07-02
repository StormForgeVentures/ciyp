# PRD-007c: Metering Pipeline & Platform Pricebook

> Parent: prd-007-ai-economy-index.md | Module: AI Economy — Wallet, Spend Authorization, Metering

## Goal

Implement the contract 03 pipeline: every billable `ai_traces` row becomes exactly one Usage Event
(at-least-once delivery, idempotent rollup), lands append-only in `usage_ledger`, is priced against a
versioned platform pricebook, and debits `wallet_ledger` at the tenant's markup. The pricebook is the
load-bearing addition: Sport traces honest-zero `cost_micros` for models Pi has no price row for
(OpenRouter-routed models — architecture §5.4, OQ-A), so the wire event's `costMicros` is treated as
**advisory** and the ledger re-prices from token/unit counts. Contract 03 stays frozen; pricing is a
ledger-side concern.

## Functional requirements

1. **Emitter:** for every billable `ai_traces` row (has `feature` + token/unit meters), emit one
   `UsageEvent` (contract 03) with `idempotencyKey` deterministic from the trace id. Delivery is
   at-least-once (outbox pattern off the trace write; a retry re-emits the same key). No AI call bypasses
   emission (ADR-003 constraint — enforced by deriving events from traces, which Sport makes structurally
   unavoidable, rule 1).
2. **Rollup consumer:** upserts into `usage_ledger` on `idempotencyKey` — "insert if key unseen", never an
   update of an existing row. Replays are no-ops.
3. **Pricing at ledger write:** resolve the event's `(provider, model)` against the **platform pricebook**
   (per-model token/unit rates, superadmin-maintained, versioned); compute
   `priced_cost_micros = price(model, promptTokens, completionTokens, units)`. When the pricebook has no
   row for the model, fall back to the traced `costMicros` if nonzero; if both are zero/absent, park the
   row in `pricing_exceptions` for operator action — never silently bill zero for nonzero usage.
4. Record `priced_cost_micros` + `pricebook_version` on the `usage_ledger` row alongside the advisory
   traced `cost_micros` (both kept: audit can always compare traced vs billed).
5. **Debit:** convert `priced_cost_micros` to credits at the tenant's markup
   (`ceil(priced_cost_micros × markup_multiplier / credit_micro_value)`, ADR-003 §2) and append one
   `wallet_ledger` `usage_debit` row referencing the `usage_ledger` row; re-materialize the balance
   (007a transaction rule).
6. **Pricebook management:** superadmin CRUD on pricebook entries `(provider, model, prompt_rate_micros,
   completion_rate_micros, unit_rate_micros?, effective_from)`; every change creates a new
   `pricebook_version`; ledger rows always cite the version they were priced under. Seed ships a pricebook
   covering every model in the seed tenant's `model_routing`. **Shape per Tim (plan gate, 2026-07-02): a
   global default rate rule (multiplier over known provider cost) + per-model override rows** — resolution
   order: per-model override → default rule → traced-cost fallback → `pricing_exceptions`. Tenant markup
   (007a) stacks on top of the pricebook result and stays per-tenant.
7. **Ops surface:** rollup lag metric (newest unprocessed trace age), reconcile-drift metric (cache vs
   materialized, from 007b), and `pricing_exceptions` count — exposed on the superadmin economy panel and
   as structured logs.

## Acceptance criteria

| # | Given / When / Then |
|---|---------------------|
| AC-1 | Given the seed's `ai_traces` rows, when the emitter and consumer process them, then `usage_ledger` contains exactly one row per billable trace, each referencing its `traceId`. |
| AC-2 | Given the same traces re-emitted (full replay), then `usage_ledger` row count and total debited credits are unchanged. |
| AC-3 | Given a trace with `cost_micros = 0` and nonzero `promptTokens`/`completionTokens` for a pricebook-listed model, then its `usage_ledger` row carries `priced_cost_micros > 0` and a `wallet_ledger` debit exists for the converted credits. |
| AC-4 | Given an event whose model has no pricebook row and whose traced cost is zero, then a `pricing_exceptions` row exists and no wallet debit is written for it. |
| AC-5 | Given a pricebook rate update, then subsequent ledger rows carry the new `pricebook_version` while previously written rows retain theirs (queryable proof: two versions coexist). |
| AC-6 | Given a debit computed for a tenant, then `credits = ceil(priced_cost_micros × markup_multiplier / credit_micro_value)` for that tenant's config (property test across boundary values, including ceil rounding on 1-micro remainders). |
| AC-7 | Given the pipeline idle on the seed, then the rollup-lag metric reports < 60s and the superadmin panel renders lag, drift, and exception counts from live queries. |
| AC-8 | Given `usage_ledger`, when the application role attempts `UPDATE`/`DELETE`, then the statement is rejected (append-only, mirrors 007a AC-4). |

## Data requirements

| Table | Fields (behavioral contract) |
|---|---|
| `usage_ledger` | `id`, `idempotency_key` (unique), `tenant_id`, `member_id?`, `trace_id`, `feature`, `provider`, `model`, `prompt_tokens`, `completion_tokens`, `units`, `cost_micros` (advisory, as traced), `priced_cost_micros`, `pricebook_version`, `spend_class`, `occurred_at`, `created_at` |
| `pricebook_entries` | `id`, `provider`, `model`, `prompt_rate_micros`, `completion_rate_micros`, `unit_rate_micros?`, `effective_from`, `pricebook_version` |
| `pricing_exceptions` | `id`, `usage_event jsonb`, `reason` (`no_pricebook_row/zero_everything`), `state` (`open/resolved`), `created_at` |
| Outbox | `usage_event_outbox` — `idempotency_key` unique, `payload jsonb`, `state` (`pending/emitted`), retry metadata |

`priced_cost_micros`/`pricebook_version` are `usage_ledger` columns — they do NOT extend the frozen
contract 03 wire schema.

## Endpoints

- `GET /superadmin/economy/pricebook` · `POST /superadmin/economy/pricebook` (new versioned entry) —
  superadmin-only.
- `GET /superadmin/economy/health` — rollup lag, drift, exceptions (panel payload).
- `POST /superadmin/economy/exceptions/:id/resolve` — reprice a parked exception after adding the missing
  pricebook row (writes the deferred ledger + debit rows through the normal idempotent path).
No coach- or member-facing endpoints.

## UI/UX

**Superadmin economy panel (extends 007a's superadmin surface)** — pricebook table with version history,
and a health strip.

```
┌ Economy health ─────────────────────────────────────┐
│ rollup lag: 4s   cache drift: 0.0%   exceptions: 1  │
├ Pricebook (v7) ─────────────────────────────────────┤
│ provider    model                prompt/1M  compl/1M │
│ openrouter  claude-sonnet-4.6      $3.00     $15.00  │
│ voyage      voyage-3.5             $0.06        —    │
│ ...                                [Add entry]       │
└──────────────────────────────────────────────────────┘
```

Key behaviors: adding an entry bumps `pricebook_version`; the exceptions row links to a resolve flow.

## Hybrid Interface

Not applicable — Traditional lane (classification #13).

## Dependencies

| Dependency | Source | Status |
|------------|--------|--------|
| `ai_traces` cost/token/feature columns | PRD-002d | Required |
| `usage_ledger`/`wallet_ledger` DDL + append-only grants | PRD-001b | Required |
| Tenant markup config + materialization rule | PRD-007a | Required |
| Contract 03 schema in `@ciyp/shared` | PRD-001a | Required |
| Seeded traces + ledger rows | PRD-001c | Required |
| BullMQ/worker infra (outbox consumer) | PRD-002 infra | Available |

## Open questions

| # | Question | Why it matters | Resolution |
|---|----------|----------------|------------|
| Q-1 | Pricebook-vs-traced precedence when BOTH are nonzero and disagree? | Provider-reported cost can drift from our rates; billing must be deterministic. | Interim: pricebook wins (it's the billed rate; traced cost stays on the row for audit). Flag variance > 20% to the health panel. |
| Q-2 | Batch vs per-trace emission cadence? | Per-trace outbox is simplest and matches at-least-once; batching only matters at scale. | Decided: per-trace outbox in v1; revisit if rollup lag SLO breaks. |
| Q-3 | Ratify ledger-side pricing (no contract 03 change) at the plan gate | The 2026-07-02 architecture reconciliation recommended this resolution of OQ-A; PM should confirm with Tim. | **RATIFIED by Tim 2026-07-02** with the default-rule + per-model-override pricebook shape (FR-6) and per-tenant markup. |
