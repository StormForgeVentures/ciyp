# Project Brief — Coach in Your Pocket (CIYP), v1 · SYSTEM BRIEF

> Status: **awaiting Tim's approval (plan gate)** · Stage: **production** · Workflow: **saas-build** · Created: 2026-06-18
> Discovery was completed in a working session in the sibling `ciyp-template` repo; this is the canonical
> output. **This repo (`ciyp-platform`) is the primary build** — the next phase here is **architecture**,
> not a re-run of discovery. The member UI (`ciyp-template`) is the secondary, lighter build.

## What we're building & why now

The reusable **Coach in Your Pocket** product — an AI coaching engine a coach's clients carry in their
pocket, grounded in that coach's body of work. We build it by **extracting and generalizing** Empowered
Leader OS (EL-OS, the first instance, hardcoded to coach Kyle Brown), **not by rebuilding it**.

**Why now:** EL-OS proved the pattern. Standing up the platform now means instance #2..N inherit the
engine cheaply instead of each becoming a bespoke fork that drifts.

## North star

For **each coach**, create the **best AI-driven path to transformation for all of their clients** — by
turning the coach's body of work into an always-available, voice-capable, memory-backed coaching
presence, and by offloading the AI/infra plumbing so the coach can scale.

## Two repos — engine-first (load-bearing decision)

EL-OS proved the architecture: `packages/agents` is a **pure, provider-agnostic brain** (deps =
`@elos/shared` + `zod` only); `apps/api` (Hono) is where AI **executes** (agent-wiring, prompt cascade,
RAG/embeddings, cadence execution, **the full eval harness**); `apps/voice` is a portable **Pipecat**
Python service; `apps/mobile` is a **thin Expo client** (deps = shared types + Expo only — zero AI). The
member app *calls* the engine; it doesn't run one. That is why the split is engine-first:

| | **`ciyp-platform`** (THIS repo) | **`ciyp-template`** (sibling) |
|---|---|---|
| **Role** | The build-once asset: AI engine + runtime + business platform | **Thin Expo UI** — binds to config, calls the engine |
| **Stage** | **Production** | **MVP** |
| **Tenancy** | Multi-tenant control plane | Per-instance (one coach) |
| **Build order** | **First — the most important thing** | After — "mostly UI state" |
| **Holds** | `packages/{agents,prompts,shared,ui-tokens}` · `apps/api` (execution, RAG, cadence, **eval**) · `apps/voice` (Pipecat) · multi-tenant **admin** (`apps/web`) · **AI wallet / billing / enforcement** · usage rollup · instance-config authoring · program-access store · provisioning | `apps/mobile` (native + PWA) · voice client UI · check-in & coaching screens · entitlement/secure-store · config consumption |

```
ciyp-platform (PRODUCTION)                       ciyp-template forks (MVP, per coach)
┌──────────────────────────────────────────┐    ┌── Coach A UI ──┐ ┌── Coach B UI ──┐
│ AI ENGINE: agents · prompts · apps/api     │    │ Expo mobile    │ │ Expo mobile    │
│   (execution · RAG · cadence · EVAL)       │◀──▶│ voice client   │ │ voice client   │
│ apps/voice (Pipecat)                       │ API│ thin, branded  │ │ thin, branded  │
│ admin (multi-tenant) · instance config     │    └────────────────┘ └────────────────┘
│ AI WALLET: credits·topups·billing·enforce  │
│ usage rollup · store/entitlements · provision
└──────────────────────────────────────────┘
        shared-core package (agents · prompts · shared · ui-tokens) ── consumed by both
```

### Three money flows (kept distinct)

| Flow | Direction | Mechanism | Owner | v1 |
|---|---|---|---|---|
| Program/access sale | Member → Coach | Stripe web checkout → entitlement | platform | P0 |
| AI usage billing | Coach → Luminify | **Prepaid wallet/credits**, metered, **enforced** | platform (meter from runtime) | P0 |
| AI cost to members | Coach absorbs | funded by what the coach charges — no machinery | — | n/a |

One **wallet per coach**, funded via prepaid credits (auto-recharge at low balance), drawn down by *all*
AI consumption — the coach's own transcription/ingestion **and** every student's chat/voice/cadence.
Luminify is the single AI vendor of record. Credit unit abstracted from raw provider cost (configurable
markup = margin). Enforcement pauses spend-heavy calls (voice, transcription) at zero balance.

## Users & personas

1. **Luminify operator** (Tim/team) — provisions/maintains coach instances; superadmin; owns AI economics.
2. **The Coach + team** — admin users of one tenant: load body-of-work, configure their model
   (archetypes/tiers/journeys **as config, not enums**), run evals, manage clients, fund & monitor the
   AI wallet. *(v1 seed = Tim / Luminify — "helping coaches become AI-enabled software companies.")*
3. **The Member / client** — native mobile (+ PWA): daily check-ins, text **and voice** coaching grounded
   in the coach's library, memory-backed; unlocks access by purchase. *(served by the thin UI repo)*

## Capabilities & priority — `ciyp-platform`

