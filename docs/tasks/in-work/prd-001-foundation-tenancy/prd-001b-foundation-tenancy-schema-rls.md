# PRD-001b: Multi-Tenant Schema & Two-Layer RLS

> Parent: prd-001-foundation-tenancy-index.md | Module: Platform Foundation & Tenancy

## Goal

Create the multi-tenant Postgres schema: `tenants` as the root entity, every domain table tenant-scoped with two-layer RLS (tenant fence + member fence), the per-tenant config tables that ADR-002 de-enums into, the new platform-economy tables (wallets/ledgers/entitlements/integrations — schema only), and the index plan shipped *with* the schema. Greenfield (no backfill), but the §4.1 lock discipline binds every migration for the platform's lifetime.

## Functional requirements

1. Migration files only (`supabase migration new`); each table's RLS policies ship in the same migration as the table; UUID PKs on every table (ADR-001 promotion invariant).
2. `tenants` root table; **per-tenant** `app_config` keyed by `tenant_id` holding `model_routing` JSONB (slot shape per `docs/ai-architecture/ai-architecture.md` §2, incl. `tts.voice_id`).
3. De-enum config tables (ADR-002): `tenant_archetypes`, `tenant_tiers`, `coaching_process_definitions` (directive shape incl. `source: 'code' | 'authored'`). Generic platform-mechanic enums (ADR-002 §2 list) created as Postgres enums; zero coach-IP enums.
4. Domain tables ported from EL-OS §4.3, each gaining `tenant_id uuid not null` + RLS: identity & access, cadence inputs, status/self-trust-index, AI conversations (`chat_threads`, `chat_messages` with `parts jsonb`), member memory (`member_recent_state`, `member_facts` with `vector(1024)` embedding), `ai_traces` (extended: `prompt_tokens`, `completion_tokens`, `provider`, `model`, `cost_micros`), `ai_ops_audit`, `prompt_versions`, `eval_snapshots`, resource library (`library_items`, `library_chunks` with `vector(1024)` + `tsvector`, `source` provenance enum incl. `upload | vimeo | granola | fathom`), member uploads, admin & notifications, member planning, coach messaging.
5. Platform-economy tables (schema only; behavior in later PRDs): `wallets`, `wallet_ledger` (append-only), `usage_ledger` (append-only, unique `idempotency_key`), `stripe_events` (unique event id), `stripe_customers`, `entitlements`, `tenant_integrations` (provider, status enum `pending|connected|needs_consent|revoked`, envelope-encrypted token columns).
6. RLS: tenant fence `USING (tenant_id = current_setting('app.tenant_id')::uuid)` + `WITH CHECK` on insert for every tenant-scoped table; member fence (second policy layer) on member-owned tables (`member_facts`, `member_recent_state`, chat, uploads, planning).
7. Append-only enforcement on `wallet_ledger`/`usage_ledger`: no UPDATE/DELETE grants for the app role, plus a guard trigger; corrections are compensating entries (architecture §14).
8. Index plan in the same migrations: composite `(tenant_id, <hot predicate>)` on every tenant-scoped table; HNSW on both `vector(1024)` columns; GIN on `tsvector`; unique indexes backing idempotency keys and Stripe event ids.
9. `pnpm db:reset` (or equivalent) applies all migrations to a clean local Supabase and exits 0.

## Acceptance criteria

