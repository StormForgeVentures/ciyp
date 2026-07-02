# PRD-002: Sport Runtime — AI Engine + Execution Substrate

> Source: docs/project-brief.md + docs/architecture.md | Folder location = lifecycle status (do not add a Status field)

## Overview

### Goals

This module delivers everything between the database and the coaching surfaces: the pure AI brain
(`packages/agents` + `packages/prompts`, ported from EL-OS and de-enummed), the Sport AI SDK execution
edge in `apps/api/src/lib/sport/` (per-tenant-scope assembly, ports, slot resolution, cascade), and the
eval + observability layer that makes every AI decision traced, versioned, and eval-gated. It addresses
three distinct concerns: (1) a provider-agnostic, coach-agnostic brain that runs identically under shared
and dedicated deployments, (2) a runtime where two tenants get different models, prompts, and voices with
zero code differences, and (3) the evidence layer (`ai_traces`, `prompt_versions`, `eval_snapshots`) that
downstream metering (PRD-007) and the admin console (PRD-006) build on. It unblocks PRD-003 (coaching
surfaces), PRD-004 (voice), and PRD-006 (agent studio).

### Scope

| In scope | Out of scope |
|----------|--------------|
| Ported pure agents package (classifier, linters, interaction engine, cadence agents, process runner, tool dispatcher) | Coaching API routes / SSE wire (PRD-003) |
| Ported prompts package with baselines registry, zero coach IP | Voice runtime (PRD-004) |
| Per-tenant-scope Sport assembly + bounded host cache | Wallet / SpendAuthorizer implementation (PRD-007 — stub here) |
| Sport ports: scope-resolver, trace-sink, vector-store, embedder/reranker, storage, prompt-version store | Library ingestion pipeline (PRD-005) |
| Live per-scope model-slot resolution + invalidation | Admin authoring UI for config/agents (PRD-006) |
| Cascade blocks (L0/L1 platform-locked, L2+ tenant) | Coach-authored definition hydration (PRD-006, needs sport-ai-sdk #25–#27) |
| Eval harness port (judge, golden sets, runner) | New golden-set *content* authoring beyond the ported/seed sets |
| `ai_traces` extension with token/cost columns | Usage-event emission + rollup (PRD-007, reads these columns) |

## Sub-PRDs

| Sub-PRD | File | Scope (one line) |
|---------|------|------------------|
| 002a | `prd-002a-sport-runtime-engine-port.md` | Port + generalize `packages/agents` and `packages/prompts` (pure brain, de-enum, substrate injection) |
| 002b | `prd-002b-sport-runtime-assembly-ports.md` | `lib/sport/` assembly with per-tenant host cache + the platform's Sport port implementations |
| 002c | `prd-002c-sport-runtime-slots-cascade.md` | Live per-scope model-slot resolution and the cascade-block system |
| 002d | `prd-002d-sport-runtime-eval-observability.md` | Eval harness port, extended `ai_traces`, `prompt_versions` + `eval_snapshots` |

## Personas

- **Developer agent** — implements against this spec; needs unambiguous port boundaries and prohibited patterns named.
- **AI-architect** — audits the ten enforcement rules and ADR-006 constraints against the built runtime.
- **Luminify operator (Tim/team)** — runs evals against a tenant, inspects traces, swaps a model slot without a deploy.

## Module-level acceptance criteria

| # | Given / When / Then |
|---|---------------------|
| AC-1 | Given the Luminify seed tenant, when a chat turn is executed through the Sport assembly (internal turn entrypoint, no HTTP surface required), then a non-empty assistant reply is produced and every AI decision in the turn (classify, model call, retrieval, memory recall) has a corresponding `ai_traces` row sharing the turn's trace correlation id. |
| AC-2 | Given two seeded tenants whose `app_config.model_routing.default` name different models, when the same prompt is executed as a turn for each tenant, then each tenant's `ai_traces` model-call rows record their own configured model, with no per-tenant branches in runtime code (verified by grep: no tenant id literals outside seed/fixtures). |
| AC-3 | Given tenant A's slot config is updated via the config write path, when the next turn for tenant A executes, then it uses the new model without a process restart, and a turn for tenant B in the same window still uses B's unchanged model. |
| AC-4 | Given the Luminify seed and required provider keys present, when the eval runner executes the full suite, then every metric meets or exceeds its target from `docs/ai-architecture/feature-classification.md` and results persist as `eval_snapshots` rows. |
| AC-5 | Given the full monorepo source, when `grep -riE` for the coach-IP identifier list in prd-002a runs over `packages/` and `apps/`, then it returns zero matches outside `docs/`. |
| AC-6 | Given any turn executed in the test suite, when its trace rows are queried, then no row's payload contains a JWT, API key, or OAuth token (governance scan test). |

## Core UX per Surface

- **No end-user surface.** This module's "surfaces" are internal: the turn entrypoint consumed by PRD-003/004,
  the eval runner CLI (`pnpm evals` in `apps/api`), and the trace/eval tables read by PRD-006 admin screens.
  Structure and contracts only; no screens are designed here.

## Technical Considerations

See sub-PRDs for per-feature decisions. Module-wide, from `docs/architecture.md` §5 + ADR-006:

**Purity boundary.** `packages/agents` deps = `@ciyp/shared` + `zod` only; all LLM/DB access via the
injected substrate. Tenant awareness exists ONLY at the `lib/sport/` assembly edge. A direct provider or
Supabase import inside `packages/agents` is a Must-fix.

**SDK dependency discipline.** Interim per-tenant assembly cache ships behind the same seam that
sport-ai-sdk issues #25 (per-scope assembly manager), #26 (registry upsert), #27 (config-store ports)
will replace. Wave tasks cite issue numbers, never an SDK version (project-state, Tim 2026-07-02).

**Prohibited patterns (named so QA can grep):** `staticSlotConfig` (boot-frozen slots), process-singleton
SportHost, `@earendil-works/*` imports, hardcoded model identifiers, MCP catalog resolution under a
sentinel scope.

### Security

All runtime data access is tenant-fenced: the scope resolver derives tenant from the authenticated request
via ALS (never the body), sets the RLS GUC, and `assertNoCredentialsInScope` runs on every resolved scope.
Vector queries filter by `tenant_id` in the payload even inside tenant-scoped retrieval functions (rule 4).
Trace rows are admin-only reads (RLS); trace payloads pass the redaction port before write. No secrets in
`ResolvedScope`, traces, or logs — enforced by a custom eslint rule plus a runtime governance test.

## Dependencies

| Dependency | Source | Status |
|------------|--------|--------|
| `tenants`, per-tenant `app_config`, domain tables + RLS | PRD-001 (schema + migration) | Required |
| Luminify seed (2nd tenant fixture included for AC-2/AC-3) | PRD-001 (seed) | Required |
| `@ciyp/shared` contract types (zod) | PRD-001 (contract freeze) | Required |
| `SpendAuthorizer` interface (authorize/settle/release shape) | PRD-007 (contract 04) | Required (interface only; stub impl created here) |
| EL-OS source for ports | `/mnt/c/Repos/empowered-leader-os` (read-only) | Available |
| sport-ai-sdk `sport-core`/`sport-server` packages | GitHub Packages (private) | Available |
| Paid Voyage API key | Ops (ADR-007 prerequisite) | Required |

## Non-Goals

- No coaching-surface routes, SSE streaming, or `parts` wire handling (PRD-003).
- No coach-authored definition hydration or authoring UI (PRD-006).
- No usage-event emission, pricing, or wallet enforcement (PRD-007) — this module only produces the cost columns.
- No multi-agent orchestration (head/fan-out/challenge) — single-role turns in v1, per EL-OS parity.
- No re-embedding or embedding-vendor evaluation (ADR-007 carries Voyage; triggers documented there).

## Success Metrics

- Eval suite green on the Luminify seed: routing ≥ 0.9, retrieval precision ≥ 0.7, faithfulness ≥ 0.95, interaction-mode correctness ≥ 0.9 (alerts per feature-classification).
- Model-slot swap latency: config write → next-turn effect, with zero deploys (AC-3 proves).
- 100% of AI decisions traced (AC-1); 0 coach-IP identifiers (AC-5); 0 credential leaks in traces (AC-6).

## Implementation Priority

1. **002a engine port** — everything else consumes the brain; pure package = testable without infra.
2. **002b assembly + ports** — the runtime edge; unblocks first end-to-end turn (needs 002a + PRD-001 schema).
3. **002c slots + cascade** — per-tenant behavior proof (AC-2/AC-3); small once 002b exists.
4. **002d eval + observability** — gates everything downstream ("no eval, no ship"); runs last but blocks module acceptance.

## Related

- Task list: `tasks-002-sport-runtime.md` (this folder — generate-tasks output)
- QA report: `qa/qa-002-sport-runtime.md` (authored by the qa-reviewer, NOT the PM)
- Acceptance ledger: `handoff/acceptance-ledger.md` (`AC-002-sport-runtime-NN` rows)
