# PRD-002a: Engine Port — `packages/agents` + `packages/prompts`

> Parent: prd-002-sport-runtime-index.md | Module: Sport Runtime — AI Engine + Execution Substrate

## Goal

Port the EL-OS pure brain into `@ciyp/agents` and `@ciyp/prompts`, generalized to be coach-agnostic: the
classifier, linter chain, interaction engine, cadence agents, process runner, tool dispatcher, and the
prompt/persona composition layer — with every Kyle-specific enum, persona, and content string removed per
ADR-002. This is the single most reusable asset in the platform (the same brain serves shared and
dedicated deployments unchanged) and the port is an *extraction*, not a rewrite: EL-OS file structure and
test suites come with it.

## Functional requirements

1. `@ciyp/agents` dependencies are exactly `@ciyp/shared` + `zod`; no provider SDK, no Supabase, no Sport imports.
2. All LLM-touching agents accept an injected `AgentSubstrate = { llm: LlmCaller; getModelSlot; traceAICall }`; unit tests run with mock substrates and no network.
3. Ported components (from EL-OS `packages/agents/src`, same public surface via `index.ts`): supervisor classifier (fast slot, temperature 0, bounded tokens, zod-validated routing JSON with always-safe fallback), language-signal scan, the 4-linter chain in canonical order `voice → no_shame → playfulness → retention`, orchestrator turn callable, tool dispatcher, member-doc reference detector, process runner + deterministic goal-gate, cadence agents (daily / weekly / monthly bounded threads with forced finalize), interaction engine (`instruct / call_response / free / hold`), utility agents, plan-document artifact renderer + fidelity check.
4. De-enum applied at the type level: `CodeProcessDefinition` keeps the `source: 'code' | 'authored'` seam; `agent_kind`, archetype, and tier values are **opaque tenant-config strings**, never TS enums or unions naming coach concepts. Platform-mechanic enums (interaction_mode, modality, output_type, fact tiers, etc.) stay.
5. Kyle's coaching processes (pmm, harmonizer, five_planes, eft_tapping), archetype voices (hawkins, kwan-yin, merlin, moses, tesla), and monthly-RWW content do **not** port. The monthly cadence agent ports with a generic key (`monthly_review`) and a directive placeholder; Luminify seed provides real directives (PRD-001).
6. `@ciyp/prompts` ports the composition machinery: state-taxonomy fragments, question/quote selection, orchestrator persona block, classifier prompt builder, voice-rules/retention/no-shame prompt sources, and the `registerPromptBaselines` registry — all content either platform-generic or clearly marked seed-placeholder; zero Kyle text.
7. Tool dispatcher: closed manifest ("never shrinks; only grows"), each tool with a zod arg schema validated before execution, executors injected by the runtime (RLS-respecting; graceful-empty degradation when a backing table is absent), every dispatch wrapped in `traceAICall`. v1 manifest = the EL-OS seven, renamed generically: `cite_library_item`, `lookup_member_context`, `get_recent_checkin_outputs`, `get_recent_coaching_outputs`, `flag_for_review`, `set_interaction_mode`, `read_member_doc`.
8. EL-OS unit tests port with the code (~3.2K test LOC baseline); every generalization keeps its test.

## Acceptance criteria

| # | Given / When / Then |
|---|---------------------|
| AC-1 | Given `packages/agents/package.json`, then its `dependencies` contain exactly `@ciyp/shared` and `zod`. |
| AC-2 | Given a mock substrate, when the classifier receives malformed model output, then it returns the documented safe-fallback route and the failure is passed to `traceAICall`. |
| AC-3 | Given a drafted reply, when the linter chain runs, then linters execute in canonical order and each intervention is reported in the chain result (order asserted by test). |
| AC-4 | Given a `CodeProcessDefinition` with `source: 'authored'` and valid shape, when the process runner executes it, then it runs identically to a `source: 'code'` definition (same runner, no branch on source except provenance). |
| AC-5 | Given the identifier list `reconnector|stabilizer|integrator|self_led|embodied_leader|catapult|mastermind|concierge|pmm|harmonizer|five_planes|eft_tapping|hawkins|kwan.?yin|merlin|moses|tesla|rww|real wealth wheel|kyle|rapid harmony|empowered leader`, when case-insensitive grep runs over `packages/` and `apps/`, then zero matches (CI check; `docs/` excluded). |
| AC-6 | Given a tool dispatch with args failing its zod schema, when dispatched, then the executor is not invoked and a structured validation error returns to the caller. |
| AC-7 | Given an executor whose backing table does not exist, when its tool is dispatched, then the tool returns its documented empty shape (no throw) and the degradation is traced. |
| AC-8 | Given a cadence thread at its bounded turn limit, when the next turn executes, then the agent produces its forced-finalize output and marks the thread complete. |

## Data requirements

No data model changes. This package is pure; all persistence happens through injected executors/substrate
(tables owned by PRD-001/PRD-003).

## Endpoints

No new endpoints.

## UI/UX

No frontend changes.

## Hybrid Interface

Not applicable — AI infrastructure (no user-facing surface pair).

## Dependencies

| Dependency | Source | Status |
|------------|--------|--------|
| `@ciyp/shared` types (ModelSlot union, parts union, contract schemas) | PRD-001 | Required |
| EL-OS `packages/agents` + `packages/prompts` source | `/mnt/c/Repos/empowered-leader-os` (read-only) | Available |
| Substrate implementations (real `llm`/`getModelSlot`/`traceAICall`) | prd-002b / prd-002c | Created there |

## Open questions

| # | Question | Why it matters | Resolution |
|---|----------|----------------|------------|
| Q-1 | Do the 4 linters stay platform-locked or become per-tenant-tunable thresholds? | EL-OS hardcodes thresholds; coaches may want tone variance | Decided: platform-locked in v1 (EL-OS parity; anti-sycophancy refusal carries forward per prd-002c). Revisit with agent-studio v2. |
| Q-2 | Does `flag_for_review` (EL-OS `flag_for_red_review`) need a per-tenant escalation target? | Safety escalations must reach a human per tenant | Interim: escalation writes a tenant-scoped admin notification row (PRD-006 renders); no external paging in v1. |
