# ciyp-platform — System Architecture (v1)

> **Status:** v1, accepted as the build spine. Discovery is complete; this document turns the
> locked discovery decisions into an implementable design.
> **Repo:** `ciyp-platform` (production — the engine). Sibling: `ciyp-template` (MVP — thin member UI).
> **Date:** 2026-06-18 · **Author:** Software Architect (cadre)
> **Reconciled:** 2026-07-02 — surgical pass aligning the doc to the ai-design ratifications
> (ADR-006 Sport runtime, ADR-007 EL-OS inheritances) and project-state decisions #7–#11: §2.1/§2.2/§5
> now reflect the Sport substrate; §9 adds the P0 connector layer; §5.5 documents the per-tenant assembly
> cache / process model. Discovery, data-model strategy, ADR-001..005, and the six contracts are unchanged.
>
> **Reuse posture:** This is an *extraction-and-generalization* of Empowered Leader OS (EL-OS,
> instance #1, hardcoded to coach Kyle Brown), **not a rebuild**. Every major choice below is
> grounded in an existing EL-OS structure we port forward. Where we deviate, the tradeoff is
> stated and an ADR records it.

---

## 1. What this system is

A coach's clients carry an **AI coaching presence in their pocket**, grounded in *that coach's*
body of work and methodology. CIYP is the multi-tenant business platform + AI engine that makes
this true for many coaches at once, where EL-OS made it true for exactly one.

Two products, two repos:

| Repo | Stage | Role | AI? |
|---|---|---|---|
| **`ciyp-platform`** (this) | production | AI engine + runtime + eval + voice + multi-tenant admin + wallet/billing + provisioning | **All of it.** |
| **`ciyp-template`** (sibling) | mvp | Thin Expo member UI (native-first) + PWA fallback. Calls the engine API. | **None.** |

The engine is built **first**. The member UI is a thin client by design — it holds zero model
routing, zero prompts, zero retrieval. It renders what the engine streams and posts user input
back. This mirrors EL-OS's own `apps/mobile`, whose deps were *only* shared types +
`expo-router`/`expo-secure-store`. `ciyp-template` is that pattern, generalized.

**Instance-agnostic mandate.** Nothing coach-specific lives in `ciyp-platform`. No Kyle archetypes,
no Kyle brand, no Kyle methodology names. The seed tenant is **Luminify** (Tim's own coaching
business). Every coach-specific concept that EL-OS hardcoded as an enum or a constant becomes
**per-tenant configuration** here (see §6, ADR-002).

---

## 2. Topology — engine-first, two repos

```
                          ┌──────────────────────────────────────────────────┐
                          │                 ciyp-platform                     │
                          │             (the engine — production)             │
   Member device          │                                                  │
  ┌───────────────┐  HTTPS │  apps/api (Hono)  ──────────────┐                 │
  │ ciyp-template │ ─────► │   • Coaching API (chat/turn SSE) │                 │
  │ Expo native   │        │   • Spend-authorization seam     │                 │
  │ (+ PWA)       │ ◄───── │   • Cadence execution            │                 │
  │  THIN client  │  SSE   │   • Eval harness (src/evals)     │                 │
  └───────────────┘        │   • Admin / config authoring     │                 │
        │                  │   • Wallet / metering / billing  │                 │
        │ Stripe web       │            │            │        │                 │
        │ checkout         │            ▼            ▼        ▼                 │
        ▼                  │     packages/agents  packages/prompts  packages/   │
  ┌───────────────┐        │     (PURE brain)     (versioned)       shared/ui   │
  │ Stripe        │ ─────► │            │                                       │
  │ (entitlement, │  webhk │            ▼ injected LLM ports                    │
  │  wallet top-up)        │     apps/voice (Pipecat, Python, Dockerized)       │
  └───────────────┘        │            │                                       │
                          │            ▼                                       │
                          │   ┌────────────────────────────────────────┐      │
                          │   │  Postgres + pgvector (multi-tenant, RLS) │      │
                          │   │  tenants · per-tenant app_config ·       │      │
                          │   │  ai_traces · usage_ledger · wallets      │      │
                          │   └────────────────────────────────────────┘      │
                          │            │                                       │
                          │   External (per-tenant, pluggable):                │
                          │   OpenRouter · Voyage · Deepgram · Fish-audio ·    │
                          │   GoHighLevel/CRM · transcript sources (MCP)       │
                          └──────────────────────────────────────────────────┘
```

### 2.1 Monorepo layout (ported from EL-OS, generalized)

`ciyp-platform` keeps EL-OS's proven pnpm + turbo monorepo shape:

```
ciyp-platform/
  apps/
    api/            # Hono — AI execution runtime (Sport), eval harness, admin, wallet, connectors, provisioning
      src/
        lib/
          sport/                 # Sport runtime edge — the impure boundary (EL-OS lib/sport/ pattern, generalized)
            assembly.ts          # per-tenant-scope Sport host assembly + bounded cache (invalidate-on-config-write)
            ports/               # platform impls of Sport ports:
                                 #   scope-resolver (tenant via request-ALS; no creds in ResolvedScope)
                                 #   spend-authorizer (→ wallet, ADR-003) · trace-sink (→ ai_traces + cost cols)
                                 #   vector-store (pgvector) + embedder/reranker (Voyage) · storage
                                 #   slot-resolver (live LoadSlotConfig(scope) + invalidate) · prompt-version store
            cascade/             # cascade blocks as data {id,content}; L0/L1 platform-locked, L2+ tenant config
            mcp-catalog.ts       # per-scope MCP catalog (connectMcpCatalog → listActive(scope)) — connector tools
          embed.ts               # RAG ingestion/recall helpers (Voyage embedder port)
          vector.ts              # retrieval isolation seam (pgvector now, Pinecone later)
          tenant-context.ts      # resolves tenant from request → RLS GUC + Sport scope + config
          wallet/                # spend authorization, metering rollup, enforcement (behind SpendAuthorizer port)
          connectors/            # NEW (P0): per-tenant integrations — OAuth token vault + tenant_integrations → MCP catalog
          provisioning/          # tenant create/promote runbook scripts
        evals/                 # judge, golden sets, retrieval-precision, routing-accuracy, …
        routes/                # Coaching API, admin, billing webhooks
    voice/          # Pipecat Python service (Dockerized); HTTP-POSTs each turn to the API — no Sport code in voice
    web/            # Coach/admin web console (config authoring, eval review, wallet) — coach/admin only; member web = template PWA (decision #11)
  packages/
    agents/         # THE BRAIN — pure, provider-agnostic (deps: shared + zod only)
    prompts/        # versioned prompt sets
    shared/         # cross-cutting types + zod schemas (the contract source of truth)
    ui-tokens/      # design tokens (consumed by BOTH repos — see ADR-004)
```

`ciyp-template` (sibling) consumes a **published subset**: `@ciyp/shared` types + `@ciyp/ui-tokens`.
It never imports `agents` or `prompts`. See ADR-004 for the distribution mechanism.

### 2.2 Stack — inherited from EL-OS, carried forward

The platform inherits EL-OS's running stack. These are **not** fresh stack picks; they are the
substrate we extract from. Deviations from cadre's AI stack-canon are pre-existing EL-OS decisions,
recorded here so downstream audits don't re-flag them. (The AI-stack picks were provisional per
project-state decision #6 and are now **ratified by the ai-design phase** — ADR-006/007 and
`docs/ai-architecture/`; the slot table there is authoritative for model routing.)

