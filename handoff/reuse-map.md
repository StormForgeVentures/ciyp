# Reuse Map — where each build slice starts from (2026-07-02)

> The brief's constraint: "every pattern pulled from EL-OS logged with generalize-vs-bespoke rationale."
> This is the consolidated donor-code map per PRD, from the 2026-07 orientation
> (`handoff/sport-sdk-orientation.md`). Donor repos: **EL-OS** `/mnt/c/Repos/empowered-leader-os`
> (read-only, never modify) · **ScalingCFO** `~/repos/scalingcfo` (read-only pattern source) ·
> **sport-ai-sdk** (consumed as packages). Rough EL-OS volumes: pure brain ~6.2K LOC, Sport adapter layer
> ~6.4K LOC, voice ~800 LOC, api total ~28.5K LOC (+24K tests).

| PRD slice | Starting point | Posture |
|---|---|---|
| 001a monorepo + contracts | EL-OS monorepo shape (pnpm/turbo/tsconfig/pipelines) verbatim; contract *schemas* net-new from `docs/contracts/` | **Port shell, author schemas** |
| 001b schema + RLS | EL-OS `data-model.md` + schema per domain — every domain table shape ports; `tenant_id` + two-layer RLS + tenants/app_config-per-tenant is **net-new** (EL-OS pre-planned it but never built it; its per-member RLS ports as the second layer) | **Port shapes, build tenancy** |
| 001c seed | EL-OS seed tooling patterns; content net-new (Luminify, zero Kyle) | **Pattern port, new content** |
| 002a engine port | EL-OS `packages/agents` + `packages/prompts` — lift with tests (~6.2K + 3.2K test LOC); de-enum edits only | **Near-verbatim port** |
| 002b assembly + ports | EL-OS `lib/sport/` adapters (~6.4K LOC) as the base; ScalingCFO for ScopeResolver request-ALS + `no-jwt-in-resolved-scope` eslint rule + composite TraceSink; per-tenant host **cache** is net-new (both donors are single-scope/singleton — the anti-pattern we're fixing) | **Port + adapt; cache net-new** |
| 002c slots + cascade | EL-OS `model-routing.ts` (getModelSlot + Valkey cache) re-keyed per tenant; EL-OS cascade content (L0/L1 verbatim incl. anti-sycophancy); Sport slot resolver is SDK-provided | **Port, re-key per tenant** |
| 002d eval + observability | EL-OS `src/evals` (registry/runner/judge/golden) + `ai_traces` discipline — lift; cost columns + pricebook hooks net-new; ScalingCFO's slug smoke-test lesson | **Near-verbatim port + columns** |
| 003a chat turn | EL-OS `run-turn.ts` + guard chain + tool dispatcher + `parts` wire — the biggest single port; generalize names | **Heavy port** |
| 003b memory | EL-OS `lib/memory/` (L1/L2, recall, decay, doc-distillation) + `member_facts` shapes; member edit-lock net-new | **Heavy port** |
| 003c/d cadence + processes | EL-OS cadence agents + process runner + goal gate + plan-document artifact (all in 002a's port); `source='authored'` read path net-new (the designed-but-unbuilt seam) | **Port runner, build authored path** |
| 004a Pipecat service | EL-OS `apps/voice` (~800 LOC) — mechanical port; session-config injection replaces instance constants | **Near-verbatim port** |
| 004b voice spend | Net-new (EL-OS has no wallet); consumes 007b; ScalingCFO reserve pattern underneath | **New on ported seams** |
| 005a ingestion | EL-OS `workers/library-ingest.ts` + chunking + pdf/stream/vimeo/stt libs — lift | **Near-verbatim port** |
| 005b library UI | EL-OS `apps/web` admin library screens as reference; rebuilt in the new shell | **Reference port** |
| 005c connector framework | **ScalingCFO `mcp/qbo/`** — OAuth lifecycle, envelope-encrypted token vault, pending/consent store, isolation tests: lift the pattern wholesale, generalize provider params; sport-ai-sdk #29 eventually replaces the glue | **Heavy pattern port (SCFO)** |
| 005d Granola/Fathom | Net-new adapters on the 005c port (no donor anywhere) | **From scratch (thin)** |
| 006a admin shell | EL-OS `apps/web` as reference; multi-tenant auth/switcher/audit net-new | **Reference port + new tenancy** |
| 006b instance config | Net-new UI over ADR-002 tables; write-pipeline versioning reuses EL-OS `prompt_versions` discipline | **New UI, ported discipline** |
| 006c agent studio | Net-new UI; runtime side hydrates **SDK-provided** pure-data primitives (`defineRole`/`defineProcess` + `aiFixHint`); ScalingCFO's 14-role file shows the target shapes | **New UI on SDK primitives** |
| 007a wallet | Net-new (the business model); Stripe webhook idempotency patterns from ScalingCFO/EL-OS webhooks | **From scratch (patterns exist)** |
| 007b spend auth | ScalingCFO `billing/spend-authorizer.ts` — atomic pg check-and-increment reserve: lift; cheap-path cache + reconcile net-new | **Pattern port (SCFO) + new cache** |
| 007c metering + pricebook | Net-new (OQ-A resolution); outbox/idempotency are standard patterns; `ai_traces` source is ported | **From scratch** |
| 008a store | EL-OS/SCFO Stripe webhook discipline; entitlement projection net-new against contract 05 | **New on ported patterns** |
| 008b provisioning | Net-new script; step 3 calls ported ingestion; runbook shape from architecture §10 | **From scratch (orchestrates ports)** |

**Summary:** roughly **60–65% of v1 starts from donor code** (all of the AI brain, runtime adapters, evals,
ingestion, voice, memory, chat turn — EL-OS; connectors + spend-reserve + scope discipline — ScalingCFO;
the agent runtime itself — sport-ai-sdk). The genuinely from-scratch core is exactly the platform's reason
to exist: **multi-tenancy keying + RLS gates, the wallet/metering economy, the authoring UIs, and the
provisioning script.** Multitenancy has no donor implementation anywhere — EL-OS pre-planned it (UUID PKs,
per-member RLS, pinned `tenantId` in its ScopeResolver) but runs single-tenant; that is why PRD-001b sits
in wave 1 with every later module declaring it `Required`.
