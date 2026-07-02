-- Migration: ai_conversations
-- PRD-001b task 3.2 — AI Conversations domain (EL-OS §4 shape + tenant_id + RLS).
--   chat_messages is BORN with `parts jsonb` (the frozen discriminated union,
--   architecture §4.5) — never a `content text` column; backfill is disallowed.
--   agent_kind is FREE TEXT (de-enumed — no coach method names in schema).
--   member_id is denormalized onto message/memory rows for a direct member fence.

-- ===========================================================================
-- chat_threads
-- ===========================================================================
create table chat_threads (
  id              uuid              primary key default gen_random_uuid(),
  tenant_id       uuid              not null references tenants (id) on delete cascade,
  member_id       uuid              not null references members (id) on delete cascade,
  agent_kind      text              not null,             -- generic label; de-enumed
  title           text              not null,
  state           chat_thread_state not null default 'active',
  step_index      integer,
  mode            jsonb,
  started_at      timestamptz       not null default now(),
  last_message_at timestamptz       not null default now(),
  completed_at    timestamptz
);

create index chat_threads_tenant_member_last_idx  on chat_threads (tenant_id, member_id, last_message_at desc);
create index chat_threads_tenant_member_agent_idx on chat_threads (tenant_id, member_id, agent_kind);

select public.enable_tenant_rls('public', 'chat_threads');
select public.enable_member_rls('public', 'chat_threads', 'member_id');
select public.grant_app_access('public', 'chat_threads');

-- ===========================================================================
-- chat_messages — BORN with `parts jsonb`.
-- ===========================================================================
create table chat_messages (
  id          uuid              primary key default gen_random_uuid(),
  tenant_id   uuid              not null references tenants (id) on delete cascade,
  member_id   uuid              not null references members (id) on delete cascade,
  thread_id   uuid              not null references chat_threads (id) on delete cascade,
  role        chat_message_role not null,
  parts       jsonb             not null,                 -- the SSE-wire discriminated union
  metadata    jsonb,
  model_id    text,
  token_usage jsonb,
  created_at  timestamptz       not null default now()
);

create index chat_messages_tenant_thread_created_idx on chat_messages (tenant_id, thread_id, created_at);

select public.enable_tenant_rls('public', 'chat_messages');
select public.enable_member_rls('public', 'chat_messages', 'member_id');
select public.grant_app_access('public', 'chat_messages');

-- ===========================================================================
-- chat_thread_memory — per-thread durable JSONB (1:1 with chat_threads).
-- ===========================================================================
create table chat_thread_memory (
  thread_id  uuid        primary key references chat_threads (id) on delete cascade,
  tenant_id  uuid        not null references tenants (id) on delete cascade,
  member_id  uuid        not null references members (id) on delete cascade,
  memory     jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index chat_thread_memory_tenant_member_idx on chat_thread_memory (tenant_id, member_id);

create trigger chat_thread_memory_set_updated_at
  before update on chat_thread_memory
  for each row execute function public.set_updated_at();

select public.enable_tenant_rls('public', 'chat_thread_memory');
select public.enable_member_rls('public', 'chat_thread_memory', 'member_id');
select public.grant_app_access('public', 'chat_thread_memory');

-- ===========================================================================
-- coaching_outputs — structured outputs from coaching-process agents.
-- ===========================================================================
create table coaching_outputs (
  id          uuid        primary key default gen_random_uuid(),
  tenant_id   uuid        not null references tenants (id) on delete cascade,
  member_id   uuid        not null references members (id) on delete cascade,
  thread_id   uuid        not null references chat_threads (id) on delete cascade,
  agent_kind  text        not null,                       -- generic label; de-enumed
  output      jsonb       not null,
  occurred_at timestamptz not null default now()
);

create index coaching_outputs_tenant_member_idx on coaching_outputs (tenant_id, member_id, occurred_at desc);
create index coaching_outputs_thread_idx        on coaching_outputs (thread_id);

select public.enable_tenant_rls('public', 'coaching_outputs');
select public.enable_member_rls('public', 'coaching_outputs', 'member_id');
select public.grant_app_access('public', 'coaching_outputs');
