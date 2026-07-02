# ADR-003 — AI wallet + metering + enforcement

**Date:** 2026-06-18 · **Status:** Accepted · **Decision owner:** Software Architect

## Context

Flow (b) of CIYP's three money flows: **Coach → Luminify**, a **prepaid AI wallet** of credits, **metered**
against real AI usage, with **hard balance enforcement in v1** (top-ups, Stripe recharge, pause spend-heavy
calls at zero). One wallet per coach/tenant. Coaches absorb their members' AI cost (flow c), so the coach's
wallet funds all of that coach's members' usage. The credit unit must be **abstracted from raw provider
cost** with a **configurable markup**, so coach-facing pricing is decoupled from provider price volatility.

The runtime cannot afford a synchronous wallet round-trip on every AI turn — voice is P0 and latency-
sensitive. But "hard enforcement" must actually bite: a zero-balance coach's spend-heavy calls must stop.

EL-OS already gives us the metering substrate: **`ai_traces`** writes a row for *every* AI decision
(classify, model call, retrieval, memory recall, TTS, coaching-process events, linter interventions). We
extend it rather than building a parallel pipeline.

## Decision

### 1. Metering substrate — extend `ai_traces`

Add to `ai_traces`: `provider`, `model`, `prompt_tokens`, `completion_tokens`, `cost_micros` (raw provider
cost in micro-units), `feature` (chat / voice / transcription / embedding / cadence / …), and `tenant_id`
(from the multi-tenant migration). The trace already fires on every decision; we add the cost columns. This
is the single source of truth for *what was spent*.

### 2. Credit unit + markup

A **credit** is a platform-internal unit, abstracted from provider cost. Conversion:
`credits_debited = ceil(cost_micros × tenant.markup_multiplier / credit_micro_value)`. `markup_multiplier`
and `credit_micro_value` are **per-tenant config** (pricing is a business knob, not architecture — see
OQ-3). This decouples coach pricing from provider price moves and lets the platform take margin.

### 3. The ledger pipeline (append-only, idempotent)

```
ai_traces (tokens+cost)
   └─►  Usage Event  (contract 03; at-least-once + idempotent via idempotency_key)
          └─►  usage_ledger     (append-only: raw usage rows, one per event)
                  └─►  wallet_ledger  (append-only: credit debits/credits)
                          └─►  wallets.balance_credits  (materialized from wallet_ledger)
```

- **`usage_ledger`** and **`wallet_ledger`** are **append-only**. A mistake is corrected with a
  compensating row, never an update/delete. This makes the money trail auditable and replay-safe.
- **Idempotency:** every Usage Event carries an `idempotency_key` (deterministic from the trace id). The
  ledger upserts on that key, so at-least-once delivery (a retried emit) never double-debits.
- **`wallets.balance_credits`** is materialized from `wallet_ledger` (the ledger is truth; the balance is a
  cache of the ledger). Top-ups (Stripe recharge) and adjustments are also `wallet_ledger` rows (credits).

### 4. The spend-authorization seam (contract 04)

Two tiers, by cost class:

- **Cheap calls (chat turns, classify, embed).** Authorize against a **per-tenant cached balance** with a
  short TTL (seconds–tens of seconds). `authorize(tenant, estCost) → { allow, remaining }` reads the cache,
  debits it optimistically, returns immediately — **no wallet round-trip on the hot path.** The cache is
  reconciled against `wallet_ledger` continuously.
- **Spend-heavy calls (voice session, batch transcription, deep-model).** **Synchronous hard balance
  check** against the ledger-materialized balance *before* the call starts. Long voice sessions **re-check
  at intervals** (OQ-5) and are cut at a checkpoint if the wallet drains mid-session. A voice session will
  not *start* on an empty wallet. **This is where hard enforcement bites.**
- **Reconciliation.** A background reconcile corrects cache drift; the **ledger is the billing authority**,
  the cache is advisory for cheap calls only.

**Accepted overspend bound.** Under concurrency, optimistic cheap-call debiting can briefly push the cached
balance slightly negative (multiple cheap calls authorize against a stale cache before reconcile). We
accept a small, **bounded** overspend on *cheap* calls (OQ-4) in exchange for keeping the wallet off the
hot path. We **never** accept it on spend-heavy calls — those are hard-gated synchronously. The bound is a
tunable; v1 sets it conservatively and confirms at load test.

### 5. Top-ups & recharge

Stripe checkout for wallet top-up → Stripe webhook (idempotent on event id) → `wallet_ledger` credit row →
balance re-materializes. Auto-recharge (optional per tenant) triggers a top-up when balance crosses a
threshold.

## Consequences

**Positive.**
- Reuses `ai_traces` — no parallel metering pipeline; every AI decision is already traced.
- Append-only ledgers + idempotency keys = auditable, replay-safe money trail; safe under at-least-once delivery.
- Wallet off the hot path for cheap calls (latency preserved); hard gate exactly where spend is large.
- Credit abstraction insulates coach pricing from provider price changes and is the platform's margin lever.
- Per-tenant wallet caps a tenant's blast radius — a key noisy-neighbor mitigation for ADR-001's shared DB.

**Negative / accepted.**
- **Bounded cheap-call overspend** under concurrency (above). Accepted, bounded, tunable.
- **Cache/ledger drift** requires a reconcile job — operational surface. Accepted; the alternative
  (per-turn round-trip) is worse for P0 voice.
- Voice mid-session cut is a **UX edge** (a session ending because credits ran out). Mitigation: warn the
  coach as balance approaches zero; auto-recharge; checkpoint-cut rather than hard-kill.

## Alternatives rejected

- **Per-turn synchronous wallet check on every call.** Simplest correctness. Rejected: adds latency to P0
  voice and every chat turn; defeats the differentiator.
- **Post-paid metered billing (no prepaid wallet).** Rejected: discovery locked **prepaid + hard
  enforcement in v1**; post-paid removes the enforcement lever and adds collections risk.
- **Mutable balance counter (no ledger).** Rejected: not auditable, not replay-safe, can't recover from a
  bad debit; double-debits on retried delivery.
- **Bill members directly for AI (no coach-absorbs).** Rejected: discovery locked coach-absorbs (flow c);
  members never see credits.
- **Bill at raw provider cost (no credit abstraction).** Rejected: exposes coaches to provider price
  volatility and leaves no platform margin.

## Constraint for downstream

- Every AI call site emits a Usage Event with an `idempotency_key`; **no AI call may bypass metering.**
- Ledgers are **append-only.** Corrections are compensating rows. No `UPDATE`/`DELETE` on ledger tables.
- Spend-heavy operations (voice, transcription, deep model) **must** call `authorize()` with a hard check
  before starting; cheap calls authorize against the cache.
- `wallets.balance_credits` is derived; never written directly except by the materialization from `wallet_ledger`.
