-- Migration: identity
-- PRD-001b task 3.2 — Identity & Access domain (EL-OS §1 shape + tenant_id + RLS).
--
-- CIYP adaptation: members are backend-mediated tenant rows, NOT auth.users PKs
-- (EL-OS's single-tenant PostgREST model). `auth_user_id` is an optional future
-- linkage column (nullable, no FK to auth.users → seed stays free of GoTrue rows).
-- The Kyle `archetype` / `enrollment_tier` enums are DE-ENUMED (ADR-002 §1) to
-- text keys that FK to the per-tenant config rows created in 20260702120100.

-- ===========================================================================
-- admins — the coach + team for a tenant (authoring/coach side, not members).
-- Tenant-fenced only (no member fence). created_by_* FKs across the schema
-- point here.
-- ===========================================================================
create table admins (
  id           uuid        primary key default gen_random_uuid(),
  tenant_id    uuid        not null references tenants (id) on delete cascade,
  auth_user_id uuid,                                   -- optional Supabase Auth linkage
  email        text        not null,
  display_name text        not null,
  role         admin_role  not null default 'team',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint admins_tenant_email_uq unique (tenant_id, email)
);

create index admins_tenant_role_idx on admins (tenant_id, role);

create trigger admins_set_updated_at
  before update on admins
  for each row execute function public.set_updated_at();

select public.enable_tenant_rls('public', 'admins');
select public.grant_app_access('public', 'admins');

-- ===========================================================================
-- members — the customer-facing app user, scoped to a tenant. archetype/tier are
-- de-enumed text keys → composite FK to the tenant's config rows.
-- ===========================================================================
create table members (
  id                   uuid              primary key default gen_random_uuid(),
  tenant_id            uuid              not null references tenants (id) on delete cascade,
  auth_user_id         uuid,                            -- optional Supabase Auth linkage
  email                text              not null,
  display_name         text              not null,
  external_ref         text,                            -- coach CRM/GHL contact id (per-tenant)
  archetype_key        text,                            -- de-enumed → tenant_archetypes.key
  tier_key             text,                            -- de-enumed → tenant_tiers.key
  enrollment_status    enrollment_status not null default 'active',
  enrolled_at          timestamptz       not null default now(),
  lapsed_at            timestamptz,
  timezone             text              not null default 'America/Los_Angeles',
  -- Notification prefs (columns-on-members form, EL-OS PRD-08).
  daily_reminder_local_time time         not null default '08:00',
  daily_reminder_enabled    boolean      not null default true,
  streak_milestone_enabled  boolean      not null default true,
  coach_reply_enabled       boolean      not null default true,
  created_at           timestamptz       not null default now(),
  updated_at           timestamptz       not null default now(),
  constraint members_tenant_email_uq unique (tenant_id, email),
  -- Referential integrity to the per-tenant de-enum config (same tenant).
  constraint members_archetype_fk
    foreign key (tenant_id, archetype_key)
    references tenant_archetypes (tenant_id, key) on update cascade,
  constraint members_tier_fk
    foreign key (tenant_id, tier_key)
    references tenant_tiers (tenant_id, key) on update cascade
);

create index members_tenant_created_idx on members (tenant_id, created_at desc);
create index members_tenant_status_idx  on members (tenant_id, enrollment_status);
create index members_archetype_idx       on members (tenant_id, archetype_key);
create index members_tier_idx            on members (tenant_id, tier_key);

create trigger members_set_updated_at
  before update on members
  for each row execute function public.set_updated_at();

-- Two-layer fence: tenant + member (member fences on the members.id column).
select public.enable_tenant_rls('public', 'members');
select public.enable_member_rls('public', 'members', 'id');
select public.grant_app_access('public', 'members');

-- ===========================================================================
-- push_tokens — device push tokens per user (member OR admin). Tenant-fenced.
-- ===========================================================================
create table push_tokens (
  id              uuid          primary key default gen_random_uuid(),
  tenant_id       uuid          not null references tenants (id) on delete cascade,
  user_id         uuid          not null,               -- members.id or admins.id
  user_kind       user_kind     not null,
  expo_push_token text          not null,
  platform        push_platform not null,
  created_at      timestamptz   not null default now(),
  last_used_at    timestamptz   not null default now(),
  constraint push_tokens_user_token_uq unique (user_id, expo_push_token)
);

create index push_tokens_tenant_user_idx on push_tokens (tenant_id, user_id);
create index push_tokens_last_used_idx    on push_tokens (last_used_at);

select public.enable_tenant_rls('public', 'push_tokens');
select public.grant_app_access('public', 'push_tokens');
