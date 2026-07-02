# PRD-008b: Instance Provisioning Runbook + Script

> Parent: prd-008-store-provisioning-index.md | Module: Program-Access Store & Instance Provisioning

## Goal

Stand up a new coach tenant green from a per-coach intake document with one operator-run script — the
architecture §10 runbook made executable. Manual by design in v1 (self-serve is P2): the deliverable is a
repeatable, idempotent, eval-gated script plus the intake template that feeds it, so onboarding coach #2..N
is an afternoon of content work, not an engineering project. The same stepwise script is the declared
foundation of the ADR-001 promotion runbook (noted as a constraint on its shape; promotion itself is not
built here).

## Functional requirements

1. `provision` CLI (in `apps/api/src/lib/provisioning/`) executes the six runbook steps in order, each as a
   discrete, resumable unit with per-step pass/fail output:
   1. insert `tenants` row (UUID id);
   2. seed tenant config from the intake — `app_config` (model routing per the ai-architecture slot table,
      `tts.voice_id`), `tenant_archetypes`, `tenant_tiers`, `coaching_process_definitions` directives,
      `tenant_integrations`;
   3. ingest the coach's body of work through the PRD-005a pipeline (chunk → embed 1024-dim, tenant-fenced);
   4. create Stripe objects — **coach-Stripe connector setup** (ADR-008: coach supplies a restricted API
      key — the runbook recommends a dedicated Stripe account for this, GHL-style, not required; the
      script/console stores it in the 005c vault, then creates the member-facing product/price AND the
      per-tenant webhook endpoint ON the coach's account, recording `stripe_account_ref` on the tenant) +
      platform-side billing linkage for wallet recharge + the tenant wallet with its markup rate
      (PRD-007a); the key hand-off is a human step — the script records `pending_stripe_key` and resumes
      once the connector validates (like Q-3's OAuth interim);
   5. run the eval golden set against the new tenant's config — **no eval, no ship**: any metric below
      target fails the step and the script exits non-green;
   6. emit/verify Instance Config (contract 01) for the member UI.
2. Input is a structured intake document (template is a deliverable): coach identity/branding, archetypes,
   tiers, method directives, model-routing overrides, voice id, integration choices, body-of-work manifest,
   markup rate (OQ-3 default until Tim sets it).
3. Intake is validated against a zod schema before any write; validation errors name the field and the fix.
4. `--dry-run` prints the full plan (steps, target rows, files to ingest) with zero writes.
5. Re-running after a partial failure is safe: completed steps detect their prior output and no-op
   (idempotency keys: tenant id + step name); no duplicate rows on re-run.
6. Every write happens under the new tenant's `tenant_id` via the same tenant-scoped access paths the
   runtime uses — no RLS bypasses beyond the operator service role the script runs as.
7. The script's step interface takes an injected DB handle/`TenantContext`, so ADR-001 promotion can reuse
   steps 1–6 against a fresh dedicated DB without modification.
8. A runbook document accompanies the script: prerequisites (keys, Stripe account state, paid Voyage key),
   step semantics, failure recovery per step, and the go-live checklist.

## Acceptance criteria

Each verifiable by an agent. These become `AC-008-store-provisioning-NN` rows at generate-tasks time.

| # | Given / When / Then |
|---|---------------------|
| AC-1 | Given a clean database and a valid intake file, when `provision` runs, then all six steps report pass and the exit code is 0. |
| AC-2 | Given a provisioned tenant, then its `app_config`, archetypes, tiers, and process definitions match the intake file field-for-field (diff test). |
| AC-3 | Given an intake file missing a required field (e.g. `tts.voice_id`), when `provision` runs, then it exits non-zero before any DB write, naming the field. |
| AC-4 | Given `--dry-run` against a clean database, when the script completes, then row counts in every tenant-scoped table are unchanged. |
| AC-5 | Given a run killed after step 3, when `provision` re-runs with the same intake, then steps 1–3 no-op (no duplicate tenant, config, or library rows) and steps 4–6 complete. |
| AC-6 | Given a tenant whose config fails an eval-golden-set target (fixture with a sabotaged directive), when step 5 runs, then the script exits non-green and does not emit Instance Config. |
| AC-7 | Given a completed provisioning run, when the seeded eval + retrieval queries run scoped to the NEW tenant, then zero rows from any other tenant appear in results (isolation sweep). |
| AC-8 | Given a completed run, when Instance Config (contract 01) is fetched for the tenant, then it validates against the `@stormforgeventures/ciyp-shared` schema and every branded string traces to the intake. |

## Data requirements

No new tables. The script writes exclusively to structures owned elsewhere: `tenants`, `app_config`,
`tenant_archetypes`, `tenant_tiers`, `coaching_process_definitions`, `tenant_integrations` (PRD-001b),
library tables (PRD-005a), `wallets`/`wallet_ledger` (PRD-007a), Stripe linkage rows (008a). One additive
piece: a `provisioning_runs` audit table — `id`, `tenant_id`, `step` (text), `status`
(`pending|done|failed`), `idempotency_key` (unique), `detail` (jsonb), `created_at` — the resume/no-op
source of truth (created here).

## Endpoints

No new HTTP endpoints. The CLI entrypoint (`pnpm provision -- --intake <file> [--dry-run]`) plus the
internal step functions; step 6 calls the existing Instance Config emission (PRD-006b).

## UI/UX

No frontend changes. CLI output contract: one line per step (`[1/6] tenants … ok`), failures with the
failing check and recovery pointer into the runbook doc; final verdict line `go-live-ready: yes|no`.

## Hybrid Interface

Not applicable — Traditional lane (feature #15; the eval-gate step consumes AI infrastructure, it doesn't generate).

## Dependencies

| Dependency | Source | Status |
|------------|--------|--------|
| All tenant-config tables + RLS | PRD-001b | Required |
| Library ingestion pipeline (step 3) | PRD-005a | Required |
| Wallet creation + markup config (step 4) | PRD-007a | Required |
| Stripe product/price creation (step 4) | PRD-008a | Required |
| Eval golden-set runner + targets (step 5) | PRD-002d | Required |
| Instance Config emission (step 6) | PRD-006b (contract 01) | Required |
| `provisioning_runs` audit table | This sub-PRD | Created here |
| Intake template + runbook doc | This sub-PRD | Created here |

## Open questions

| # | Question | Why it matters | Resolution |
|---|----------|----------------|------------|
| Q-1 | Default markup rate in the intake template (architecture OQ-3)? | Step 4 needs a number; it's pricing policy, not architecture. | Interim: template ships with a placeholder default and a required-review flag; Tim sets the real default before the first non-Luminify tenant. |
| Q-2 | Are Luminify's real archetype/tier names (OQ-2) provisioning input or seed content? | Decides whether PRD-001c's placeholders get replaced via this script. | Decided: provisioning input — the seed keeps generic placeholders; Tim authors real content in an intake and re-runs config steps when ready. |
| Q-3 | Does step 3 accept Granola/Fathom connectors at provision time, or uploads only? | Connector OAuth needs a human consent hop mid-script. | Interim: step 2 records integration *intent* in `tenant_integrations` (pending state); OAuth consent completes post-script via the PRD-005c UI. |
