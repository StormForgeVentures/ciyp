# ciyp-platform

> Project context home. This file is yours — cadre created it once (2026-06-18) and will never
> overwrite it. Everything agents need to know about THIS project lives here; everything about
> how agents work lives in their generated files (regenerate with `cadre deploy`).

## Identity

- **What this is:** The **engine + business platform** for Coach in Your Pocket (CIYP) — the build-once, multi-tenant asset every coach instance depends on. Holds the AI engine (`packages/agents` brain + `packages/prompts`), the AI **runtime** (`apps/api`: agent execution, RAG, cadence, the eval harness), the **voice** runtime (`apps/voice`, Pipecat), the multi-tenant coach **admin** (`apps/web`), the **AI wallet/credits/billing/enforcement**, usage rollup, instance-config authoring, the program-access store, and instance provisioning. Derived by extracting & generalizing Empowered Leader OS (instance #1, coach Kyle Brown) — *not* a rebuild. **This is priority #1**; the sibling member UI is built after.
- **Client / owner:** Luminify (Tim Wolf)
- **Stage:** production   <!-- production (default) | mvp | prototype | client-facing — cadre reads this; mvp/prototype mean smaller scope, never lower quality. Production: this platform holds real money (wallet/billing) and serves every coach. -->
- **Workflow:** saas-build   <!-- saas-build | brand-website — drives the PM's pipeline -->
- **Lifecycle:** by-folder   <!-- flat (default) | by-folder — by-folder = PRD-as-folder + status-is-location under docs/tasks/{backlog,in-work,completed}/ (also turns on handoff/acceptance-ledger.md); flat = single docs/tasks/*.md files. SET to by-folder 2026-06-18: CIYP is a multi-PRD program (EL-OS shipped ~25 specs), earns the PRD-folder + acceptance-ledger structure. -->
- **Vault project:** Areas/CIYP-Platform   <!-- alpha-vault subpath (e.g. Projects/<slug>, Areas/<x>) — pm-report writes session reports here; permissions are scoped to this folder only -->
- **Sibling repo:** `ciyp-template` (`/home/twolf/repos/ciyp-template`) — the **thin member UI** (Expo), **MVP** stage, built after this. Shares a `shared-core` package + 6 frozen cross-repo contracts. System brief: `docs/project-brief.md` (discovery already complete; next phase here is **architecture**).
- **Source instance:** Empowered Leader OS at `/mnt/c/Repos/empowered-leader-os` — port *from* it; never modify it.

## Stack

- **Frontend:** Vite + React + TanStack — multi-tenant coach admin (`apps/web`)
- **Backend:** Hono + workers (`apps/api`) — AI runtime (agent execution, RAG, cadence, eval harness), wallet/billing, usage rollup, provisioning · Pipecat (Python, `apps/voice`) — real-time voice runtime
- **Database:** Supabase Postgres + pgvector — multi-tenant control plane (member-data topology is a lead ADR — see brief)
- **Auth:** Supabase Auth (coach/admin tenants)
- **Hosting:** TBD per architecture
- **Shared:** `packages/{agents,prompts,shared,ui-tokens}` — the provider-agnostic AI brain + contracts, consumed by both repos

## Conventions

- **Never ship mock.** Mock/contract layers are build scaffolds only. A surface is DONE when it runs on real data: live endpoint, validated against its contract, integration-tested against the real DB, every handler implemented. Seed data is part of "done" — empty DB = empty screens.
- Build against the live (local) database with realistic seed; components bind to real DB fields, never hardcoded mockup content.
- (add project-specific conventions here)

## Layout

<!-- Where the code lives — agents read this and never assume root src/. One line per surface. -->

- (e.g. `main-site/` — marketing site, Next.js)
- (e.g. `app/` — product app · `admin/` — back office · `packages/` — shared libs)

## Key paths

- Spec / PRDs: `docs/tasks/`
- Wave plan + handoff artifacts: `handoff/`
- Project memory (agents write lessons here): `.claude/memory/`

## Agent team

This project runs the cadre agent team (see `.claude/agents/` / `.cursor/rules/`). The human checkpoints are **plan** (approve the spec/wave plan) and **acceptance** (test the result). The middle runs autonomously with self-verification. Escalations land here when an agent exhausts its 3-attempt fix loop.
