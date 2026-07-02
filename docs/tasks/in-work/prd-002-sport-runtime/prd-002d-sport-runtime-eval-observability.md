# PRD-002d: Eval Harness + Observability

> Parent: prd-002-sport-runtime-index.md | Module: Sport Runtime — AI Engine + Execution Substrate

## Goal

Port the EL-OS eval harness and stand up the evidence layer: extended `ai_traces` as the single source of
truth for every AI decision (and the metering substrate PRD-007 reads), `prompt_versions` for every prompt
change, `eval_snapshots` for every eval run. "No eval, no ship" is structural in Sport (an eval-less
process cannot register); this sub-PRD supplies the metrics, golden sets, runner, and the two ops lessons
ScalingCFO paid for — a paid Voyage key and a model-slug smoke test that fails loudly.

## Functional requirements

1. **Harness port** from EL-OS `apps/api/src/evals`: `registry.ts` (EvalSpec[]), `runner.ts` with the key-free posture (specs declaring `needsModelKey`/`needsEmbedKey` skip cleanly when keys are absent; a spec returning `null` self-skips; one bad spec never aborts the run), `judge.ts` (LLM-as-judge via `fast`/`deep` slots), golden fixtures under `evals/golden/`, seed corpus tooling, `pnpm evals` entrypoint.
2. **Metric set v1** (targets/alerts per `docs/ai-architecture/feature-classification.md`): `routing_accuracy` (0.9/0.85) · `retrieval_precision_library` (0.7/0.4) · `agreement_rate` (anti-sycophancy heuristic, reported) · `interaction_mode_correctness` (0.9/0.8) · `plan_document_fidelity` (1.0/1.0) · `member_memory_continuity` (1.0/1.0 — asserts recalled L2 fact + L1 reach the composed grounding) · `faithfulness` judge (0.95/0.8) · static drift checks (cross-package constant parity). Golden sets port from EL-OS where content is coach-agnostic; Kyle-content fixtures are replaced by Luminify-seed equivalents (PRD-001).
3. **Per-tenant evals:** the runner takes a tenant scope; provisioning (PRD-008) and config activation (PRD-006) invoke it against a specific tenant's config.
4. **`ai_traces` extension:** add `prompt_tokens`, `completion_tokens`, `provider`, `model`, `cost_micros` (nullable-add → backfill n/a greenfield → constrain, per §4.1 lock discipline); every model-call row populates them; **`cost_micros` may be honest-zero for off-table models** — the pricing authority is PRD-007's pricebook (OQ-A), never this table alone. 30-day retention, admin-only RLS; redaction port applied before write.
5. **`prompt_versions`:** synchronous write, rationale required, tenant-scoped; written on baseline registration (002a), cascade-affecting config writes (002c), and coach-authored definition activation (PRD-006). **`eval_snapshots`:** indefinite retention, linked to the prompt-set version they evaluated.
6. **Model-slug smoke test** (ScalingCFO decision-#26 lesson): a startup/CI check runs a 1-token completion against every configured chat-capable slot of the seed tenants; an empty/errored completion **fails the check loudly** — no silent placeholder replies anywhere in the runtime (an empty model result in a live turn raises, never degrades to placeholder text).
7. **Paid Voyage key** is a documented environment prerequisite (ADR-007); retrieval evals refuse to report a pass on free-tier rate-limit skips (a rate-limited run reports `blocked`, not `pass`).
8. Trace coverage test: executing the full golden turn suite yields ≥ 1 trace row per AI decision type in the taxonomy (classify, model call, retrieval, rerank, memory recall, linter intervention, tool dispatch).

## Acceptance criteria

| # | Given / When / Then |
|---|---------------------|
| AC-1 | Given no provider keys in the environment, when `pnpm evals` runs, then key-requiring specs report `skipped`, key-free specs complete, and the process exits 0. |
| AC-2 | Given the Luminify seed and keys present, when the suite runs, then every metric row in `eval_snapshots` carries value, target, and alert, linked to the tenant's prompt-set version. |
| AC-3 | Given a model-call trace row from any golden turn, then `prompt_tokens`, `completion_tokens`, `provider`, and `model` are non-null. |
| AC-4 | Given a cascade-affecting config write without a rationale string, when the write is attempted, then it is rejected (prompt_versions rationale constraint). |
| AC-5 | Given a seeded slot pointing at a slug that returns empty completions, when the smoke test runs, then it exits non-zero naming the slot and slug. |
| AC-6 | Given a Voyage 429 during the retrieval-precision eval, when the run completes, then that metric reports `blocked` (not `pass`) and the snapshot records the block reason. |
| AC-7 | Given the trace-coverage suite, when it completes, then every decision type in the event taxonomy has ≥ 1 row (missing type = failing test naming it). |
| AC-8 | Given a non-admin authenticated role, when it queries `ai_traces` or `eval_snapshots`, then RLS returns zero rows. |

## Data requirements

Per `../..`/references discipline (migration plans authored here; Developer applies):
- `ai_traces` + columns above; indexes `(tenant_id, created_at)` and `(tenant_id, event_type)`; 30-day retention job.
- `prompt_versions` (tenant_id, prompt_set_version, block/baseline ref, rationale NOT NULL, actor, created_at).
- `eval_snapshots` (tenant_id, prompt_set_version FK, metric, value, target, alert, status enum incl. `blocked`, run_id, created_at) — no retention job (indefinite).

## Endpoints

`pnpm evals` CLI + an internal dev route group (builder-gated) for trace/eval inspection; the admin-facing
eval review UI is PRD-006's. No public endpoints.

## UI/UX

No frontend changes in this slice.

## Hybrid Interface

Not applicable — infrastructure. (The prompt-management UI hybrid contract is PRD-006's and cites these
tables as its shared shape.)

## Dependencies

| Dependency | Source | Status |
|------------|--------|--------|
| Turn execution path (traces to observe) | prd-002b/002c | Required |
| Luminify seed golden corpus + 2nd tenant fixture | PRD-001 | Required |
| Paid Voyage API key | Ops | Required |
| Pricebook pricing of trace cost | PRD-007 (OQ-A) | Consumed there |

## Open questions

| # | Question | Why it matters | Resolution |
|---|----------|----------------|------------|
| Q-1 | Which judge slot for faithfulness — `fast` or `deep`? | Cost vs judge quality | Interim: `fast` with a `deep` escalation sample (10%); tune on seed results. |
| Q-2 | Trace retention 30 days — enough for metering disputes? | PRD-007 bills from usage_ledger, not traces | Decided: ledger is the billing record (append-only, indefinite); 30-day traces stand. |
