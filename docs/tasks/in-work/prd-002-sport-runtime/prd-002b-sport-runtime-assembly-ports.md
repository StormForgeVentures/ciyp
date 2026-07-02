# PRD-002b: Sport Assembly + Platform Ports

> Parent: prd-002-sport-runtime-index.md | Module: Sport Runtime — AI Engine + Execution Substrate

## Goal

Build `apps/api/src/lib/sport/` — the impure edge where the pure brain meets real infrastructure: a
**per-tenant-scope Sport assembly** with a bounded, invalidating host cache, and the platform's
implementations of every Sport port (scope resolution, tracing, vector/embedding/rerank, storage,
prompt versions, spend authorization stub). This is the seam ADR-006 rule 3 mandates and the exact
place ScalingCFO's two anti-patterns (singleton host, boot-frozen config) are prohibited.

## Functional requirements

1. `assembly.ts` builds a Sport host **per tenant scope**: `hostFor(scope)` returns a cached host keyed by `(tenant_id, config_version)`; `invalidate(tenantId)` evicts; cache is bounded (LRU, size a config tunable per architecture OQ-6); concurrent turns during rebuild get the old host until the new one is ready.
2. The assembly seam is documented as **interim**: when sport-ai-sdk #25 (per-scope assembly manager), #26 (registry upsert), #27 (config-store ports) resolve, the interim cache is replaced behind the same `hostFor/invalidate` interface with no caller changes. Tasks cite issue numbers only — never an SDK version.
3. **Scope resolver port:** derives tenant + member from the authenticated request via AsyncLocalStorage (never from the request body); sets the RLS GUC on the DB handle (shared mode) per `tenant-context.ts`; calls `assertNoCredentialsInScope`; JWTs/credentials never enter `ResolvedScope` (request-ALS carries them out-of-band).
4. **Trace sink port:** every Sport-emitted trace event writes an `ai_traces` row (fire-and-forget, composed with the redaction port); app-specific event types use the namespaced `app:*` widening; rows carry the tenant id and (when present) member id + turn correlation id.
5. **Vector store port:** pgvector over the PRD-001 schema; every query filters `tenant_id` in SQL even inside tenant-scoped RPCs (rule 4 belt-and-suspenders); hybrid retrieval legs (dense kNN + sparse BM25, RRF k=60) exposed for PRD-005 retrieval wiring.
6. **Embedder/reranker ports:** Voyage via `embed` / `rerank` slots; asymmetric input types are structural — `embedForIndex` sets `document`, `embedForQuery` sets `query`; there is no generic `embed()` export.
7. **Storage + prompt-version ports:** artifact storage (Supabase); `recordPromptVersion` synchronous with required rationale (consumed by 002d).
8. **SpendAuthorizer stub:** implements the contract-04 interface (`authorize/settle/release`) returning configured-allow with full tracing, so PRD-007 swaps in the wallet-backed implementation without touching call sites; stub denials testable via config to prove the deny path end-to-end.
9. A custom eslint rule (ScalingCFO `no-jwt-in-resolved-scope` pattern) fails the build if token-bearing values are assigned into scope construction.
10. Prohibited patterns enforced by CI grep: `staticSlotConfig`, `@earendil-works/`, module-level `let host` singletons in `lib/sport/`.

## Acceptance criteria

| # | Given / When / Then |
|---|---------------------|
| AC-1 | Given tenants A and B seeded, when turns for A and B execute concurrently, then each turn's trace rows carry its own tenant id and A's host instance is not B's (asserted via host identity in a test hook). |
| AC-2 | Given tenant A's host is cached, when `invalidate(A)` is called after a config write, then the next `hostFor(A)` builds a fresh host and `hostFor(B)` returns B's cached host unchanged. |
| AC-3 | Given the host cache at its configured bound, when one more tenant's host is requested, then the least-recently-used host is evicted and a cache-eviction metric/trace is emitted. |
| AC-4 | Given a request whose body claims a different tenant than its auth context, when the turn executes, then all reads/writes and traces are scoped to the authenticated tenant (body value ignored). |
| AC-5 | Given a source file assigning a JWT-bearing value into `ResolvedScope` construction, when lint runs, then the build fails with the custom rule id. |
| AC-6 | Given index-time and query-time embedding calls in the test suite, when their outbound requests are captured, then index calls carry input type `document` and query calls carry `query` (wrong pairing fails the test). |
| AC-7 | Given the SpendAuthorizer stub configured to deny, when a turn requiring authorization executes, then the turn short-circuits with the documented denial shape and a governance trace row is written. |
| AC-8 | Given any vector query in the test suite issued with a mismatched `tenant_id` filter, then it returns zero rows (cross-tenant recall test over the two-tenant seed). |

## Data requirements

No new tables. Consumes PRD-001's `tenants`, per-tenant `app_config`, library/memory/vector tables, and
002d's extended `ai_traces`. The `(tenant_id, config_version)` cache key requires `app_config` to carry a
monotonic `config_version` (PRD-001 schema — dependency row below).

## Endpoints

No new public endpoints. Exposes the internal turn entrypoint (function-level) that PRD-003 wraps in
routes and PRD-004's voice service calls via the internal route.

## UI/UX

No frontend changes.

## Hybrid Interface

Not applicable — AI infrastructure.

## Dependencies

| Dependency | Source | Status |
|------------|--------|--------|
| `@ciyp/agents` substrate surface | prd-002a | Required |
| `app_config.config_version` column | PRD-001 schema | Required |
| `ai_traces` extended columns | prd-002d | Modified there |
| Contract 04 (Spend Authorization) interface | docs/contracts/04 + PRD-007 | Required (interface) |
| sport-core / sport-server packages | GitHub Packages | Available |
| sport-ai-sdk #25/#26/#27 (replaces interim seam) | sport-ai-sdk repo | Required for PRD-006 hydration; NOT a blocker here |

## Open questions

| # | Question | Why it matters | Resolution |
|---|----------|----------------|------------|
| Q-1 | Host-cache bound default (N hosts) and memory per host? | One Node process holds N tenants (architecture §5.5, OQ-6) | Interim: default 32, config-tunable; measure at load test and revise. |
| Q-2 | Does the guard/linter chain run inside the Sport turn or post-hoc on the draft? | SDK has no guard hook until #28 | Decided: post-hoc on the draft with the final gated before send (EL-OS parity); flips to inline when #28 lands. |
