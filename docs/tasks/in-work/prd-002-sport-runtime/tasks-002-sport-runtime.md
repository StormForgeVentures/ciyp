# Tasks — PRD-002 Sport Runtime (AI engine + execution substrate)

> Source: prd-002-sport-runtime-index.md + sub-PRDs a–d. Depends on PRD-001 (wave 0). Order: 1.0 → 2.0 → 3.0 → 4.0
> (index Implementation Priority); 1.0 is parallel-safe with PRD-001's 3.0/4.0 once contracts (001 §2.0) exist.

## Relevant Files

### 1.0 engine port (feature/engine-port) — packages/agents (`@ciyp/agents`) + packages/prompts (`@ciyp/prompts`)
- `packages/agents/src/{substrate,llm/types}.ts` — ModelSlot mirror + injected AgentSubstrate/LlmCaller/LlmStreamer/TraceAICall (no default provider caller — network-free).
- `packages/agents/src/classifier/{schema,index,language-signal}.ts` (+ tests) — classifier (opaque target/archetype_lean) + 9-state language-signal scan.
- `packages/agents/src/linters/{types,voice,no-shame,playfulness,retention,index}.ts` (+ tests) — canonical chain; config-driven lightness widening; generic archetype-name-leak.
- `packages/agents/src/interaction-engine/index.ts` (+ test) — mode-driven engine.
- `packages/agents/src/utility/{types,breathwork-pacer,alignment-prompt,index}.ts` (+ test) — utility agents.
- `packages/agents/src/orchestrator/{tools,run,doc-reference}.ts` (+ tests) — generic 7-tool dispatcher, transport-agnostic turn callable, member-doc cue detector.
- `packages/agents/src/coaching/{types,goal-gate,process-runner,index}.ts` (+ tests) — CodeProcessDefinition (source 'code'|'authored'), deterministic Goal-gate, ProcessRunner.
- `packages/agents/src/cadence/{directive,index}.ts` (+ test) — generic bounded-thread cadence (runCadenceTurn + finalizeCadence + buildCadenceDirective + CADENCE_KINDS).
- `packages/agents/src/artifacts/plan_document/{render,directive,index}.ts` (+ test) — deterministic plan-document renderer + fidelity gate (generic PlanDocumentData).
- `packages/agents/src/index.ts` — barrel.
- `packages/prompts/src/*` — states/voice-rules/retention/no-shame/language-signal/orchestrator/classifier/doc-distill (platform-generic) + archetype-voices/questions/quotes (EMPTY placeholder) + baselines registry + select (+ corpus/select tests).
- `apps/api/src/index.ts` — health scaffold re-pointed from removed scaffold constants to ported exports (TOOL_NAMES / PROMPT_BASELINES).

## Tasks

- [x] 1.0 Engine port: pure `@ciyp/agents` + `@ciyp/prompts`, de-enummed, tests ported (maps to: 002a FR-1..8 / AC-002-sport-runtime-07..-14, index AC-5 → -05) — verify: `pnpm typecheck && pnpm build && pnpm test` green (176 agents + 33 prompts tests); dependency-lint purity gate green; coach-IP grep CLEAN over packages/ + apps/
  - [x] 1.1 Port classifier (+ language signal), linter chain (canonical order), interaction engine, utility agents with `AgentSubstrate` injection — verify: ported unit tests green with mock substrate, no network (classifier 11 + language-signal 7 + voice 28 + playfulness 12 + linter-chain 11 + interaction-engine 10 + utility 8 tests green; agents deps = shared+zod only)
  - [x] 1.2 Port process runner + goal gate + cadence agents (daily/weekly/monthly_review generic) + plan-document artifact + doc-reference detector — verify: forced-finalize + `source:'authored'` parity tests (goal-gate 13 + process-runner 11 incl. AC-4 authored-parity + cadence 18 incl. forced-finalize emit/repair/fallback/throw + plan-document 10 + doc-reference 7 tests green)
  - [x] 1.3 Port tool dispatcher: closed 7-tool manifest (generic names), zod-validated args, injected executors w/ graceful-empty, traced dispatches — verify: schema-reject + missing-table degradation tests (tools 15 + run 15 tests green; generic manifest: get_recent_checkin_outputs / flag_for_review; opaque agent_kind + doc kind)
  - [x] 1.4 De-enum sweep + `@ciyp/prompts` port (composition machinery, baselines registry, zero Kyle text) — verify: coach-IP grep CI check green (identifier list in 002a AC-5) — grep over packages/+apps/ returns ZERO matches; prompts corpus ships empty/placeholder + baselines registry (8 blocks); corpus 14 + select 19 tests green
