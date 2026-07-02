# PRD-004b: Voice Spend Integration (contract-04 heavy path)

> Parent: prd-004-voice-runtime-index.md | Module: Voice Runtime

## Goal

Make voice — the most spend-heavy call class — the working proof of ADR-003's hard enforcement: a
session cannot start on an empty wallet, a draining session is cut at a checkpoint, and every session
settles its actual cost to the ledger exactly once. This sub-feature owns the engine-side session
lifecycle (`POST /v1/voice/session`, config/checkpoint/end internal routes) and the deterministic
enforcement evals that classification #2 requires.

## Functional requirements

1. **Session start (heavy authorize):** `POST /v1/voice/session` (contract 02 §3) calls
   `authorize({ tenantId, feature: 'voice', spendClass: 'heavy', estimatedCostMicros })` (contract 04).
   On `allow`: create the session record (holding the reservation `authToken`), mint `sessionId` +
   short-lived `transportToken`, return `VoiceSessionStartResponse`. On deny: `402 { code:
   'spend_denied', remainingCredits }` — no token minted.
2. **Estimate source:** `estimatedCostMicros` derives from a platform config value (expected session
   length × per-minute voice cost from the pricebook) — a config row, not a code literal.
3. **Checkpoint loop:** every `checkpointIntervalS` (v1 default **60s**, platform config; see Q-1 /
   architecture OQ-5), the engine re-checks the session's tenant balance against cost accrued so far.
   On failure: mark the session cut, instruct the voice service, which emits
   `session_cut { reason: 'spend_denied' }` and closes the transport with that reason code.
4. **Settlement:** on `session_ended` or cut, compute actual session cost from the session's `ai_traces`
   rows (STT + turns + TTS) and call `settle({ authToken, actualCostMicros })` exactly once
   (idempotent — retries must not double-settle). A session that never produced a billable AI decision
   calls `release(authToken)` instead.
5. **Dangling-reservation safety:** a session record with neither settle nor release auto-releases
   after a TTL (2× max session length, platform config) — contract 04's "dangling reservation must
   time out" constraint.
6. **Trace/metering coverage:** STT utterances and TTS syntheses are traced with cost columns by the
   voice turn path (turn-level tracing itself is PRD-002's); this sub-feature asserts session-level
   completeness: every session's settle amount equals the sum of its traced costs.
7. **Session records:** persist per-session `{ id, tenant_id, member_id, thread_id, auth_token,
   started_at, ended_at, cut_reason, settled_cost_micros }` — tenant-scoped, RLS, feeding admin
   trace/wallet views (PRD-006/007) and the enforcement evals.
8. **Enforcement evals (deterministic, CI):** (a) start-refusal — near-zero-wallet seed tenant gets
   `402` and no session row with a token; (b) mid-call cut — funded-then-drained fixture is cut within
   one checkpoint interval and settles actual cost; (c) settle-idempotency under duplicate end reports.

## Acceptance criteria

| # | Given / When / Then |
|---|---------------------|
| AC-1 | Given a funded tenant, when its member calls `POST /v1/voice/session`, then the response contains `sessionId`, `transportUrl`, and a `transportToken` that expires within its configured TTL. |
| AC-2 | Given the near-zero-wallet seed tenant, when its member calls `POST /v1/voice/session`, then the response is `402 { code: 'spend_denied', remainingCredits }` and no session row holds an `authToken`. |
| AC-3 | Given an active session and a wallet drained below the accrued cost, when the next checkpoint evaluates, then the session row records `cut_reason = 'spend_denied'` and the voice service receives the cut instruction within one `checkpointIntervalS`. |
| AC-4 | Given a session that ends normally, when settlement runs, then `settle()` is called with `actualCostMicros` equal to the sum of the session's traced costs, and the reservation no longer exists. |
| AC-5 | Given a duplicate `session/end` report for an already-settled session, when settlement re-runs, then no second settle occurs and the ledger shows exactly one settlement event. |
| AC-6 | Given a session with zero billable AI decisions, when it ends, then `release(authToken)` is called and no Usage Event is emitted for the session. |
| AC-7 | Given a session record that never received end or cut, when the auto-release TTL elapses, then the reservation is released and the session row records the timeout. |
| AC-8 | Given `checkpointIntervalS` in platform config, when an operator changes it, then the next-started session uses the new value with no deploy (config read, cached + invalidated). |

## Data requirements

One new tenant-scoped table (name final at migration time): **`voice_sessions`** — fields per FR-7,
UUID PK, `tenant_id` FK + RLS in the same migration, indexes on `(tenant_id, started_at)` and
`auth_token`. Append-only in spirit: cut/settle update their columns; rows are never deleted (audit).

## Endpoints

- `POST /v1/voice/session` (auth: member session) → `200 VoiceSessionStartResponse | 402 spend_denied` — contract 02 §3 verbatim.
- `POST /internal/voice/session/{sessionId}/config` (auth: service secret) → session config payload (004a FR-2), single-use against a valid unexpired token.
- `POST /internal/voice/session/{sessionId}/end` (auth: service secret) → triggers settlement (idempotent).
- Checkpoint execution is engine-internal (scheduler/loop), not an HTTP surface; its *cut instruction* to the voice service rides the existing service channel.

## UI/UX

No frontend changes in this slice — `402 spend_denied` at start and `session_cut(spend_denied)` mid-call
are the wire states the template's voice client renders (contract 02 constraint: first-class UI states,
not errors to swallow).

## Hybrid Interface

Not applicable — AI-native lane (feature-classification #2). The wallet/ledger shapes this consumes are
PRD-007's Hybrid Interface; this sub-feature is a client of contract 04, not an owner of shared tables.

## Dependencies

| Dependency | Source | Status |
|------------|--------|--------|
| `authorize`/`settle`/`release` implementation | PRD-007 | Required (contract 04 frozen — build against a contract-faithful stub until PRD-007 lands; evals run against the real impl before acceptance) |
| Session cost from traced rows (`ai_traces` cost columns) | PRD-002 | Required |
| Pipecat service lifecycle events | PRD-004a | Required (same module) |
| Near-zero-wallet + funded seed members | PRD-001 | Required |
| Pricebook per-minute voice estimate config | PRD-007 (pricebook) | Required (seed value suffices) |

## Open questions

| # | Question | Why it matters | Resolution |
|---|----------|----------------|------------|
| Q-1 | Checkpoint interval default — is 60s the right latency/overspend trade (architecture OQ-5)? | Max unbilled drain per session = interval × burn rate | Interim: 60s platform config; tune at load test against real session lengths (OQ-5 owner). |
| Q-2 | Cut UX grace: hard-close at checkpoint, or allow the in-flight TTS reply to finish first? | Member experience at cut vs. bounded overspend | **Decided (Tim, plan gate 2026-07-02): finish the in-flight reply, then close.** Balance may go negative by just enough to cover that final turn (explicit bounded overspend); settlement records the true (negative-capable) figure. |