| Layer | Choice | Canon default | Note |
|---|---|---|---|
| Runtime | Hono on Node (DigitalOcean) | ★ Hono on DO | match |
| AI runtime | **Sport AI SDK** (`@theamazingwolf/sport-core` / `sport-server`) | — | **ratified — ADR-006** (ai-design 2026-07-02). Slots/ports/live-config detail: `docs/ai-architecture/ai-architecture.md`. |
| DB | Supabase Postgres + pgvector | ★ Supabase + pgvector | match |
| LLM gateway | OpenRouter | ★ OpenRouter | match |
| Chat slot | OpenRouter `claude-sonnet-4.6` | provider-agnostic frontier slot | match (slot-routed, not hardcoded) |
| Embedding | **Voyage `voyage-3.5` @ 1024-dim** | Cohere `embed-v3` @1024 | **deviation — ratified ADR-007.** Same dim, drop-in; asymmetric `input_type` (`document`/`query`) discipline. |
| Reranker | **Voyage `rerank-2.5`** | Cohere `rerank-v3.5` | **deviation — ratified ADR-007.** Cross-encoder, non-optional (rule 6, K=20→N=5). |
| STT | Deepgram `nova-3` | ★ Deepgram nova-3 | match. (Voice P0 uses *streaming* STT via Pipecat — see §8; canon flags streaming as a planned extension, which EL-OS's `apps/voice` already implements.) |
| TTS | Fish-audio voice clone (`tts.voice_id` per coach) | — | per-tenant voice persona. |
| Mobile | Expo (native-first) + PWA fallback | ★ Expo | match |

> **OQ-1 — closed 2026-07-02 by ADR-007.** The Voyage embed/rerank inheritances are ratified with
> flip-constraints, eval baselines, and named reversal triggers (e.g. multilingual coach corpus, or
> retrieval precision below alert on two consecutive cycles). A **paid Voyage key is a build
> prerequisite** — free-tier RPM starved ScalingCFO's eval gate. Full slot taxonomy + seed model
> values: `docs/ai-architecture/ai-architecture.md` §2.

---

## 3. The spine: shared-multi-tenant now, promotable-to-dedicated later (ADR-001)

This is the single most important design decision and the seam the whole system is built around.

**v1 runtime = ONE multi-tenant engine + ONE Postgres.** Coach = tenant. Every domain table carries
`tenant_id`; RLS scopes every read/write to the calling tenant. This is the cheapest path to "many
coaches" and exactly the migration EL-OS pre-planned ("single tenant v1; to add coaches, add a
`tenants` table + tenant-scoped RLS; migrate existing data into a default tenant; major version bump").

**But** a high-value coach must be liftable into a **dedicated engine + dedicated DB** later
*without a rewrite*. Three EL-OS facts make this promotion possible, and the design preserves all three:

1. **UUID PKs everywhere** (EL-OS chose these explicitly for sharding/sync/cross-DB refs). A row's
   identity is globally unique, so its data can be copied to another database and keep its keys —
   no re-keying, no FK breakage.
2. **Strict `tenant_id` scoping + RLS.** Because every row already filters by tenant, "extract one
   tenant" = `WHERE tenant_id = $X` across the schema. There is no shared, un-scoped state to untangle.
3. **Per-tenant config is data, not code** (§6). A tenant's archetypes, tiers, methods, model routing,
   and voice persona live in rows. Promotion copies those rows; no code fork.

**What promotion actually is** (designed, not built in v1 — see ADR-001 for the full runbook):
provision a new engine deployment + empty DB with the identical schema → `COPY`/logical-replicate the
tenant's rows (UUIDs intact) → repoint that coach's instance-config `engine_base_url` → cut over →
verify → drop the tenant's rows from the shared DB. The seam that makes the *runtime* indifferent to
which mode it's in is **`tenant-context.ts`**: every request resolves a `TenantContext` (tenant_id +
config + DB handle). In shared mode it sets the RLS GUC on the shared pool; in dedicated mode the
deployment is single-tenant and the handle points at the dedicated DB. **No handler knows the difference.**

