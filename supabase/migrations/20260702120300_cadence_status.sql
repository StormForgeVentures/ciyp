-- Migration: cadence_status
-- PRD-001b task 3.2 — Cadence Inputs + Status / Self-Trust-Index domains
-- (EL-OS §2/§3 shape + tenant_id + two-layer RLS).

-- ===========================================================================
-- check_ins — daily check-in rows. One per member per local day.
-- ===========================================================================
create table check_ins (
  id                      uuid          primary key default gen_random_uuid(),
  tenant_id               uuid          not null references tenants (id) on delete cascade,
  member_id               uuid          not null references members (id) on delete cascade,
  checked_in_at           timestamptz   not null default now(),
  local_date              date          not null,
  energy                  smallint      not null check (energy between 1 and 10),
  clarity                 smallint      not null check (clarity between 1 and 10),
  execution               smallint      not null check (execution between 1 and 10),
  emotional_tag           emotional_tag,
  aligned_action_followed boolean,
  free_text               text,
  created_at              timestamptz   not null default now(),
  updated_at              timestamptz   not null default now(),
  constraint check_ins_member_local_date_uq unique (member_id, local_date)
);

create index check_ins_tenant_member_idx  on check_ins (tenant_id, member_id, checked_in_at desc);

create trigger check_ins_set_updated_at
  before update on check_ins
  for each row execute function public.set_updated_at();

select public.enable_tenant_rls('public', 'check_ins');
select public.enable_member_rls('public', 'check_ins', 'member_id');
select public.grant_app_access('public', 'check_ins');

-- ===========================================================================
-- status_history — append-only Green/Yellow/Red transitions.
-- ===========================================================================
create table status_history (
  id           uuid           primary key default gen_random_uuid(),
  tenant_id    uuid           not null references tenants (id) on delete cascade,
  member_id    uuid           not null references members (id) on delete cascade,
  status       member_status  not null,
  reason_codes text[]         not null default '{}',
  triggered_by status_trigger not null,
  computed_at  timestamptz    not null default now()
);

create index status_history_tenant_member_idx on status_history (tenant_id, member_id, computed_at desc);
create index status_history_red_idx
  on status_history (tenant_id, member_id, computed_at desc) where status = 'red';

select public.enable_tenant_rls('public', 'status_history');
select public.enable_member_rls('public', 'status_history', 'member_id');
select public.grant_app_access('public', 'status_history', true);  -- append-only (SELECT+INSERT)

-- ===========================================================================
-- streaks — per-member engagement streak. One row per member.
-- ===========================================================================
create table streaks (
  member_id                   uuid        primary key references members (id) on delete cascade,
  tenant_id                   uuid        not null references tenants (id) on delete cascade,
  current_streak_days         integer     not null default 0,
  longest_streak_days         integer     not null default 0,
  last_check_in_local_date    date,
  consistency_days_this_month integer     not null default 0,
  updated_at                  timestamptz not null default now()
);

create index streaks_tenant_idx on streaks (tenant_id);

create trigger streaks_set_updated_at
  before update on streaks
  for each row execute function public.set_updated_at();

select public.enable_tenant_rls('public', 'streaks');
select public.enable_member_rls('public', 'streaks', 'member_id');
select public.grant_app_access('public', 'streaks');