| # | Given / When / Then |
|---|---------------------|
| AC-1 | Given an empty local Postgres, when all migrations apply, then `supabase migration list` shows every migration applied with zero drift. |
| AC-2 | Given the applied schema, when the RLS sweep test queries `pg_policies`, then every tenant-scoped table has both a `USING` and a `WITH CHECK` tenant policy (no table missing from the sweep's allowlist). |
| AC-3 | Given rows for two tenants in every tenant-scoped table, when the suite selects from each table with `app.tenant_id` set to tenant A, then only tenant A rows return. |
| AC-4 | Given a member-owned table seeded with two members of the same tenant, when member 1's context queries it, then only member 1's rows return (member fence independent of tenant fence). |
| AC-5 | Given an existing `wallet_ledger` row, when the app role attempts UPDATE or DELETE, then the statement is rejected. |
| AC-6 | Given two inserts into `usage_ledger` with the same `idempotency_key`, then the second insert is rejected or de-duplicated (unique constraint proven by test). |
| AC-7 | Given the seeded `member_facts` table, when the tenant+member-scoped kNN recall query is planned with exact-scan alternatives disabled (`enable_seqscan/indexscan/bitmapscan = off`) and a constant query vector, then the plan uses the HNSW index — proving HNSW is a usable access path. (REWORDED, decision #20: the original "no sequential scan under the default planner" is unsatisfiable at seed volume — the optimizer correctly prefers an exact scan over ~31 rows; natural HNSW selection is a production-scale property per architecture §4.4, validated at load test, not seed.) |
| AC-8 | Given the schema SQL, when grepped for the strings of any Kyle-era coach-IP enum value (archetype/tier/method names), then zero matches. |

## Data requirements

Key new tables (full column specs; domain-table ports follow the EL-OS shape + `tenant_id` + RLS and are enumerated in the migration plan, not re-specified here):

**`tenants`** — `id` (uuid pk) · `slug` (text unique) · `display_name` (text) · `status` (enum `active|paused`) · `created_at` (timestamptz).

**`app_config`** — `tenant_id` (uuid pk → tenants) · `model_routing` (jsonb — slot map per ai-architecture §2) · `branding` (jsonb) · `prompt_set_version` (text) · `member_billing_mode` (enum `absorbed | member_credits`, default `absorbed` — ADR-008; read at metering/enforcement seams, PRD-009 activates `member_credits`) · `updated_at` (timestamptz). All reads via the slot resolver keyed by tenant (rule 2). Tenants also carry `stripe_account_ref` (text null — ADR-008, the coach's own Stripe account reference, written by provisioning step 4; credentials live in the 005c vault, never here).

**`tenant_archetypes` / `tenant_tiers`** — `id` (uuid pk) · `tenant_id` (uuid, idx) · `key` (text, unique per tenant) · `label` (text) · `description` (text) · `prompt_fragment` (text, archetypes) / `entitlements_jsonb` (jsonb, tiers) · `sort` (int).

**`wallets`** — `tenant_id` (uuid pk) · `balance_credits` (bigint — materialized from ledger) · `markup_rate` (numeric — OQ-3 default at seed) · `low_balance_threshold_credits` (bigint) · `updated_at`.

**`wallet_ledger`** — `id` (uuid pk) · `tenant_id` (uuid, idx) · `entry_type` (enum `topup|debit|adjustment`) · `credits_delta` (bigint) · `usage_event_id` (uuid null → usage_ledger) · `stripe_ref` (text null) · `created_at` (timestamptz, idx). Append-only.

**`usage_ledger`** — `id` (uuid pk) · `tenant_id` (uuid, idx) · `member_id` (uuid null) · `feature` (text) · `provider`/`model` (text) · `prompt_tokens`/`completion_tokens` (int) · `cost_micros` (bigint) · `priced_cost_micros` (bigint) · `pricebook_version` (text) · `idempotency_key` (text, unique) · `ai_trace_id` (uuid null) · `created_at`. Append-only. (Pricing fields carry the OQ-A pricebook decision — see PRD-007.)

**`entitlements`** — `id` (uuid pk) · `tenant_id` (uuid, idx) · `member_id` (uuid, idx) · `sku` (text) · `status` (enum `active|expired|revoked`) · `source` (enum `stripe_checkout|manual`) · `stripe_ref` (text null) · `expires_at` (timestamptz null).

**`tenant_integrations`** — `id` (uuid pk) · `tenant_id` (uuid, idx) · `provider` (enum `granola|fathom|ghl|other`) · `status` (enum `pending|connected|needs_consent|revoked`) · `server_config` (jsonb) · `access_token_enc`/`refresh_token_enc` (bytea — envelope-encrypted, never plaintext) · `token_rotated_at` · `created_at`.

## Endpoints

No new endpoints (schema-only sub-feature).

## UI/UX

No frontend changes in this slice.

## Hybrid Interface

Not applicable — Traditional lane (the shared shapes defined here are cited by later Hybrid PRDs' interface sections; this sub-feature owns migrations, not contracts).

## Dependencies

| Dependency | Source | Status |
|------------|--------|--------|
| Monorepo scaffold + supabase tooling | 001a | Required |
| EL-OS `data-model.md` + schema (porting reference) | `/mnt/c/Repos/empowered-leader-os` | Available |
| pgvector extension @ 1024-dim | Supabase | Available |

## Open questions

| # | Question | Why it matters | Resolution |
|---|----------|----------------|------------|
| Q-1 | `ai_traces` 30-day retention: partitioning vs scheduled purge? | Table growth under multi-tenant load | Interim: plain table + scheduled purge job; partition when volume warrants (flagged tunable). |
| Q-2 | HNSW parameters (m, ef_construction) | Recall/latency at seed scale is fine on defaults | Interim: pgvector defaults; tune at load test (architecture §4.4 flip triggers unchanged). |
