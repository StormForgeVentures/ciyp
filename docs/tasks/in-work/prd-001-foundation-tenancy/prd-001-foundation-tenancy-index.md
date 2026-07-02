# PRD-001: Platform Foundation & Tenancy

> Source: docs/project-brief.md + docs/architecture.md | Folder location = lifecycle status (do not add a Status field)

## Overview

### Goals

Stand up the build-once substrate every other module depends on: the pnpm/turbo monorepo with the four shared packages and the six frozen cross-repo contracts as typed zod schemas, the multi-tenant Postgres schema with two-layer RLS (tenant fence + member fence), and the realistic Luminify seed that makes every downstream surface verifiable against real data. Three distinct concerns: (1) workspace + contract freeze, (2) tenant-scoped schema with RLS and the index plan, (3) seed with edge shapes. Completing this module unblocks the template repo (published contracts) and every parallel build wave.

### Scope

| In scope | Out of scope |
|----------|--------------|
| pnpm + turbo monorepo scaffold (apps/api, apps/voice, apps/web, packages/*) | Any feature logic inside the apps (later PRDs) |
| `@stormforgeventures/ciyp-shared` zod schemas for contracts 01–06, incl. the frozen `parts` union | Contract *changes* (frozen at v1; change discipline per architecture §13) |
| Private-registry publishing of `@stormforgeventures/ciyp-shared` + `@stormforgeventures/ciyp-ui-tokens` (ADR-004) | The member UI consuming them (ciyp-template repo) |
| Multi-tenant schema: tenants, per-tenant app_config, all domain tables tenant-scoped | EL-OS data migration/backfill (greenfield — no Kyle data exists here) |
| Two-layer RLS + index plan shipped with the schema | Dedicated-tenant promotion tooling (ADR-001 seam only; runbook in PRD-008) |
| Platform tables: wallets, ledgers, stripe_*, entitlements, tenant_integrations (schema only) | Wallet/connector/store behavior (PRD-005, PRD-007, PRD-008) |
| Luminify seed with §10 edge shapes + test fixture tenant | Kyle/EL-OS content of any kind; client-coach content |

## Sub-PRDs

| Sub-PRD | File | Scope (one line) |
|---------|------|------------------|
| 001a | `prd-001a-foundation-tenancy-monorepo-contracts.md` | Monorepo scaffold + `@stormforgeventures/ciyp-shared` contract schemas + private-registry publish |
| 001b | `prd-001b-foundation-tenancy-schema-rls.md` | Multi-tenant Postgres schema, two-layer RLS, index plan, platform tables |
| 001c | `prd-001c-foundation-tenancy-luminify-seed.md` | Idempotent Luminify seed with edge shapes + isolation-test fixture tenant |

## Personas

- **Luminify operator (Tim/team)** — needs the platform substrate to be instance-agnostic, promotable (ADR-001), and seeded so every admin surface renders real data from day one.
- **Developer agents (build-time consumers)** — every downstream wave builds against these workspaces, schemas, and contracts; they need green typecheck/build, RLS they cannot accidentally bypass, and seed shapes that exercise their features' edge cases.

## Module-level acceptance criteria

| # | Given / When / Then |
|---|---------------------|
| AC-1 | Given a fresh clone with pnpm installed, when `pnpm install && pnpm build && pnpm typecheck && pnpm test` run at the repo root, then every workspace exits 0. |
| AC-2 | Given `packages/shared` in isolation, when its typecheck runs, then contracts 01–06 compile standalone with no import from `apps/*` or other packages except zod. |
| AC-3 | Given the DB seeded with the Luminify tenant and the fixture tenant, when the cross-tenant RLS sweep test runs with tenant A's `app.tenant_id` GUC set, then zero tenant-B rows are returned from any tenant-scoped table. |
| AC-4 | Given migrations + seed applied to an empty database, when the §10 seed-verification query suite runs, then every required shape exists (tenant, app_config slots, archetypes, tiers, process definitions, embedded library chunks, five demo members with edge shapes, wallet ledger that sums to balance, ai_traces and usage_ledger rows). |

## Core UX per Surface

- **None (developer-facing module).** No user-visible surface ships here; the "UX" is DX — one-command install/build/typecheck/test/seed, documented in the repo README.

## Technical Considerations

**UUID primary keys everywhere.** Non-negotiable (architecture §3): row identity must survive tenant promotion to a dedicated DB with keys intact. A serial/bigint PK anywhere breaks ADR-001's promotion path.

**Greenfield, but the migration discipline still binds.** There is no backfill (no Kyle data), yet the §4.1 lock-class rules apply to every future migration: no `NOT NULL DEFAULT ...` added in one step on existing tables; RLS policies ship in the same migration file as the table they guard; seed lands in the same parent task as schema.

**Fixture tenant for isolation proofs.** The product seed is one real tenant (Luminify, §10). RLS isolation cannot be proven with one tenant, so the test suite provisions a minimal second fixture tenant (a handful of rows per table) — test fixture, not product seed; it must not appear in production data.

### Security

RLS is the platform's primary data boundary: every tenant-scoped table carries `USING`/`WITH CHECK` policies keyed on `current_setting('app.tenant_id')` in the same migration that creates it; member-owned tables carry the second (member) fence. Service-role credentials are confined to migrations, seed, and explicitly-audited server paths. No secrets, API keys, or real member PII in seed data.

## Dependencies

| Dependency | Source | Status |
|------------|--------|--------|
| Supabase local stack (Postgres + pgvector) | developer environment | Required |
| Paid Voyage API key (seed embeddings) | ADR-007 build prerequisite | Required |
| Private npm registry (GitHub Packages, as used by sport-ai-sdk) | Luminify org | Required |
| `docs/contracts/01–06` (contract specs to encode) | architecture phase | Available |

## Non-Goals

- No EL-OS data migration or backfill — extraction is of *patterns*, not data.
- No coach-IP enums (ADR-002): archetypes/tiers/methods exist only as per-tenant rows.
- No connector, wallet, store, or admin behavior — schemas here, logic in PRD-005/006/007/008.
- No self-serve provisioning; no dedicated-tenant deployment.

## Success Metrics

- Wave-0 exit: all four module ACs green, enabling parallel waves to start.
- `ciyp-template` unblocked: `@stormforgeventures/ciyp-shared` + `@stormforgeventures/ciyp-ui-tokens` installable from the private registry at a pinned version.
- Zero Kyle-specific identifiers in schema or seed (grep-verifiable; success criterion 6 of the brief).

## Implementation Priority

1. **001a (monorepo + contracts)** — first; the contract freeze gates the template repo and every parallel agent (architecture §13: contracts freeze before parallel build).
2. **001b (schema + RLS)** — second; every feature table, policy, and index other PRDs cite comes from here.
3. **001c (seed)** — same wave as 001b (seed ships with schema per convention); depends on 001b tables and 001a workspace tooling.

## Related

- Task list: `tasks-001-foundation-tenancy.md` (this folder — generate-tasks output)
- QA report: `qa/qa-001-foundation-tenancy.md` (authored by the qa-reviewer, NOT the PM)
- Acceptance ledger: `handoff/acceptance-ledger.md` (`AC-001-foundation-tenancy-NN` rows)