- [ ] 2.0 Sport assembly + platform ports — first end-to-end internal turn on the seed (maps to: 002b FR-1..10 / AC-002-sport-runtime-15..-22, index AC-1 → -01, AC-6 → -06)
  - [ ] 2.1 `assembly.ts`: `hostFor(scope)` keyed `(tenant_id, config_version)`, bounded LRU (default 32, tunable), `invalidate(tenantId)`, old-host-until-ready; interim seam documented against sport-ai-sdk #25/#26/#27 — verify: identity/eviction/invalidation tests (002b AC-1..3)
  - [ ] 2.2 Scope-resolver port (request-ALS, RLS GUC, `assertNoCredentialsInScope`) + `no-jwt-in-resolved-scope` eslint rule — verify: body-spoof test (AC-4) + planted-lint-violation fails build (AC-5)
  - [ ] 2.3 Trace-sink (fire-and-forget + redaction, `app:*` widening), vector-store (tenant_id filter in SQL, hybrid legs RRF k=60), embedder/reranker (asymmetric input types, no generic embed()), storage + prompt-version ports — verify: input-type capture test (AC-6) + cross-tenant zero-rows (AC-8)
  - [ ] 2.4 SpendAuthorizer stub on contract-04 interface (configured-allow, deny-path testable) + prohibited-pattern CI greps — verify: stub-deny short-circuit trace test (AC-7)
  - [ ] 2.5 Wire 1.0's brain through the assembly: internal turn entrypoint produces a reply on the Luminify seed with every decision traced under one correlation id — verify: module AC-1 integration test + governance scan (AC-6)
- [ ] 3.0 Live model slots + cascade blocks — two tenants, two behaviors, zero code branches (maps to: 002c FR-1..8 / AC-002-sport-runtime-23..-30, index AC-2/AC-3 → -02/-03)
  - [ ] 3.1 Live `LoadSlotConfig(scope)` over `app_config.model_routing` (platform-default config rows + shallow per-slot tenant merge, TTL 3600s backstop) + `invalidate(scope)` on every config write path — verify: 002c AC-1/AC-2 two-tenant + hot-swap tests
  - [ ] 3.2 Rule-2 enforcement: `HardcodedModelError` live + model-literal CI grep; per-role overrides legal only from tenant config — verify: planted literal fails CI (AC-3)
  - [ ] 3.3 Cascade blocks via `composeCascade`: L0/L1 locked (override rejected + traced), L2/L3 from ADR-002 rows, L4 context-as-data w/ budget trim, L5 hierarchy structurally last; byte-determinism — verify: AC-4..6, AC-8 tests
  - [ ] 3.4 PromptVersion-on-write for cascade-affecting config (H-3 obligation consumed by PRD-006) — verify: L2 write → prompt_versions row + prompt-set bump (AC-7)
- [ ] 4.0 Eval harness + observability — module acceptance gate (maps to: 002d FR-1..8 / AC-002-sport-runtime-31..-38, index AC-4 → -04)
  - [ ] 4.1 Migrations (authored plan → applied): `ai_traces` cost columns + indexes + 30-day retention job; `prompt_versions` (rationale NOT NULL); `eval_snapshots` (indefinite, `blocked` status) — verify: 002d AC-3/AC-4/AC-8 (RLS admin-only)
  - [ ] 4.2 Harness port: registry/runner (key-free posture), judge (fast + 10% deep escalation), golden sets (Kyle fixtures → Luminify-seed equivalents), per-tenant scope param, `pnpm evals` — verify: AC-1 keyless run exits 0
  - [ ] 4.3 Metric set v1 wired to targets/alerts (routing, retrieval-precision, agreement, interaction-mode, plan-fidelity, memory-continuity, faithfulness, drift checks); Voyage-429 → `blocked` not `pass` — verify: AC-2 + AC-6
  - [ ] 4.4 Model-slug smoke test (loud fail, no placeholder replies anywhere) + trace-coverage suite (every decision type ≥ 1 row) — verify: AC-5 + AC-7; then run full suite on seed for module AC-4

## Wave candidates

- 1.0 is independent of PRD-001's 3.0/4.0 (pure package; needs only 001 §2.1 shared types) — wave-1 parallel candidate.
- 2.0–4.0 are sequential within this module and share `lib/sport/` — never split across parallel agents in one wave.
- Cross-PRD: 002b's SpendAuthorizer stub is the seam PRD-007b replaces (`Modified here` collision — 002 and 007b must not share a wave); 002d's tables are read by PRD-006/007 (read-only, wave-safe).
