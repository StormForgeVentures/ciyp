# ADR-006 — Sport AI SDK as the agent runtime

**Date:** 2026-07-02 · **Status:** Accepted · **Decision owner:** AI Architect (ai-design phase), approved direction from Tim (2026-07-01)

## Context

`docs/architecture.md` v1 was drafted without naming the runtime substrate. Reality:

- EL-OS (the extraction source) already runs the **Sport AI SDK** (`@theamazingwolf/sport-core` /
  `sport-server`) **default-ON** for grounded chat; ~6.4K LOC of its API is Sport port adapters, while the
  coaching cognition stays in pure `@elos/agents` + `@elos/prompts` (orientation §3).
- ScalingCFO is a second production-shaped consumer; its port implementations and its two pain points
  (singleton host, boot-frozen slot config) are documented prior art (orientation §4).
- Tim owns the SDK. The SDK↔platform boundary is agreed (orientation §6): **SDK = mechanism for any AI
  application; platform = policy, content, business model.** Gaps ship as SDK issues, not local forks.
- Coach-authored agents — definitions as per-tenant data, live without deploys — are a core product
  surface, and Sport's `defineRole`/`defineProcess`/slot primitives are already pure data (orientation §2).

## Decision

**The Sport AI SDK is the AI execution substrate of `ciyp-platform`.**

1. `apps/api` builds its AI runtime on `sport-core`/`sport-server`: turn execution, slot resolution,
   cascade ordering, memory/RAG ports, MCP tools, governance, tracing. `apps/voice` (Pipecat) continues to
   call the API's internal turn route — one brain, no SDK code in voice (EL-OS pattern).
2. The **pure brain stays pure**: ported `@ciyp/agents` + `@ciyp/prompts` keep the injected-substrate
   discipline (deps = shared + zod). Sport is wired at the API edge only, mirroring EL-OS's proven split.
3. **Per-scope everything** (the two ScalingCFO anti-patterns are prohibited here):
   - Assembly/host is resolved **per tenant scope** with cache + invalidation — never a process singleton
     that freezes registration at boot.
   - Slot config uses live `LoadSlotConfig(scope)` + `invalidate(scope)` — never `staticSlotConfig`.
4. **Coach-authored agents** hydrate Sport primitives from per-tenant rows (roles, process directives,
   cascade blocks, model slots, tool allowlists, MCP integrations); activation is version-bumped and
   eval-gated (no-eval-no-ship is structural in Sport). Coach-authored tool *logic* is explicitly out of
   scope: new behavior = platform code tools or MCP servers.
5. **Platform implements the ports** (its policy behind SDK mechanism): ScopeResolver (tenant from request
   ALS; credentials never in ResolvedScope), SpendAuthorizer (the ADR-003 wallet), TraceSink (`ai_traces`
   + cost columns), pgvector VectorStore + Voyage embedder/reranker, storage, prompt-version store.
6. **SDK dependencies are expressed as issue resolutions, never version pins** (Tim, 2026-07-02 — bumps
   may be minor or major). Critical path for coach-authored agents: **#25, #26, #27**. Mid-build: #28–#31.
   Until #25–#27 land, the platform builds a thin per-tenant assembly cache behind the same seam so the
   SDK features replace it without rework.

## Consequences

**Positive.** Reuses a battle-tested substrate two products already run; rules 1–3 and 6 of the ten
enforcement rules are structurally enforced by the SDK rather than by convention; the coach-authored-agent
product surface maps onto primitives that are already pure data; improvements funded by CIYP accrue to
every SDK consumer (and vice versa — QBO connector work becomes Granola/Fathom machinery).

**Negative / accepted.** A cross-repo dependency on SDK issue delivery enters the critical path (mitigated:
same owner, interim seam specified); Sport's grounded-turn loop currently lacks a guard hook, so the linter
chain gates post-hoc until #28 lands (EL-OS ships this way today); platform metering must price off-table
(OpenRouter) models itself — Sport traces honest zero-cost where Pi has no price row (OQ-A in
`docs/ai-architecture/ai-architecture.md` §5).

## Alternatives rejected

- **Bespoke runtime (port EL-OS's legacy path only).** Rejected: re-derives ~6.4K LOC of substrate Sport
  already provides, forfeits the structural enforcement, and forks the ecosystem Tim owns.
- **Direct Pi (`@earendil-works/*`) usage.** Rejected: violates the SDK's own load-bearing facade rule
  (sport-ai-sdk ADR-001); every consumer goes through sport-core.
- **Defer the runtime decision to the build waves.** Rejected: the wave plan cannot sequence coach-authored
  agents, MCP connectors, or metering without knowing the substrate; deciding late re-litigates every port.

## Constraints for downstream

- No `@earendil-works/*` import anywhere in this repo; Sport subpath exports only.
- No process-singleton SportHost; no `staticSlotConfig`; no MCP catalog resolution under a sentinel scope.
- Wave-plan dependencies on the SDK cite issue numbers (e.g. "requires sport-ai-sdk #25–#27 resolved"),
  never a version number.
- Any new SDK gap discovered mid-build is filed as a sport-ai-sdk issue with consumer evidence (the
  orientation doc's §6 boundary test decides which side owns it).