**Tradeoff stated:** shared-now means one noisy/abusive tenant can affect others (mitigated by wallet
hard-enforcement §7 + per-tenant rate limits), and a shared DB is a larger blast radius. We accept
this for v1 because the alternative — dedicated-per-coach from day one — multiplies ops cost and
provisioning latency with zero current demand. The promotion seam is the insurance policy; we build
the *seam* now and the *dedicated deployment* only when a coach's value justifies it.

---

## 4. Data model strategy

### 4.1 The multi-tenant migration (the major version bump)

Executed exactly as EL-OS pre-planned. As a **migration plan** (Architect writes plans; Developer
applies — see `adr/` and the migration discipline in cadre's `references/db/migrations.md`). Postgres
on Supabase; migration files only (`supabase migration new`); RLS ships in the same migration as the
table; seed in the same parent task.

**Phase E (expand).**
- `CREATE TABLE tenants (...)` — the new root entity (lock: brief `ACCESS EXCLUSIVE` on a new table, trivial).
- `ALTER TABLE <each domain table> ADD COLUMN tenant_id uuid;` — **nullable, no default** → metadata-only,
  brief `ACCESS EXCLUSIVE`, safe on any size (per the lock-class table). Do **not** add `NOT NULL` or a
  default expression here (that would rewrite the table).
- App dual-aware: writes set `tenant_id`; reads tolerate null during backfill.

**Phase B (backfill).**
- `INSERT INTO tenants` the **default tenant** = the Luminify seed instance (a single, real coach).
  *(EL-OS migrates its existing single-tenant data into a default tenant; here the default tenant is
  the seed coach Luminify, since this repo carries no Kyle data.)*
- Batched backfill `UPDATE <table> SET tenant_id = '<default>' WHERE tenant_id IS NULL` in 10k–100k
  chunks, throttled by autovacuum lag.
- Enforce NOT NULL via the safe path per table: `ADD CONSTRAINT <t>_tenant_nn CHECK (tenant_id IS NOT NULL)
  NOT VALID` (metadata-only) → `VALIDATE CONSTRAINT` (`SHARE UPDATE EXCLUSIVE`, no block) →
  `ALTER COLUMN tenant_id SET NOT NULL` (metadata-only, the validated constraint proves it) → drop the
  scratch constraint.
- Add FK `tenant_id → tenants(id)` as `NOT VALID` first (`SHARE ROW EXCLUSIVE`, brief), then `VALIDATE`.
- `CREATE INDEX CONCURRENTLY` on `(tenant_id, <hot predicate cols>)` for every table — **FK columns and
  RLS predicate columns must be indexed** or every tenant-scoped query degrades. Index plan ships *with*
  the schema, not after.

**Phase C (contract).**
- RLS policies per table: `USING (tenant_id = current_setting('app.tenant_id')::uuid)` for select/update/
  delete; `WITH CHECK` the same on insert. Per-member RLS that EL-OS already has stays as
  **defense-in-depth** (two-layer: tenant fence + member fence).
- Drop any now-redundant single-tenant assumptions in app code.

**Rollback per phase:** Phase E = drop `tenant_id` columns (metadata-only). Phase B = backfilled values
trivially recomputable / PITR-recoverable. Phase C = re-deploy without RLS enforcement (policies are
additive). Full plan with verification queries lives with the Developer's migration task.

> **Lock-class note for downstream:** the only table-rewrite risk in this whole migration is if anyone
> adds `tenant_id NOT NULL DEFAULT ...` in one step. **Do not.** Nullable-add → backfill → constrain.

### 4.2 Per-tenant `app_config`

EL-OS's `app_config` is a **singleton** (`id=1`) holding `model_routing` JSONB. For multi-tenant it
becomes **per-tenant**: one config row per tenant (PK `tenant_id`, or `app_config(tenant_id, ...)`). All
reads still go through `getModelSlot()` — but keyed by tenant, cached per tenant, invalidated on that
tenant's update. `model_routing` keeps its slot shape `{chat,fast,deep,vision,embedding,rerank,stt,tts}`;
**`tts.voice_id` is the per-coach voice persona** (the Fish-audio clone). This is the seam that lets two
coaches run different models, different rerankers, different voices, on the same engine.

### 4.3 Domains (ported from EL-OS `data-model.md`, now tenant-scoped)

All EL-OS domains carry forward, each gaining `tenant_id` + RLS: Identity & Access · Cadence Inputs ·
Status / Self-Trust-Index · AI Conversations · Member Memory (L1 `member_recent_state`, L2 `member_facts`)
+ `ai_traces` + `ai_ops_audit` · Resource Library · Member Uploads · Admin & Notifications · Member
Planning · Coach Messaging. **New tenant-platform domains** (§7): `tenants`, per-tenant `app_config`,
`wallets`, `wallet_ledger`, `usage_ledger`, `stripe_*` billing rows, `tenant_integrations`.

### 4.4 Memory & retrieval (unchanged shapes, tenant-fenced)

- **L1** `member_recent_state` — LLM-curated rolling summary, always in the system prompt.
- **L2** `member_facts` — atomic facts + 1024-dim embeddings, vector-recalled, **member-facing/editable**
  (anti-dependency principle preserved).
- **Hybrid retrieval** — BM25 (`tsvector` + GIN) + dense kNN via **RRF (k=60)** + **cross-encoder rerank
  (non-optional)**. All retrieval is tenant-fenced (no cross-tenant recall — a hard correctness boundary,
  audited). Vector-split-to-Pinecone stays deferred (trigger: >1M chunks **per tenant** or p95 > 200ms),
  isolated to `apps/api/src/lib/vector.ts`.

### 4.5 The `parts` discriminated union (load-bearing)

`chat_messages.parts: jsonb` is a typed discriminated union — `text | audio | library_citation |
process_offer | voice_input_ref`. **The same shape on the SSE wire, in storage, and in the client
renderer.** EL-OS's own warning carries forward verbatim: *"lock in the first migration; backfilling is
multi-week."* This union is the heart of the Coaching API contract (`contracts/02-coaching-api.md`) and is
frozen at v1. The member UI's renderer is a pure function of this union.

---

## 5. AI runtime, eval, and the pure-brain boundary

### 5.1 `packages/agents` stays PURE

The brain — orchestrator, classifier, coaching methods, cadence (`daily_checkin`/`weekly_checkpoint`/
`monthly_rww`), interaction-engine, linters, utility — keeps EL-OS's hard purity rule: **deps =
`@ciyp/shared` + `zod` only.** LLM access is via **injected ports** (`src/llm/{types,default}.ts`). The
agents never know which provider, which tenant, or which DB they run against. This is what makes the
brain reusable across shared and dedicated deployments unchanged.

`apps/api/src/lib/sport/` is the impure edge (EL-OS's ~6.4K-LOC `lib/sport/` pattern, generalized): it
**assembles a per-tenant-scope Sport host** — injecting the platform's port implementations (ScopeResolver
from request-ALS; SpendAuthorizer → wallet, ADR-003; TraceSink → `ai_traces`; pgvector VectorStore +
Voyage embedder/reranker; storage; live slot resolver; prompt-version store) together with the pure
`@ciyp/agents` brain, and resolves the tenant's roles / process directives / cascade blocks / MCP catalog
per scope. **Tenant awareness lives only at this Sport assembly edge**; the brain stays scope-blind. (This
is where the v1 draft's `agent-wiring.ts` lands in the Sport era — assembly + ports, not a hand-wired
provider map.)

Assembly is **per-scope, cached, and invalidated on config write** — never a boot-frozen process singleton
(the ScalingCFO anti-pattern ADR-006 prohibits). Until sport-ai-sdk issues **#25–#27** (per-scope assembly
manager, registry upsert, config-store ports) land, the platform builds a thin per-tenant assembly cache
keyed on config version behind the same seam, so the SDK features slot in without rework. Express the
dependency as issue numbers, never a version pin.

