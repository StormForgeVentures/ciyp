-- Migration: coach_messaging
-- PRD-001b task 3.2 — Coach Messaging domain (EL-OS §10 + tenant_id + RLS).
--   In-app async human coach <-> member text messaging. PERMANENTLY separate from
--   §4 AI Conversations. member_id is denormalized onto both tables for a direct
--   member fence (member context sees only own thread).

-- ===========================================================================
-- coach_message_threads — one row per member (1:1).
-- ===========================================================================
create table coach_message_threads (
  id                  uuid        primary key default gen_random_uuid(),
  tenant_id           uuid        not null references tenants (id) on delete cascade,
  member_id           uuid        not null references members (id) on delete cascade,
  last_message_at     timestamptz,
  member_unread_count integer     not null default 0,
  coach_unread_count  integer     not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint coach_message_threads_member_uq unique (member_id)
);

create index coach_message_threads_tenant_last_idx on coach_message_threads (tenant_id, last_message_at desc);

create trigger coach_message_threads_set_updated_at
  before update on coach_message_threads
  for each row execute function public.set_updated_at();

select public.enable_tenant_rls('public', 'coach_message_threads');
select public.enable_member_rls('public', 'coach_message_threads', 'member_id');
select public.grant_app_access('public', 'coach_message_threads');

-- ===========================================================================
-- coach_messages — one row per message. author_admin_id present iff coach-sent.
-- ===========================================================================
create table coach_messages (
  id              uuid                 primary key default gen_random_uuid(),
  tenant_id       uuid                 not null references tenants (id) on delete cascade,
  member_id       uuid                 not null references members (id) on delete cascade,
  thread_id       uuid                 not null references coach_message_threads (id) on delete cascade,
  sender          coach_message_sender not null,
  author_admin_id uuid                 references admins (id) on delete set null,
  body            text                 not null,
  read_at         timestamptz,
  created_at      timestamptz          not null default now(),
  constraint coach_messages_author_iff_coach
    check ((author_admin_id is not null) = (sender = 'coach'))
);

create index coach_messages_tenant_thread_created_idx on coach_messages (tenant_id, thread_id, created_at desc);
create index coach_messages_thread_unread_idx
  on coach_messages (thread_id, read_at) where read_at is null;

select public.enable_tenant_rls('public', 'coach_messages');
select public.enable_member_rls('public', 'coach_messages', 'member_id');
select public.grant_app_access('public', 'coach_messages');
