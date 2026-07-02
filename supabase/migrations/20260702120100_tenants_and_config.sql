-- Migration: tenants_and_config
-- PRD-001b task 3.1 — root tenant entity, per-tenant app_config (the slot map),
-- and the ADR-002 de-enum config tables. Zero coach-IP enums; archetypes / tiers /
-- coaching methods are per-tenant ROWS (authored content), not enum values.

-- ===========================================================================
-- tenants — the root entity. Coach = tenant (ADR-001). NO tenant_id column
-- (its own id IS the tenant scope). stripe_account_ref = the coach's own Stripe
-- account reference (ADR-008; credentials live in the 005c vault, never here).
-- ===========================================================================
create table tenants (
  id                 uuid          primary key default gen_random_uuid(),
  slug               text          not null unique,
  display_name       text          not null,
  status             tenant_status not null default 'active',
  stripe_account_ref text,                                   -- ADR-008, written by provisioning step 4
  created_at         timestamptz   not null default now(),
  updated_at         timestamptz   not null default now()
);

create trigger tenants_set_updated_at
  before update on tenants
  for each row execute function public.set_updated_at();

-- A tenant may only see its own row (id is the scope, not a tenant_id column).
alter table tenants enable row level security;
alter table tenants force row level security;
create policy tenants_self_isolation on tenants
  as permissive for all to authenticated
  using (id = public.current_tenant_id())
  with check (id = public.current_tenant_id());
grant select, insert, update, delete on tenants to authenticated;

-- ===========================================================================
-- app_config — ONE row per tenant. model_routing holds the ai-architecture §2
-- slot map (default/fast/classify/deep/worker/synthesis/vision/embed/rerank/stt/tts,
-- incl. tts.voice_id). member_billing_mode = ADR-008 (PRD-009 activates member_credits).
-- ===========================================================================
create table app_config (
  tenant_id          uuid                primary key references tenants (id) on delete cascade,
  model_routing      jsonb               not null,
  branding           jsonb               not null default '{}'::jsonb,
  prompt_set_version text                not null default 'v1',
  member_billing_mode member_billing_mode not null default 'absorbed',  -- ADR-008
  updated_at         timestamptz         not null default now()
);

create trigger app_config_set_updated_at
  before update on app_config
  for each row execute function public.set_updated_at();

select public.enable_tenant_rls('public', 'app_config');
select public.grant_app_access('public', 'app_config');

-- ===========================================================================
-- tenant_archetypes — de-enumed `archetype` (ADR-002 §1). A member's archetype
-- is an FK to a tenant-scoped row; the cascade injects prompt_fragment, never
-- branches on a hardcoded enum.
-- ===========================================================================
create table tenant_archetypes (
  id              uuid        primary key default gen_random_uuid(),
  tenant_id       uuid        not null references tenants (id) on delete cascade,
  key             text        not null,
  label           text        not null,
  description     text        not null default '',
  prompt_fragment text        not null,               -- non-empty (PRD-001c FR-3)
  sort            integer     not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- Unique per tenant so a member's (tenant_id, archetype_key) FK resolves.
  constraint tenant_archetypes_tenant_key_uq unique (tenant_id, key)
);

create index tenant_archetypes_tenant_sort_idx on tenant_archetypes (tenant_id, sort);

create trigger tenant_archetypes_set_updated_at
  before update on tenant_archetypes
  for each row execute function public.set_updated_at();

select public.enable_tenant_rls('public', 'tenant_archetypes');
select public.grant_app_access('public', 'tenant_archetypes');

-- ===========================================================================
-- tenant_tiers — de-enumed `enrollment_tier` (ADR-002 §1). entitlements_jsonb
-- carries the tier's grants (stacked config; ADR-008 non-preclusion).
-- ===========================================================================
create table tenant_tiers (
  id                 uuid        primary key default gen_random_uuid(),
  tenant_id          uuid        not null references tenants (id) on delete cascade,
  key                text        not null,
  label              text        not null,
  description        text        not null default '',
  entitlements_jsonb jsonb       not null default '{}'::jsonb,
  sort               integer     not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint tenant_tiers_tenant_key_uq unique (tenant_id, key)
);

create index tenant_tiers_tenant_sort_idx on tenant_tiers (tenant_id, sort);

create trigger tenant_tiers_set_updated_at
  before update on tenant_tiers
  for each row execute function public.set_updated_at();

select public.enable_tenant_rls('public', 'tenant_tiers');
select public.grant_app_access('public', 'tenant_tiers');

-- ===========================================================================
-- coaching_process_definitions — admin-authored DIRECTIVE (methodology / purpose /
-- mode_arc / constraints / examples), not a per-line script (ADR-002 §1, reuses
-- EL-OS Decision #25). Per-tenant now. `source` = code|authored graduation seam.
-- agent_kind / method identity is FREE TEXT (de-enumed — no coach method names in
-- schema). One active version per (tenant_id, key).
-- ===========================================================================
create table coaching_process_definitions (
  id                       uuid                          primary key default gen_random_uuid(),
  tenant_id                uuid                          not null references tenants (id) on delete cascade,
  key                      text                          not null,
  title                    text                          not null,
  directive                text                          not null,   -- the load-bearing field
  modality                 coaching_process_modality     not null default 'text',
  mode_arc                 jsonb,
  pinned_lines             jsonb,
  examples                 jsonb,
  steps                    jsonb,
  output_type              coaching_process_output_type  not null default 'none',
  exit_condition           jsonb,
  source                   coaching_process_source       not null default 'authored',
  agent_kind               text,                         -- generic label; de-enumed
  version                  integer                       not null default 1,
  supersedes_definition_id uuid                          references coaching_process_definitions (id),
  is_active                boolean                       not null default true,
  created_at               timestamptz                   not null default now(),
  updated_at               timestamptz                   not null default now()
);

-- One active version per key, per tenant.
create unique index coaching_process_definitions_one_active_per_key
  on coaching_process_definitions (tenant_id, key)
  where is_active = true;
create index coaching_process_definitions_tenant_key_version_idx
  on coaching_process_definitions (tenant_id, key, version desc);

create trigger coaching_process_definitions_set_updated_at
  before update on coaching_process_definitions
  for each row execute function public.set_updated_at();

select public.enable_tenant_rls('public', 'coaching_process_definitions');
select public.grant_app_access('public', 'coaching_process_definitions');
