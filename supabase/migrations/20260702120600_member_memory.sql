-- Migration: member_memory
-- PRD-001b task 3.2 — Member Memory domain (EL-OS §5 + tenant_id + two-layer RLS).
--   L1 member_recent_state (rolling summary) · append-only history · L2 member_facts
--   (atomic facts + vector(1024) embeddings, member-facing/editable).
--   Embedding dim LOCK: vector(1024) (Voyage voyage-3-large; verified live 1024-dim).
--   Runs AFTER ai_ops_audit so member_facts.source_event_id → ai_traces.id is inline.

-- ===========================================================================
-- member_recent_state (L1) — single row per member; LLM-curated rolling summary.
-- ===========================================================================
create table member_recent_state (
  member_id      uuid                       primary key references members (id) on delete cascade,
  tenant_id      uuid                       not null references tenants (id) on delete cascade,
  state          text                       not null default '',
  version        integer                    not null default 1,
  line_count     integer                    not null default 0,
  token_count    integer                    not null default 0,
  updated_reason member_recent_state_reason not null default 'session_boundary',
  updated_at     timestamptz                not null default now()
);

create index member_recent_state_tenant_idx on member_recent_state (tenant_id);

create trigger member_recent_state_set_updated_at
  before update on member_recent_state
  for each row execute function public.set_updated_at();

select public.enable_tenant_rls('public', 'member_recent_state');
select public.enable_member_rls('public', 'member_recent_state', 'member_id');
select public.grant_app_access('public', 'member_recent_state');

-- ===========================================================================
-- member_recent_state_history — append-only L1 audit. Indefinite retention.
-- ===========================================================================
create table member_recent_state_history (
  id            uuid                       primary key default gen_random_uuid(),
  tenant_id     uuid                       not null references tenants (id) on delete cascade,
  member_id     uuid                       not null references members (id) on delete cascade,
  prior_version integer                    not null,
  state         text                       not null,
  line_count    integer                    not null,
  token_count   integer                    not null,
  reason        member_recent_state_reason not null,
  recorded_at   timestamptz                not null default now()
);

create index member_recent_state_history_tenant_member_idx
  on member_recent_state_history (tenant_id, member_id, recorded_at desc);

select public.enable_tenant_rls('public', 'member_recent_state_history');
select public.enable_member_rls('public', 'member_recent_state_history', 'member_id');
select public.grant_app_access('public', 'member_recent_state_history', true);  -- append-only

-- ===========================================================================
-- member_facts (L2) — atomic facts with 1024-dim embeddings + editable-memory
-- deltas. member-facing/editable (anti-dependency principle preserved).
-- ===========================================================================
create table member_facts (
  id              uuid               primary key default gen_random_uuid(),
  tenant_id       uuid               not null references tenants (id) on delete cascade,
  member_id       uuid               not null references members (id) on delete cascade,
  fact            text               not null,
  summary         text,
  tier            member_fact_tier   not null default 'standard',
  source          member_fact_source not null,
  source_ref      jsonb,
  source_event_id uuid               references ai_traces (id) on delete set null,
  member_authored boolean            not null default false,
  confidence      numeric(3,2)       not null default 1.00,
  embedding       vector(1024),                            -- Voyage voyage-3-large @ 1024-dim
  metadata        jsonb              not null default '{}'::jsonb,
  superseded_by   uuid               references member_facts (id),
  expires_at      timestamptz,
  created_at      timestamptz        not null default now()
);

-- HNSW kNN index (pgvector defaults m=16, ef_construction=64) — cosine ops.
create index member_facts_embedding_hnsw
  on member_facts using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);
-- Tenant+member hot-predicate composites (recall is always tenant + member fenced).
create index member_facts_tenant_member_created_idx
  on member_facts (tenant_id, member_id, created_at desc);
create index member_facts_current_idx
  on member_facts (tenant_id, member_id, created_at desc) where superseded_by is null;
create index member_facts_core_tier_idx
  on member_facts (tenant_id, member_id, created_at desc) where superseded_by is null and tier = 'core';

select public.enable_tenant_rls('public', 'member_facts');
select public.enable_member_rls('public', 'member_facts', 'member_id');
select public.grant_app_access('public', 'member_facts');