| Pri | Capability |
|---|---|
| P0 | **AI engine** — generalize `packages/agents` (orchestrator, coaching methods, cadence, interaction-engine) + `packages/prompts`; de-couple from Kyle's specifics |
| P0 | **AI runtime** (`apps/api`) — agent-wiring, prompt cascade, provider wiring, RAG/embeddings, cadence execution |
| P0 | **Eval harness + observability** — port `apps/api/src/evals` (judge, golden, retrieval-precision, routing-accuracy); add **explicit rubric + bar** (no-eval-no-ship); `ai_traces` on every call |
| P0 | **Voice runtime** (`apps/voice`, Pipecat) — adapt the EL-OS Python service to be instance-configurable |
| P0 | **Multi-tenant admin** (`apps/web`) — coach auth, tenant mgmt, superadmin |
| P0 | **Instance identity & config authoring** — archetypes/tiers/journeys as config (the de-enum source of truth) |
| P0 | **Library ingestion + management** — upload body of work → chunk → embed |
| P0 | **AI wallet** — credits, top-ups, Stripe recharge, balance ledger, enforcement policy |
| P0 | **Usage metering aggregation + rollup** — receive runtime events → bill |
| P0 | **Program-access store** — Stripe web checkout → entitlement issuance |
| P0 | **Instance provisioning runbook + script** — stand up a member instance green |
| P1 | Prompt management/versioning UI · usage analytics dashboards · admin team roles · MCP transcript ingestion |

## Capabilities & priority — `ciyp-template` (member UI, MVP)

P0: member auth/identity (per-instance) · coaching chat UI (text) · **voice client UI** · daily-check-in
UI · memory-surfacing UI · config + branding consumption · entitlement gating · graceful "wallet paused"
UX. P1: weekly/monthly cadence UIs · richer journey UI. *(All AI execution is server-side in the engine;
this repo renders and calls it.)*

## Cross-repo contracts (frozen in architecture, before parallel build)

1. **Instance Config** (platform → UI): coach identity, archetypes, tiers, journeys, branding, prompt-set
   version, model routing.
2. **Coaching API** (UI → engine): chat/turn, check-in, voice session — request/response + streaming.
3. **Usage Event** (runtime → ledger): `{instance, member, feature, model, in/out tokens, provider, cost,
   ts, idempotency_key}` — at-least-once + idempotent.
4. **Spend Authorization** (runtime ↔ wallet): authorize before spend-heavy calls; allow/deny + remaining;
   cache w/ TTL, hard-check expensive ops.
5. **Entitlement** (platform → UI): who has purchased access.
6. **Shared-core package** versioned API (agents/prompts/shared).

## Non-goals (v1)

Self-serve provisioning (manual runbook instead, P2) · native IAP / Apple-billing (web checkout only) ·
per-coach product marketplace (single program-access SKU) · refactoring the live EL-OS instance (port
*from* it) · any client coach's bespoke content (only the Luminify seed) · drag-and-drop journey builder
(config-driven in v1) · postpaid/invoice AI billing (prepaid only) · a single monorepo (split into
platform + member UI).

## Constraints

Token discipline (reuse EL-OS where it generalizes; rewrite only what doesn't) · instance-agnostic
(nothing client-coach-specific in either repo) · **no mocks** (live DB + realistic Luminify seed) · stack
fixed (Expo · Vite+TanStack · Hono · Pipecat · Supabase+pgvector · Stripe · pnpm/turbo) · **contracts
freeze before parallel build** · every pattern pulled from EL-OS logged with generalize-vs-bespoke rationale.

## Success criteria — v1 is done when

1. `ciyp-platform` runs; a **coach** logs into the multi-tenant admin, configures their instance
   (archetypes/tiers as **config, not enums**), ingests library content, and **funds + monitors their AI wallet**.
2. A new member instance **stands up green** from the provisioning runbook on the Luminify seed.
3. A **member** (via the thin UI) signs in → completes a daily check-in → has a **text and voice**
   coaching conversation grounded in the seed library → it persists to memory → every AI call is
   **traced, eval-gated, and metered to the wallet**.
4. AI spend is **enforced**: a depleted wallet pauses spend-heavy calls; a Stripe top-up restores it.
5. A **buyer** unlocks member access via Stripe web checkout → entitlement honored.
6. **Zero Kyle-specific identifiers** in either schema (proven by the Luminify seed differing from Kyle's).

## Open questions for the architect (lead ADRs)

1. **Engine deploy topology** (the crux): one central multi-tenant engine serving thin clients, vs. a
   per-coach engine+DB deployment provisioned from this repo. Build order is engine-first either way; only
   topology differs. Decides where member data lives and how the wallet meters/enforces.
2. **Usage-rollup integrity:** at-least-once + idempotent metering from runtime(s) → ledger reliable
   enough to *gate spend*.
3. **Spend-authorization latency:** authorizing every turn against the wallet without a per-turn round-trip.
4. **Shared-core distribution:** private registry vs. git subtree vs. submodule for the shared package
   consumed by both repos.
5. **Library storage** under the chosen topology (RAG latency vs. provisioning simplicity).

## Derivation note (EL-OS reuse map)

Reuse/generalize: monorepo + stack · `packages/agents` (pure brain) · `packages/prompts` · `apps/api`
(runtime + **eval harness** + RAG via `embed.ts` + cadence execution) · `apps/voice` (Pipecat, portable) ·
library+RAG schema & retrieval fns · `ai_traces`/`ai_ops_audit` (extend for metering) · member memory +
`match_member_facts_fn` · cadence tables. **Net-new:** repo split · instance/config layer (de-enum) · AI
wallet + metering + billing + enforcement · program-access store · provisioning. **Stays in EL-OS:**
Kyle's archetypes/tiers/brand/journeys/content.
