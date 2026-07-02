# Orientation — Sport AI SDK × CIYP Platform (2026-07-01)

> Produced from a three-repo survey (this repo · `~/repos/sport-ai-sdk` · `/mnt/c/Repos/empowered-leader-os` ·
> `~/repos/scalingcfo`) plus Tim's 2026-07-01 vision update. Input artifact for the **ai-design phase**
> (the pipeline's recorded next step). Nothing here is a decision; decisions land in
> `handoff/project-state.md` at the ai-design boundary.

## 1. Where the program actually stands

- **This repo:** docs-only. Discovery ✓ (canonical brief `docs/project-brief.md`), architecture draft ✓
  (`docs/architecture.md` + 5 ADRs + 6 contracts), **ai-design NOT run** — the architecture's AI-stack picks
  are provisional and self-flagged as made out of order (project-state decision #6).
- **`ciyp-template`:** brief only (member-UI slice pointing back here). Correctly blocked on contract freeze.
- **Critical doc gap:** `docs/architecture.md` never mentions the Sport AI SDK, yet EL-OS (the extraction
  source) runs Sport **default-ON** for grounded chat, and the platform vision now centers on Sport as the
  agent runtime. The ai-design phase must ratify Sport's place explicitly (likely a new ADR).

## 2. Sport AI SDK — capability verdicts (v0.5.2, `~/repos/sport-ai-sdk`)

The SDK wraps the Pi engine behind `@theamazingwolf/sport-core` / `sport-server` / `sport-ui*`.
For the "coach authors an agent in the admin UI, it runs without a deploy" goal:

**Pure data today (DB-hydratable):**
- **Roles/Agents** — `defineRole` is a strict-Zod parse over pure data (name, identity, persona, capability
  verbs, writeScope, allowedTools/Skills, kind, per-role model override). No functions anywhere. A DB row can
  be fed straight to `defineRole`; bad rows return machine-readable `aiFixHint` for self-correction.
- **Model routing** — slot config (`default/deep/fast/classify/…/stt/tts`) resolved per **scope** via
  `LoadSlotConfig(scope)`, cache+TTL+`invalidate(scope)`. OpenRouter is a first-class built-in provider.
  Hardcoded model ids are rejected at authoring time.
- **Prompts/cascade** — runtime is "brain-free"; cascade blocks are `{id, content}` data; prompt bodies
  versioned via `PromptVersionStore`.
- **Processes** — `defineProcess` is data (typed steps + goal + evals); the SDK docs state outright that a
  new process registered purely as config runs with no code change.

**Code-only (cannot be a DB row):**
- **Tool bodies** — `defineTool.execute` is a JS function; `inputSchema` is a Zod object. Coach-authored
  tool *behavior* requires either pre-built code tools picked by name, or **MCP servers** (the SDK's
  `connectMcpCatalog(store, tokenStore)` supports a per-scope DB-backed catalog: `listActive(scope)` →
  governed, namespaced `mcp:{server}:{tool}` tools).
- Step resolvers (`compute/io/retrieve` engines/adapters), step Zod I/O schemas, and all ports
  (ScopeResolver, SpendAuthorizer, VectorStore, TraceSink, embed/rerank) are host code.

**Friction to design around (candidate SDK upgrade requests):**
1. Assembly is single-shot; registration (incl. MCP catalog) resolves at `.build()` — no hot-swap. A
   no-deploy authoring flow needs a **per-scope assembly-rebuild + cache layer** (consumer-built today; could
   be an SDK feature).
2. Role/Tool registries **throw on duplicate {name,version}** — coach edits must auto-bump versions
   (Processes replace-on-dup; Roles/Tools don't).
3. `aiStep` has no inline prompt field — coach prompt text must be threaded into cascade blocks by app code.
4. No guard-chain hook in the turn loop — EL-OS runs its linter chain post-hoc on the draft (noted in
   `run-turn.ts` header as an SDK limitation).
5. no-eval-no-ship is structurally enforced (a Process with zero evals cannot register) — the coach
   authoring UI must synthesize/require eval metrics, or the SDK needs a template-eval affordance.
6. No shipped config-table schema / DB→primitive loader / admin UI — all consumer glue.

## 3. EL-OS reality (the extraction source)

- **Sport is the substrate, not the brain.** `apps/api/src/lib/sport/` (~6.4K LOC, 66 files) adapts Sport
  ports (scope, memory/RAG, governance, observability, artifacts, cascade ordering, orchestration).
  The cognition — classifier, 4-linter chain, 4 coaching processes, 3 cadence agents, interaction engine,
  tools — lives in pure `@elos/agents` + `@elos/prompts` (~6.2K LOC, deps = shared+zod, injected
  `AgentSubstrate = {llm, getModelSlot, traceAICall}`).
- **Sport grounded chat is default-ON** (`ELOS_SPORT_GROUNDED_CHAT` opt-out; coach-core.ts:70-76). Two
  cascade assemblers are kept in byte-parity; plan the platform around the **Sport path as primary**.
- **The graduation seam already exists:** `CodeProcessDefinition.source: 'code' | 'authored'` is documented
  as the in-code analog of a `coaching_process_definitions` DB row — the `'authored'` (DB-read) path is
  designed but unbuilt. This is the platform's coach-authored-agent hook, and it matches ADR-002.
- **Tenancy seams:** Sport `ScopeResolver.tenantId` exists but is pinned to `elos-kyle-brown`;
  `app_config.model_routing` is DB config but a singleton row. Cascade L0/L1 (anti-sycophancy) are
  hardcoded and explicitly non-configurable (keep platform-owned); L2 brand voice is Kyle-hardcoded
  (becomes tenant config).
- **Voice (`apps/voice`, Pipecat) never touches Sport** — it HTTP-POSTs each turn to the API's internal
  coach-core route. One brain in the API; port as-is.
- **No Granola/Fathom/meeting-transcript ingestion exists in EL-OS.** Library ingestion = admin-driven
  PDF / uploaded media (Cloudflare Stream → Deepgram) / Vimeo. Anything meeting-recording-shaped is
  net-new platform work.
- Tools are a closed, code-defined manifest (7 tools) with Zod-validated args and injected RLS-respecting
  executors. No dynamic/per-tenant tool registry.

## 4. ScalingCFO lessons (second Sport consumer, v0.5.2)

**Lift these proven patterns:** ScopeResolver with request-ALS scope threading (+ eslint rule keeping
credentials/JWT out of ResolvedScope) · SpendAuthorizer with atomic pg check-and-increment reserve ·
composite TraceSink (+redactor) + PromptVersionStore · pgvector + Voyage embed/rerank ports · eval-gated
process registration · **the QBO OAuth connector** (envelope-encrypted token vault, pending/consent store,
tenant-isolated connection table, isolation tests) — the direct template for Granola/Fathom/CRM
per-tenant connectors.

**Design differently (their two single-product simplifications we must not inherit):**
1. **Singleton host / build-once MCP** — they parked `connectMcpCatalog` because one shared host resolves
   the catalog once at build under a sentinel scope (their decisions #15/#18). A multi-tenant platform with
   per-coach connectors needs per-tenant assembly (cached, rebuild-on-config-write) or the catalog path
   from day one.
2. **Boot-time-frozen slot config** — they wrap the DB read in `staticSlotConfig` (restart to change models).
   Use the live `LoadSlotConfig(scope)` + `invalidate(scope)` seam instead (ADR-002 already assumes
   per-tenant cache+invalidation).

Also: their live-eval gate was repeatedly blocked by free-tier Voyage rate limits and a broken model slug —
budget a paid Voyage key and a model-slug smoke test into the platform's eval harness from the start.

## 5. Vision deltas from Tim (2026-07-01) — for ai-design / PRD scoping

1. **Sport AI SDK is the AI runtime** for the platform (API backend through Sport; web admin; Expo native
   later). Architecture doc must be updated to say so.
2. **Coach-defined agents as first-class product**: coaches author their agents (prompt/persona, model,
   tool allowlist, process directives) in the admin UI — "at its core, the most important thing." Extends
   ADR-002's de-enum principle from methods to the whole agent layer; feasible per §2 with the
   assembly-rebuild layer + MCP for tool behavior.
3. **Meeting-recording import (Granola / Fathom)** into the ingestion pipeline → net-new connector work
   (QBO connector is the pattern). Brief currently lists "MCP transcript ingestion" as P1 — priority to
   re-confirm.
4. **Coach↔client chat** ("chat with their coaching clients and truly understand them") — EL-OS has a
   Coach Messaging domain to port; AI understanding both client and the coach's defined pathway is the
   memory + program-config surfaces already in scope.
5. **Web view housing an admin area AND a member login area** — brief/architecture put the member surface
   in `ciyp-template` (Expo native + PWA). Open scope question: does a member web surface now also live in
   `apps/web`, or does the template's PWA remain the web member surface?
6. **SDK upgrade requests**: Tim is open to filing feature requests against `sport-ai-sdk` for tool-side
   gaps (candidates in §2).

## 6. SDK ↔ platform boundary (Tim's direction, 2026-07-01 — to be ratified as an ADR in ai-design)

Principle: **SDK = mechanism for any AI application; platform = policy, content, business model.**
Practical litmus: if ScalingCFO also built it (or parked it), it's SDK; if it mentions
coach/member/archetype/wallet-markup, it's platform. Tim owns both sides, so requests ship as
sport-ai-sdk issues, not workarounds.

### Goes INTO sport-ai-sdk (upgrade requests — FILED 2026-07-02, ranked)

1. **[#25](https://github.com/theamazingwolf/sport-ai-sdk/issues/25) Per-scope assembly manager** —
   build/cache/invalidate a host per scope so config writes (roles, processes, MCP catalog, slots) take
   effect without redeploy. Unblocks `connectMcpCatalog` for multi-tenant hosts (the exact reason
   ScalingCFO parked it) and is the keystone for no-deploy authoring.
2. **[#26](https://github.com/theamazingwolf/sport-ai-sdk/issues/26) Upsert / replace-on-dup (or auto
   version-bump) for Role & Tool registries** — same-version edits currently throw; end-user authoring
   flows need edit-and-save semantics (Processes already replace).
3. **[#27](https://github.com/theamazingwolf/sport-ai-sdk/issues/27) Config-store ports + hydration
   loader** — generic `RoleStore` / `ProcessStore` / cascade-block store analogous to `McpCatalogStore`:
   `listActive(scope)` → validated `defineRole`/`defineProcess`. The app owns tables/RLS/UI; the SDK owns
   the port shape + loader + `aiFixHint` round-trip.
4. **[#28](https://github.com/theamazingwolf/sport-ai-sdk/issues/28) Guard-chain hook in the turn loop** —
   post-draft/pre-final seam so consumers run linters inline (EL-OS documents the absence and guards
   post-hoc today).
5. **[#29](https://github.com/theamazingwolf/sport-ai-sdk/issues/29) MCP OAuth connector kit** —
   generalize ScalingCFO's QBO pattern (envelope-encrypted token vault, pending/consent store, scoped
   transport) into sport-server; serves QBO, Granola, Fathom, CRMs alike.
6. **[#30](https://github.com/theamazingwolf/sport-ai-sdk/issues/30) Standard eval pack for authored
   processes** — attachable default evals (faithfulness judge, etc.) so end-user-authored processes can
   satisfy no-eval-no-ship without each app inventing eval synthesis.
7. **[#31](https://github.com/theamazingwolf/sport-ai-sdk/issues/31)** (tweak) inline prompt/cascade-binding
   affordance on `aiStep`; make live `LoadSlotConfig` (vs boot-frozen `staticSlotConfig`) the documented
   paved road.

> Semver note (Tim, 2026-07-02): do **not** plan against a specific SDK version number for these — bumps
> may be minor or major. Wave plans should express the dependency as "issues #25–#27 resolved" (the
> critical-path subset), not as a version pin. #25–#27 gate coach-authored agents; #28–#31 can land mid-build.

### Stays in ciyp-platform

- **Coaching cognition & content:** linter chain, interaction engine, coaching-process directives,
  cadence agents, archetype/persona content, prompt content, golden sets/eval content.
- **Business model:** tenants, AI wallet/credits/markup/enforcement policy, Stripe, entitlements, store,
  provisioning runbook. (SDK holds the SpendAuthorizer *port*; platform implements the wallet behind it.)
- **Authoring surface:** admin UI, config tables + RLS + versioning UX for coach-authored roles/processes/
  prompts/model-routing; which cascade layers are platform-locked (L0/L1) vs tenant-owned (L2+).
- **Tool executors & connector choices:** RLS-scoped data-access tools, which MCP servers exist per
  tenant, per-tenant integration config.
- **Voice runtime wiring** (Pipecat app), seed data, instance config contract to the member UI.

## 7. Recommended sequence (proposal, not yet ratified)

1. **ai-design phase** (recorded next step) with this doc as input: classify features into lanes, ratify the
   AI stack/model slots, and produce the Sport-runtime ADR (ADR-006: Sport as agent runtime; per-tenant
   assembly cache; coach-authored Role/Process rows; MCP catalog for tools) + the coach-authored-agent
   feature design.
2. Resolve the §5 scope questions with Tim (member web surface; Granola/Fathom priority; SDK-upgrade-first
   vs glue-in-platform).
3. File the chosen SDK upgrade requests as issues in `sport-ai-sdk` (they gate nothing if the per-scope
   assembly layer is built platform-side, but replace-on-dup Roles + live slot config would remove real glue).
4. **prd** → **generate-tasks** → wave plan; plan gate reviews all three together (per project-state).
