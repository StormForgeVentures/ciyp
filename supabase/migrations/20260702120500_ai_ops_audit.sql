-- Migration: ai_ops_audit
-- PRD-001b task 3.2 — AI Ops audit domain (EL-OS §5 + tenant_id + RLS).
--   ai_traces is the observability + METERING substrate (ADR-003), EXTENDED with
--   prompt_tokens / completion_tokens / provider / model / cost_micros.
--   event_type is FREE TEXT (de-enumed — methodology signal names are not schema).
--   These are coach/admin ops tables (tenant-fenced, no member fence — members
--   never see traces). Append-only for the app role; the purge job is service_role.

-- ===========================================================================
-- ai_traces — one row per meaningful AI decision. member_id null = system trace.
-- ===========================================================================
create table ai_traces (
  id                uuid        primary key default gen_random_uuid(),
  tenant_id         uuid        not null references tenants (id) on delete cascade,
  member_id         uuid        references members (id) on delete set null,
  thread_id         uuid        references chat_threads (id) on delete set null,
  message_id        uuid        references chat_messages (id) on delete set null,
  event_type        text        not null,                 -- de-enumed
  feature           text,
  provider          text,                                 -- extended (metering)
  model             text,                                 -- extended (metering)
  prompt_tokens     integer,                              -- extended (metering)
  completion_tokens integer,                              -- extended (metering)
  cost_micros       bigint,                               -- extended (metering; provider-derived)
  latency_ms        integer,
  data              jsonb       not null default '{}'::jsonb,
  created_at        timestamptz not null default now()
);

create index ai_traces_tenant_created_idx        on ai_traces (tenant_id, created_at desc);
create index ai_traces_tenant_member_created_idx on ai_traces (tenant_id, member_id, created_at desc);
create index ai_traces_tenant_event_created_idx  on ai_traces (tenant_id, event_type, created_at desc);

select public.enable_tenant_rls('public', 'ai_traces');
select public.grant_app_access('public', 'ai_traces', true);  -- append-only for app role

-- ===========================================================================
-- ai_ops_audit — config/prompt/model change audit (who changed what, when).
-- ===========================================================================
create table ai_ops_audit (
  id          uuid        primary key default gen_random_uuid(),
  tenant_id   uuid        not null references tenants (id) on delete cascade,
  actor_admin_id uuid     references admins (id) on delete set null,
  action      text        not null,
  target      text,
  data        jsonb       not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index ai_ops_audit_tenant_created_idx on ai_ops_audit (tenant_id, created_at desc);

select public.enable_tenant_rls('public', 'ai_ops_audit');
select public.grant_app_access('public', 'ai_ops_audit', true);  -- append-only

-- ===========================================================================
-- prompt_versions — append-only prompt-cascade-block change audit. Per-tenant.
-- NO ON DELETE cascade anywhere — the chain is load-bearing (indefinite retention).
-- ===========================================================================
create table prompt_versions (
  id               uuid                 primary key default gen_random_uuid(),
  tenant_id        uuid                 not null references tenants (id) on delete cascade,
  layer            prompt_cascade_layer not null,
  agent_kind       text,
  block_id         text                 not null,
  content          text                 not null,
  prior_version_id uuid                 references prompt_versions (id),
  change_rationale text                 not null,
  eval_snapshot_id uuid,                                   -- FK added after eval_snapshots
  changed_by_admin_id uuid              references admins (id),
  created_at       timestamptz          not null default now()
);

create index prompt_versions_tenant_block_created_idx
  on prompt_versions (tenant_id, layer, agent_kind, block_id, created_at desc);

select public.enable_tenant_rls('public', 'prompt_versions');
select public.grant_app_access('public', 'prompt_versions', true);  -- append-only

-- ===========================================================================
-- eval_snapshots — indefinite-retention eval-suite results. Per-tenant.
-- ===========================================================================
create table eval_snapshots (
  id                 uuid         primary key default gen_random_uuid(),
  tenant_id          uuid         not null references tenants (id) on delete cascade,
  metric             text         not null,
  feature            text,
  golden_set_version text         not null,
  score              numeric(5,4) not null,
  sample_size        integer      not null,
  data               jsonb        not null default '{}'::jsonb,
  prompt_version_id  uuid         references prompt_versions (id),
  snapshot_at        timestamptz  not null default now(),
  created_at         timestamptz  not null default now()
);

create index eval_snapshots_tenant_metric_idx  on eval_snapshots (tenant_id, metric, snapshot_at desc);
create index eval_snapshots_tenant_feature_idx on eval_snapshots (tenant_id, feature, snapshot_at desc);

alter table prompt_versions
  add constraint prompt_versions_eval_snapshot_id_fkey
  foreign key (eval_snapshot_id) references eval_snapshots (id);

select public.enable_tenant_rls('public', 'eval_snapshots');
select public.grant_app_access('public', 'eval_snapshots', true);  -- append-only
