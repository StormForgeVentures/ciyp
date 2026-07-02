# PRD-007b: Spend Authorization Service

> Parent: prd-007-ai-economy-index.md | Module: AI Economy — Wallet, Spend Authorization, Metering

## Goal

Implement contract 04 — the seam that keeps hard enforcement real without taxing the hot path. Cheap calls
authorize against a per-tenant cached balance with optimistic debit and a bounded overspend tolerance;
spend-heavy calls (voice start, batch transcription, deep model) take a synchronous ledger-materialized
check with reserve/settle/release semantics. The service implements the Sport `SpendAuthorizer` port shape
so the runtime (PRD-002b) wires it in as a port, and PRD-004b consumes the heavy path for voice.

## Functional requirements

1. `authorize(AuthorizeRequest) → AuthorizeResponse` per contract 04, branching on `spendClass`.
2. **Cheap path:** reads the per-tenant balance from Valkey (TTL in the seconds–tens-of-seconds band,
   config value, default 15s), debits it optimistically, returns `{allow, remainingCredits}` with no
   Postgres round-trip. Allows until the cached balance breaches the overspend floor
   (`-overspend_bound_credits`, OQ-4 tunable); below the floor, cheap calls are denied too.
3. **Heavy path:** synchronous read of the ledger-materialized balance; if `>= estimatedCostMicros`
   converted to credits, writes a reservation and returns an `authToken`; else
   `{allow:false, reason:'insufficient_balance'}`. The atomic check-and-reserve is a single-statement
   check-and-increment (the ScalingCFO `reserve` pattern) — TOCTOU-safe under concurrency.
4. **Settle/release:** `settle(authToken, actualCostMicros)` replaces the reservation with actuals (the
   Usage Event remains the billing truth — settle only clears the hold); `release(authToken)` frees it.
   Dangling reservations auto-release after `reservation_ttl` (default 15 min) via a sweep job.
5. **Re-check hook:** an interval re-check API for long-running heavy sessions
   (`recheck(authToken) → {allow, remaining}`) consumed by PRD-004b at its checkpoint interval (OQ-5 lives
   with 004b); a failed re-check tells the caller to cut at the next checkpoint.
6. **Reconciliation:** a background job continuously reconciles the Valkey cache against
   `wallets.balance_credits`, corrects drift, and emits a drift metric; every `wallet_ledger` write (007a)
   invalidates the tenant's cache entry immediately.
7. `tenant_suspended` (wallet `state != 'active'`) is a hard deny on both paths regardless of balance.
8. Every denial is traced as a governance event (rule 1: enforcement decisions are AI-adjacent decisions —
   they must be visible in `ai_traces` for incident investigation and the deterministic enforcement evals).

## Acceptance criteria

| # | Given / When / Then |
|---|---------------------|
| AC-1 | Given the seeded near-zero-wallet tenant, when `authorize` is called with `spendClass='heavy'` for a voice start, then the response is `{allow:false, reason:'insufficient_balance', authToken:null}`. |
| AC-2 | Given a funded tenant, when a heavy authorize succeeds, then a reservation row exists and a concurrent second heavy authorize sees a balance net of the reservation. |
| AC-3 | Given two concurrent heavy authorizes whose combined estimates exceed the balance, then at most one receives `allow=true` (atomic reserve; proven by a concurrency test). |
| AC-4 | Given a heavy authorization that is never settled or released, when `reservation_ttl` elapses and the sweep runs, then the reservation is released and the balance recovers. |
| AC-5 | Given a funded tenant, when cheap authorizes are issued, then no Postgres query occurs on the authorize path (verified by instrumentation/spy in the integration test) and each response returns within the cache. |
| AC-6 | Given concurrent cheap authorizes against a stale cache, then the cached balance never falls below `-overspend_bound_credits`, and calls beyond the floor are denied. |
| AC-7 | Given a `wallet_ledger` write for a tenant, then that tenant's cached balance entry is invalidated within the same request cycle (next cheap authorize re-reads materialized balance). |
| AC-8 | Given a wallet in state `paused`, when either spend class authorizes, then the response is `{allow:false, reason:'tenant_suspended'}`. |

## Data requirements

| Table | Fields (behavioral contract) |
|---|---|
| `spend_reservations` | `auth_token` (pk), `tenant_id`, `feature`, `reserved_credits`, `created_at`, `expires_at`, `state` (`held/settled/released/expired`) — heavy path only |
| Valkey keys | `spend:balance:{tenant_id}` (cached credits, TTL), `spend:floor:{tenant_id}` (config) — working state only, never billing truth (rule 8 tier discipline) |

No new durable tables beyond `spend_reservations`; ledgers are 007a's.

## Endpoints

Internal service interfaces (Sport `SpendAuthorizer` port + internal HTTP for the Python voice service):

- Port: `authorize / settle / release / recheck` — in-process for the Node runtime (PRD-002b wiring).
- `POST /internal/spend/authorize` · `POST /internal/spend/settle` · `POST /internal/spend/release` ·
  `POST /internal/spend/recheck` — shared-secret internal routes mirroring the port for `apps/voice`
  (same header discipline as the coach-core internal route). Never exposed publicly.

## UI/UX

No frontend changes in this slice (denials surface through contract 02 `spend_denied` rendered by the
template; wallet states render in 007a's screens).

## Hybrid Interface

Not applicable — Traditional lane (classification #12/#13; enforcement is deterministic, not generative).

## Dependencies

| Dependency | Source | Status |
|------------|--------|--------|
| Materialized balance + wallet state | PRD-007a | Required |
| Contract 04 schema in `@stormforgeventures/ciyp-shared` | PRD-001a | Required |
| Sport `SpendAuthorizer` port seam | PRD-002b | Required (this fills the stub) |
| Valkey | PRD-002 infra | Available |
| Heavy-path consumer (voice start + checkpoint re-check) | PRD-004b | Consumer |
| Near-zero-wallet seed member | PRD-001c | Required |

## Open questions

| # | Question | Why it matters | Resolution |
|---|----------|----------------|------------|
| Q-1 | Cheap-call overspend bound value (architecture OQ-4)? | The floor trades wallet fidelity against hot-path latency; too tight re-couples cheap calls to the ledger. | Interim: conservative default (e.g. 100 credits or 1% of last top-up, whichever is smaller), config per tenant; confirm at load test. |
| Q-2 | Cache TTL default (15s proposed)? | Longer TTL = staler balance = larger real overspend window; shorter = more reconcile churn. | Interim: 15s + write-through invalidation on every ledger write; revisit with load-test data alongside Q-1. |
| Q-3 | Should cheap denials at the overspend floor also emit contract-02 `spend_denied`, or degrade to a text notice? | UX for a fully-drained wallet mid-chat. | Interim: same `spend_denied` part (one wire shape); template decides presentation. |