### 5.2 The prompt cascade + linters + live slot resolution

`apps/api/src/lib/sport/cascade/` carries the cascade forward as **Sport cascade blocks** (`{id, content}`
data, not code) with Sport-owned ordering. **L0/L1** (anti-sycophancy) stay **platform-locked and
non-configurable**; **L2** (brand voice) becomes **tenant config**. Coaching lines are AI-generated and
must pass the cascade + linters; only `pinned_lines` bypass. Model selection is **live per-scope slot
resolution** — `LoadSlotConfig(scope)` (tenant-override → platform-default merge, cache + TTL,
`invalidate(scope)` on every config write), **never** the boot-frozen `staticSlotConfig`; hardcoded model
ids are rejected structurally (`HardcodedModelError`). Slot taxonomy + seed model values live in
`docs/ai-architecture/ai-architecture.md` §2.

> **Linter-chain caveat:** Sport's grounded-turn loop has no inline guard hook yet, so the linter chain
> gates **post-hoc** on the draft (as EL-OS ships today) until sport-ai-sdk **#28** lands.

**Coaching methods are config-driven directives** (EL-OS Decision #25): `coaching_process_definitions` is an
admin-authored **directive** (methodology / purpose / mode_arc / constraints / examples), *not* a per-line
script, hydrated into Sport `defineProcess` — the `source: 'code' | 'authored'` graduation seam whose
`'authored'` (DB-read) path is built here. New methodologies are **content/config, not code** — the exact
pattern we reuse to de-enum coach-specific methods per tenant (§6, ADR-002) and to power coach-authored
agents (feature #5; runtime shape in `docs/ai-architecture/ai-architecture.md` §4).

### 5.3 Eval harness — ships in the engine, not bolted on

`apps/api/src/evals/` carries the full harness: judge, golden sets, retrieval-precision, routing-accuracy,
agreement-rate, interaction-mode-correctness, static-checks, runner. Two audit tables ground it:
- **`prompt_versions`** — every prompt change/rollback is a new row, **synchronous write, rationale
  required.** Now tenant-scoped (a coach's prompt changes are theirs).
- **`eval_snapshots`** — **indefinite retention**, linked to `prompt_versions`. This is the evidence
  trail behind the platform's prompt-management + eval surfaces in the admin console.

**No eval, no ship** stays a platform rule: a coaching surface with no eval signal is a must-fix. In the
Sport era this is **structural** — a Process with zero evals cannot register (ADR-006) — so the rule is
enforced by the runtime, not only by convention. Coach-authored processes (feature #5) satisfy it via a
standard eval pack (sport-ai-sdk **#30**, or a platform-side equivalent until it lands).

### 5.4 `ai_traces` — the metering substrate

`ai_traces` already writes a row for **every** AI decision (classify, model call, retrieval, memory
recall, TTS, coaching-process events, linter interventions), 30-day retention, admin-only. **We extend it
with `prompt_tokens`, `completion_tokens`, `provider`, `model`, and `cost_micros`** — making it the source
of truth for metering (§7). This is reuse, not a new pipeline: the trace already fires on every decision;
we add the cost columns and roll them up. In the Sport runtime, trace writes go through the **TraceSink**
port — rule 1 is structural (a provider call is unreachable untraced) and classify / retrieval / memory
legs trace too.

> **Off-table cost caveat (OQ-A, → metering PRD):** Sport traces honest zero-cost for models Pi has no
> price row for (e.g. off-table models via OpenRouter). The wallet cannot bill zeros — the Usage Event
> pipeline (§7) must price token counts from a **platform pricebook** (per-model rates in config), not
> trust `derivedCost` alone. Recorded in `docs/ai-architecture/ai-architecture.md` §5.

### 5.5 Process model & the per-tenant assembly cache

The shared engine (ADR-001) runs as **one Node service** that holds **N cached per-tenant Sport hosts** — a
**bounded** cache keyed on `(tenant scope, config version)`, invalidated on any config write (roles,
process directives, cascade blocks, slots, MCP catalog). **Valkey stays** the working-memory (TTL ~2h) and
slot-config cache; **Pipecat voice is unchanged** — it HTTP-POSTs each turn to the API's internal turn
route, with no Sport code in the voice process (one brain in the API, EL-OS pattern).

This does **not** change the hosting posture (still one Hono service + one Pipecat service per ADR-001).
The one new operational dimension is the assembly cache's **memory footprint**, which scales with hot
tenants × per-host assembly size. That bound is a **tunable** (cache size / eviction TTL) — set
conservatively for v1, confirm at load-test (**OQ-6**). When issues #25–#27 land, the SDK's assembly
manager replaces the interim cache behind the same seam.

---

## 6. De-enum: coach-specific concepts → per-tenant config (ADR-002)

EL-OS hardcoded Kyle's methodology as enums. Those encode one coach's IP and **must not** live in an
instance-agnostic platform. The de-enum surface:

| EL-OS enum (Kyle-specific) | v1 treatment |
|---|---|
| `archetype` (reconnector / stabilizer / integrator / self_led / embodied_leader) | → per-tenant **config rows** (`tenant_archetypes`): id, label, description, prompt-injection fragment. |
| `enrollment_tier` (catapult / mastermind / concierge) | → per-tenant **config rows** (`tenant_tiers`). |
| coaching-method `agent_kind` (pmm / harmonizer / five_planes) | → per-tenant `coaching_process_definitions` **directives** (reuse Decision #25 pattern). Method = config, not code. |

**Generic enums STAY** (they encode platform mechanics, not coach IP): `enrollment_status`, `admin_role`,
`user_kind`, `push_platform`, `chat_thread_state`, `chat_message_role`, `interaction_mode` (instruct /
call_response / free / hold), `coaching_process_modality` (voice / guided / text),
`coaching_process_output_type`/`source`, `member_fact_tier`/`source`, `member_recent_state_reason`.

**`ghl_event_*`** (GoHighLevel CRM — Kyle's) → a **per-tenant pluggable integration** (ADR-005), never
hardcoded.

**Authoring surface:** the coach/admin **web console** (`apps/web`) is where a coach authors their
archetypes, tiers, methods, model routing, and voice — the config the member UI reads via the Instance
Config contract (`contracts/01-instance-config.md`). Config is versioned (it feeds prompt-set version →
which feeds `prompt_versions` + `eval_snapshots`), so a coach can't silently change behavior without an
eval-able audit trail.

---

## 7. Money: three flows, one wallet (ADR-003)

Three distinct money flows. Only flow (b) touches the AI runtime.

**(a) Member → Coach.** Stripe **web checkout** (no native IAP — keeps Apple/Google out of the cut and
keeps the Expo client thin). Successful checkout → **entitlement** row. The member UI reads entitlement via
`contracts/05-entitlement.md` and gates access. The engine never blocks AI on flow (a) directly — it checks
entitlement at session start.

**(b) Coach → Luminify: prepaid AI wallet/credits, metered, HARD enforcement.** One **wallet per
coach/tenant**. The coach pre-pays; the platform meters every AI call and **debits** the wallet; at zero
balance, **spend-heavy calls (voice, transcription, deep model) are paused** (hard enforcement, v1).
Top-ups via **Stripe recharge**.
- **Credit unit is abstracted from raw provider cost** with a **configurable markup** — a "credit" is a
  platform unit, and `cost_micros` from `ai_traces` is converted to credits at the tenant's markup rate.
  This decouples coach-facing pricing from provider price volatility.
- **Metering pipeline:** `ai_traces` (extended with tokens + cost) → emit a **Usage Event**
  (`contracts/03-usage-event.md`, at-least-once + idempotent via `idempotency_key`) → **`usage_ledger`**
  (append-only rollup) → debit **`wallet_ledger`** (append-only) → `wallets.balance_credits` materialized
  from the ledger. Append-only ledgers + idempotency keys make the money trail auditable and replay-safe.

**(c) Coach absorbs members' AI cost.** A member never sees credits. The coach's wallet funds all of that
coach's members' AI usage. This is purely an accounting fact (whose wallet gets debited = the member's
coach's wallet); no member-facing surface.

### 7.1 The spend-authorization seam (the hard part)

Every AI turn must be authorized against the wallet — but a per-turn synchronous round-trip to a wallet
service would add latency to the P0 voice path. The seam:

- **Cached balance with short TTL.** The runtime holds a per-tenant cached balance (TTL on the order of
  seconds–tens-of-seconds). Cheap chat turns authorize against the cache: `authorize(tenant, est_cost) →
  {allow, remaining}`. The cache is debited optimistically and reconciled against the ledger.
- **Hard check on spend-heavy operations.** Voice sessions and batch transcription — the expensive,
  long-running calls — do a **synchronous hard balance check** before starting, and re-check at intervals
  during long voice sessions. A voice session won't *start* on an empty wallet, and a session that drains
  the wallet mid-call is cut at a checkpoint. This is where "hard enforcement in v1" actually bites.
- **Reconciliation.** The cache is advisory for cheap calls; the **ledger is truth.** A background
  reconcile corrects cache drift and is the authority for billing. Optimistic cheap-call debiting can
  briefly go slightly negative under concurrency; we accept a small, bounded overspend on *cheap* calls in
  exchange for not putting a wallet round-trip on every chat turn — and we never accept it on *spend-heavy*
  calls, which are hard-gated. (Tradeoff explicit in ADR-003.)

Contract: `contracts/04-spend-authorization.md`.

---

## 8. Voice (P0 — the differentiator)

`apps/voice` is EL-OS's **portable Pipecat Python service** (its own Dockerfile, `pipecat_app/`), ported
unchanged in shape. Real-time, **server-side** AI execution: STT (Deepgram nova-3, streaming) →
agents (pure brain, wired per tenant) → TTS (Fish-audio, the tenant's `tts.voice_id`). The member UI opens
a voice session; **no AI runs on the device.** Voice is the most spend-heavy path, so it is the primary
client of the spend-authorization **hard check** (§7.1): a voice session is authorized synchronously at
start and re-checked during long sessions.

> **Canon note:** cadre's AI canon lists streaming STT as a *planned extension*, but EL-OS's `apps/voice`
> already implements it. We carry it forward (it's the differentiator); this is an accepted, pre-existing
> capability, not a new bet.

---

## 9. Connector layer — meeting-transcript import (Granola / Fathom, P0)

Project-state decision #10 promoted Granola/Fathom meeting-recording import to **P0** in v1 (supersedes the
brief's P1). It is **net-new** — EL-OS has no meeting-transcript ingestion (orientation §3) — and is built
as a **per-tenant pluggable integration** (ADR-005) on ScalingCFO's proven QBO connector pattern
(orientation §4), generalized into sport-ai-sdk issue **#29**. This is design-level; mechanics land in the
metering/connector PRD.

**Three parts, none of them a new pipeline:**

1. **Per-tenant integration registry → Sport MCP catalog.** `tenant_integrations` rows (provider, scope,
   connection state, config) are the source of truth. Per scope they register into the **Sport MCP
   catalog** (`connectMcpCatalog(store, tokenStore)` → `listActive(scope)` → governed, namespaced
   `mcp:{server}:{tool}` tools) — the same per-scope assembly seam §5.1 caches and invalidates. No
   connector is global; each is tenant-scoped and RLS-fenced. (This is exactly the multi-tenant catalog
   ScalingCFO parked as a single-product simplification — orientation §4 — and is why #25's per-scope
   assembly manager matters here.)

2. **OAuth 2.1 token vault.** An **envelope-encrypted** store for access + refresh tokens with explicit
   **consent / pending / connected / revoked** states and **rotation-aware writes** (a refresh rotates the
   stored token atomically). This lifts ScalingCFO's QBO vault directly: encrypted-at-rest tokens, a
   pending/consent store, a tenant-isolated connection table, and cross-tenant isolation tests.
   **Credentials never enter `ResolvedScope`** (ADR-006 rule 5 / the ScopeResolver eslint rule). Secrets
   are referenced by env-var name; the encryption key is platform-held. sport-ai-sdk **#29** generalizes
   this vault into `sport-server`; until it lands the platform implements it behind the same connector port
   so the SDK kit slots in without rework.

3. **Reuse the library ingestion pipeline (feature #7), with provenance.** Imported transcripts flow into
   the **existing** ingestion pipeline — chunk (~500 chars / 20% overlap) → asymmetric Voyage embed
   (`document`) → tenant-fenced pgvector → two-stage retrieval — with a **`source` provenance** field on
   the library document (`source = granola | fathom | upload | vimeo`). The connector is a new *source*,
   not a parallel pipeline.

**Surfaces (feature #8, Hybrid).** An integrations UI in `apps/web` manages connection state (connect /
consent / disconnect, health) and imported-item review; the AI side reuses feature #7's pipeline. Eval
signals: import fidelity (transcript content reaches indexed chunks, deterministic), retrieval precision
including the imported corpus, connector health (token-refresh success rate).

**Data (additive migrations).** `tenant_integrations` (already listed in §4.3's new tenant-platform
domains) carries connection state + a token-vault reference; library documents gain the `source`
provenance column. Both are nullable-add → backfill (`source = 'upload'` for existing rows) → constrain —
no table rewrite (§4.1 lock discipline).

**Constraints for downstream.** No connector resolves under a sentinel/global scope (ADR-006); token
plaintext never leaves the vault boundary or lands in a trace/log; connector tool *behavior* is MCP or
platform code, never coach-authored logic (orientation §2); every provider added files its consent-scope +
rotation semantics with the connector, not ad hoc.

---

## 10. Provisioning (manual in v1; self-serve is P2)

A coach is onboarded by a **runbook + script** (`apps/api/src/lib/provisioning/`). v1 = manual, deliberately:

1. `INSERT INTO tenants` (UUID id).
2. Seed the tenant's `app_config` (model routing, `tts.voice_id`), `tenant_archetypes`, `tenant_tiers`,
   `coaching_process_definitions` directives, `tenant_integrations` — from a per-coach intake.
3. Ingest the coach's body of work → chunk → embed (1024-dim, tenant-fenced) → resource library.
4. Create the coach's Stripe objects + wallet; set markup rate.
5. Run the eval golden set against the new tenant's config before go-live (**no eval, no ship**).
6. Issue the member UI its Instance Config (`contracts/01`).

The **same script** is the foundation of the ADR-001 **promotion** runbook (the dedicated-deployment path
reuses steps 1–6 against a fresh DB, plus the tenant-row copy). Self-serve provisioning (P2) wraps this
script behind a coach-onboarding flow.

---

## 11. Seed strategy — Luminify (seed = architecture)

The seed is the **default tenant** of the multi-tenant migration (§4.1) and the thing that makes the live
DB verifiable. Coach = **Luminify** (Tim's business: *"helping coaches become AI-enabled software
companies"*). Instance-agnostic: **no** Kyle content anywhere.

The Developer implements `seed.sql` (same wave as the schema) producing a realistic Luminify tenant:

- **1 tenant** (Luminify) + its `app_config` (real model routing, a real Fish-audio `voice_id` slot).
- **3–4 archetypes** + **2–3 tiers** authored as Luminify config (generic coaching archetypes, e.g.
  *operator / builder / connector* — placeholder, coach-authored at provision time; **OQ-2**).
- **2 coaching_process_definitions** directives (e.g. a daily check-in method + a weekly review method).
- **Resource library:** a realistic body of Luminify content, chunked + embedded (enough to make hybrid
  retrieval + rerank meaningfully exercise — not 3 toy docs).
- **3–5 demo members** with **edge shapes**: one brand-new (empty L1/L2 — empty-state screens),
  one mid-journey (rich `member_facts`, active cadence threads), one with an **expired entitlement**, one
  with a **near-zero wallet** (to exercise spend-authorization + hard enforcement), one with long uploads.
- **Wallet + ledger** seeded with top-ups + metered debits so the metering rollup and balance materialize
  from real ledger rows, not magic numbers.
- **`ai_traces` + `usage_ledger`** rows so the eval + metering admin surfaces render on real data.

Empty DB = empty screens; the seed's edge shapes (empty lists, expired states, near-zero balance, long
strings) are what make the build *verifiable* and the wallet enforcement *testable*.

---

## 12. Shared-core package boundary (ADR-004)

- The **member UI** (`ciyp-template`) consumes **`@ciyp/shared` types + `@ciyp/ui-tokens`** only.
- The **engine** consumes the **full** `agents` + `prompts` + `shared` + `ui-tokens`.
- `@ciyp/shared` is the **single source of truth for the cross-repo contracts** (§13): the zod schemas /
  TS types in `contracts/` are *generated from / live in* `shared`, so the wire shape can't drift between
  engine and UI.

Distribution mechanism (pnpm workspace vs private registry vs git subtree) is decided in **ADR-004**
(recommendation: private npm registry-published `@ciyp/shared` + `@ciyp/ui-tokens`, versioned, because the
two repos are *not* co-located in one workspace and the UI must pin a known-good contract version).

---

## 13. Cross-repo contracts (the wave-0 freeze)

Six typed contracts pin the engine↔UI boundary before any parallel work fans out. Full specs in
`contracts/`. Each is zod/TS, lives in `@ciyp/shared`, and is type-checked standalone.

| # | Contract | Direction | Purpose |
|---|---|---|---|
| 01 | **Instance Config** | platform → UI | identity, archetypes, tiers, journeys, branding, prompt-set version, model routing (UI-relevant subset) |
| 02 | **Coaching API** | UI → engine | chat/turn (the `parts` discriminated union + SSE streaming), check-in, voice session |
| 03 | **Usage Event** | runtime → ledger | instance, member, feature, model, in/out tokens, provider, cost, ts, idempotency_key (at-least-once + idempotent) |
| 04 | **Spend Authorization** | runtime ↔ wallet | authorize → allow/deny + remaining |
| 05 | **Entitlement** | platform → UI | what a member is entitled to (Stripe-checkout-derived) |
| 06 | **Shared-core package API** | both | the surface `@ciyp/shared` + `@ciyp/ui-tokens` expose |

**Contract-change discipline:** any change to a frozen contract mid-wave requires a `handoff/
project-state.md` entry + a ping to affected agents. Merge conflicts at wave boundaries are almost always
contract drift.

---

## 14. Rollback & production-mode obligations

Per production-mode needles, each new surface carries a back-out path:

- **Multi-tenant migration** — per-phase rollback in §4.1; the only rewrite trap (NOT NULL + default in one
  step) is called out explicitly.
- **New endpoints (Coaching API, billing webhooks, spend-auth)** — additive; rollback = revert deploy.
  Stripe webhooks are idempotent (event id dedupe).
- **Wallet/ledger** — append-only; a bad debit is corrected by a compensating ledger entry, never a delete.
  Backups confirmed before any ledger backfill.
- **Promotion (ADR-001)** — the cutover is reversible until the shared-DB tenant rows are dropped; that drop
  is the point of no return and is gated behind a verified-parity check + confirmed backup.
- New dependencies require a security pass (npm audit + license) before adoption; metering/billing code
  carries zero TODO/console.log into production paths.

---

## 15. Open questions (genuine gaps — not invented answers)

- **OQ-1 (Voyage vs canon).** ~~Open~~ **Closed 2026-07-02 by ADR-007** — inheritances ratified with
  flip-constraints, eval baselines, and reversal triggers. (Paid Voyage key is now a build prerequisite.)
- **OQ-2 (Luminify archetypes/tiers content).** The *names/descriptions* of Luminify's own archetypes and
  tiers are coaching IP Tim authors at provision time. Seed uses generic placeholders; final content is a
  provisioning input, not an architecture decision.
- **OQ-3 (credit↔cost markup default).** The default markup multiplier (provider cost → credit) is a
  business decision (pricing), not architecture. The *mechanism* is fixed (ADR-003); the *number* is a
  config value Tim sets per tenant. Needs a default for seed.
- **OQ-4 (cheap-call overspend tolerance).** ADR-003 accepts bounded overspend on *cheap* calls under
  concurrency. The exact tolerance (how negative the cache may go before a hard reconcile) is a tunable;
  v1 proposes a conservative small bound. Confirm at load-test.
- **OQ-5 (voice session credit checkpoint interval).** How often a long voice session re-checks the wallet
  (§7.1) trades latency/UX against overspend risk. v1 proposes a fixed interval; tune against real session
  lengths.
- **OQ-6 (assembly-cache memory bound).** The per-tenant Sport assembly cache (§5.5) trades memory
  footprint (hot tenants × per-host assembly size) against cold-start rebuild latency on eviction. The
  cache size / eviction TTL is a **tunable**; v1 sets a conservative bound, confirm at load-test. Resolved
  or superseded when sport-ai-sdk #25's assembly manager lands.

---

## 16. ADR index

| ADR | Title |
|---|---|
| ADR-001 | Engine deploy topology — shared-multi-tenant now, promotable to dedicated later |
| ADR-002 | De-enum & per-tenant instance config |
| ADR-003 | AI wallet + metering + enforcement |
| ADR-004 | Shared-core package distribution across two repos |
| ADR-005 | External integrations as per-tenant pluggable |
| ADR-006 | Sport AI SDK as the agent runtime (ai-design ratification, 2026-07-02) |
| ADR-007 | EL-OS stack inheritances ratified — closes OQ-1 (ai-design ratification, 2026-07-02) |
| ADR-008 | Money topology — coach-owned Stripe (Connect, no pooled funds), optional member credit billing (plan gate, 2026-07-02) |
