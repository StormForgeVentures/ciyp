-- Migration: member_content
-- PRD-001b task 3.2 — Member Uploads, Member Planning, Admin interventions, and
-- the push delivery log (EL-OS §7/§8/§9 + tenant_id + RLS).
--   E.M.P.O.W.E.R. stage + push category are DE-ENUMED to free text (coach-IP).

-- ===========================================================================
-- member_uploads — journal / voice-note / attachment uploads (member-owned).
-- ===========================================================================
create table member_uploads (
  id                uuid                            primary key default gen_random_uuid(),
  tenant_id         uuid                            not null references tenants (id) on delete cascade,
  member_id         uuid                            not null references members (id) on delete cascade,
  kind              member_upload_kind              not null,
  storage_path      text                            not null,
  transcript        text,
  transcript_status member_upload_transcript_status,
  linked_thread_id  uuid                            references chat_threads (id) on delete set null,
  created_at        timestamptz                     not null default now()
);

create index member_uploads_tenant_member_idx on member_uploads (tenant_id, member_id, created_at desc);
create index member_uploads_thread_idx
  on member_uploads (linked_thread_id) where linked_thread_id is not null;

select public.enable_tenant_rls('public', 'member_uploads');
select public.enable_member_rls('public', 'member_uploads', 'member_id');
select public.grant_app_access('public', 'member_uploads');

-- ===========================================================================
-- member_plans — the commitment frame (member-owned). One active per member.
--   stage_focus is FREE TEXT (de-enumed E.M.P.O.W.E.R. — coach-IP).
-- ===========================================================================
create table member_plans (
  id                  uuid               primary key default gen_random_uuid(),
  tenant_id           uuid               not null references tenants (id) on delete cascade,
  member_id           uuid               not null references members (id) on delete cascade,
  stage_focus         text,                              -- de-enumed
  outcomes            jsonb              not null default '[]'::jsonb,
  daily_commitments   jsonb              not null default '[]'::jsonb,
  signature_questions jsonb              not null default '[]'::jsonb,
  source              member_plan_source not null,
  period_days         integer            not null default 90,
  period_start_date   date               not null,
  period_end_date     date               not null,
  status              member_plan_status not null default 'active',
  supersedes_plan_id  uuid               references member_plans (id),
  created_by_admin_id uuid               references admins (id) on delete set null,
  created_at          timestamptz        not null default now(),
  updated_at          timestamptz        not null default now()
);

create unique index member_plans_one_active_per_member
  on member_plans (member_id) where status = 'active';
create index member_plans_tenant_member_status_idx on member_plans (tenant_id, member_id, status);

create trigger member_plans_set_updated_at
  before update on member_plans
  for each row execute function public.set_updated_at();

select public.enable_tenant_rls('public', 'member_plans');
select public.enable_member_rls('public', 'member_plans', 'member_id');
select public.grant_app_access('public', 'member_plans');

-- ===========================================================================
-- admin_interventions — coach acts on a member (admin-only; members never see).
--   Tenant-fenced, NO member fence.
-- ===========================================================================
create table admin_interventions (
  id                     uuid                      primary key default gen_random_uuid(),
  tenant_id              uuid                      not null references tenants (id) on delete cascade,
  member_id              uuid                      not null references members (id) on delete cascade,
  admin_id               uuid                      not null references admins (id) on delete restrict,
  action                 admin_intervention_action not null,
  notes                  text,
  triggered_by_status_id uuid                      references status_history (id) on delete set null,
  created_at             timestamptz               not null default now()
);

create index admin_interventions_tenant_member_idx on admin_interventions (tenant_id, member_id, created_at desc);

select public.enable_tenant_rls('public', 'admin_interventions');
select public.grant_app_access('public', 'admin_interventions');

-- ===========================================================================
-- push_deliveries — push attempt log. category is FREE TEXT (de-enumed).
-- ===========================================================================
create table push_deliveries (
  id            uuid        primary key default gen_random_uuid(),
  tenant_id     uuid        not null references tenants (id) on delete cascade,
  user_id       uuid        not null,                    -- members.id or admins.id
  user_kind     user_kind   not null,
  push_token_id uuid        references push_tokens (id) on delete set null,
  category      text        not null,                    -- de-enumed
  title         text        not null,
  body          text        not null,
  data          jsonb,
  status        text        not null default 'queued',
  error_message text,
  sent_at       timestamptz,
  created_at    timestamptz not null default now()
);

create index push_deliveries_tenant_user_idx on push_deliveries (tenant_id, user_id, created_at desc);
create index push_deliveries_status_idx       on push_deliveries (tenant_id, status);

select public.enable_tenant_rls('public', 'push_deliveries');
select public.grant_app_access('public', 'push_deliveries');
