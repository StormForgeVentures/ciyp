# PRD-001a: Monorepo Scaffold & Cross-Repo Contract Freeze

> Parent: prd-001-foundation-tenancy-index.md | Module: Platform Foundation & Tenancy

## Goal

Deliver the pnpm + turbo monorepo (ported shape from EL-OS, architecture §2.1) and encode the six cross-repo contracts as typed zod schemas in `@stormforgeventures/ciyp-shared`, published with `@stormforgeventures/ciyp-ui-tokens` to the private registry so `ciyp-template` pins a known-good contract version (ADR-004). This is the freeze point: after 001a ships, contract changes follow the §13 change discipline, and parallel build waves may fan out.

## Functional requirements

1. Workspace: `pnpm-workspace.yaml` + `turbo.json` with `build`, `dev`, `lint`, `typecheck`, `test` pipelines; `tsconfig.base.json`; Node ≥ 22; prettier + eslint at root (EL-OS conventions).
2. App scaffolds compile and start empty: `apps/api` (Hono + `@hono/node-server`), `apps/web` (Vite + React + TanStack), `apps/voice` (Python/Pipecat skeleton with Dockerfile, `requirements.txt`, pytest — no pipeline logic yet).
3. Package scaffolds: `packages/agents` (deps: `@stormforgeventures/ciyp-shared` + `zod` ONLY), `packages/prompts` (zero runtime deps), `packages/shared`, `packages/ui-tokens`.
4. Purity enforcement: an automated check (dependency-lint test) fails the build if `packages/agents` or `packages/prompts` gain a disallowed dependency, or if any workspace imports `@earendil-works/*` directly (ADR-006 constraint).
5. `@stormforgeventures/ciyp-shared` exports zod schemas + inferred TS types for all six contracts (`docs/contracts/01–06`): InstanceConfig, CoachingAPI (request/response + SSE event types), UsageEvent, SpendAuthorization, Entitlement, and the shared-core package API surface (contract 06 = the export manifest itself).
6. The `chat_messages.parts` discriminated union is encoded exactly as frozen: `text | audio | library_citation | process_offer | voice_input_ref` — closed union, same schema used for wire, storage, and renderer typing (architecture §4.5).
7. Contract fixture suite: for each contract, at least one valid and one invalid JSON fixture, parsed in tests against the schemas.
8. Publish workflow: `@stormforgeventures/ciyp-shared` + `@stormforgeventures/ciyp-ui-tokens` versioned and published to the private registry (GitHub Packages, same org pattern as sport-ai-sdk); `apps/*` consume them via `workspace:*`.
9. CI entrypoint (single command or workflow) running install → typecheck → build → test across the workspace.

## Acceptance criteria

| # | Given / When / Then |
|---|---------------------|
| AC-1 | Given a fresh clone, when `pnpm install && pnpm -r typecheck && pnpm -r build` run, then every workspace exits 0. |
| AC-2 | Given `packages/agents/package.json`, when the dependency-lint test runs, then it asserts dependencies are exactly `@stormforgeventures/ciyp-shared` + `zod` and fails on any addition. |
| AC-3 | Given any workspace source file importing `@earendil-works/*`, when the dependency-lint test runs, then the build fails citing ADR-006. |
| AC-4 | Given the valid fixture for each of contracts 01–06, when parsed with its `@stormforgeventures/ciyp-shared` schema, then parsing succeeds; given the invalid fixture, then parsing throws a zod error. |
| AC-5 | Given a `parts` payload containing an unknown `kind`, when parsed with the parts-union schema, then parsing fails (closed union at v1). |
| AC-6 | Given a version bump commit, when the publish workflow runs, then `@stormforgeventures/ciyp-shared` and `@stormforgeventures/ciyp-ui-tokens` install successfully into a clean external project from the private registry. |

## Data requirements

No data model changes (no database in this sub-feature).

## Endpoints

No new endpoints. `apps/api` boots with a health route only (`GET /health` → `{ ok: true }`) to prove the scaffold runs.

## UI/UX

No frontend changes in this slice (apps/web boots to an empty shell page).

## Hybrid Interface

Not applicable — Traditional lane (build infrastructure).

## Dependencies

| Dependency | Source | Status |
|------------|--------|--------|
| `docs/contracts/01–06` specs | architecture phase | Available |
| Private npm registry access (org token) | Luminify GitHub org | Required |
| EL-OS repo (read-only porting reference) | `/mnt/c/Repos/empowered-leader-os` | Available |

## Open questions

| # | Question | Why it matters | Resolution |
|---|----------|----------------|------------|
| Q-1 | Registry: GitHub Packages vs alternatives? | Template repo must authenticate to install | Decided: GitHub Packages (matches sport-ai-sdk distribution; one org, one token story). |
| Q-2 | Contract-06 versioning cadence (publish on every merge vs tagged releases)? | Template pin stability | Interim: manual tagged releases during v1; revisit at first template consumption. |
