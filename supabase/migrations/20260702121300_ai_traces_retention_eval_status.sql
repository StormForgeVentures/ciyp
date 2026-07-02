-- Migration: ai_traces_retention_eval_status
-- PRD-002d §4.1 — the observability lock discipline:
--   * ai_traces: 30-day retention purge function + admin-only SELECT RLS (AC-8).
--   * eval_snapshots: add status (incl. `blocked`), target, alert, run_id; make score
--     nullable (a `blocked` run has no value); admin-only RLS (AC-8).
--   * prompt_versions.change_rationale is already NOT NULL (wave-1 schema) — AC-4 stands.
-- Runs after privilege_hardening (121200); alters existing tables only (no new grants).

-- ===========================================================================
-- eval_snapshots — value/target/alert + status enum with `blocked`.
-- ===========================================================================
do $$ begin
  if not exists (select 1 from pg_type where typname = 'eval_snapshot_status') then
    create type eval_snapshot_status as enum ('ok', 'alert', 'blocked');
  end if;
end $$;

alter table eval_snapshots
  add column if not exists status     eval_snapshot_status not null default 'ok',
  add column if not exists target     numeric(5,4),
  add column if not exists alert      numeric(5,4),
  add column if not exists run_id     text,
  add column if not exists block_reason text;

-- A `blocked` run (e.g. Voyage 429) records no score — score becomes nullable, with a
-- CHECK that a non-blocked row still carries a value (AC-6: a rate-limited run reports
-- `blocked`, never a pass with a fabricated score).
alter table eval_snapshots alter column score drop not null;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'eval_snapshots_score_present_unless_blocked'
  ) then
    alter table eval_snapshots
      add constraint eval_snapshots_score_present_unless_blocked
      check (status = 'blocked' or score is not null);
  end if;
end $$;

create index if not exists eval_snapshots_tenant_run_idx on eval_snapshots (tenant_id, run_id);

-- ===========================================================================
-- Admin-only RLS (AC-8): a non-admin authenticated principal sees ZERO rows in
-- ai_traces / eval_snapshots. The runtime WRITES traces during member turns, so
-- INSERT stays tenant-fenced (any in-tenant context); SELECT requires coach context.
-- ===========================================================================

-- ai_traces: replace the blanket tenant policy with split insert/select policies.
drop policy if exists ai_traces_tenant_isolation on ai_traces;
drop policy if exists ai_traces_insert_tenant on ai_traces;
drop policy if exists ai_traces_select_admin on ai_traces;
create policy ai_traces_insert_tenant on ai_traces
  as permissive for insert to authenticated
  with check (tenant_id = public.current_tenant_id());
create policy ai_traces_select_admin on ai_traces
  as permissive for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_context() = 'coach');

-- eval_snapshots: admin-only for all commands (evals run under a coach/admin scope).
drop policy if exists eval_snapshots_tenant_isolation on eval_snapshots;
drop policy if exists eval_snapshots_admin_only on eval_snapshots;
create policy eval_snapshots_admin_only on eval_snapshots
  as permissive for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_context() = 'coach')
  with check (tenant_id = public.current_tenant_id() and public.current_context() = 'coach');

-- ===========================================================================
-- 30-day retention purge for ai_traces. eval_snapshots + prompt_versions are
-- INDEFINITE (evidence/audit) — never purged. service_role-only.
-- ===========================================================================
create or replace function public.purge_ai_traces(p_older_than interval default interval '30 days')
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted bigint;
begin
  delete from ai_traces where created_at < now() - p_older_than;
  get diagnostics deleted = row_count;
  return deleted;
end $$;

revoke all on function public.purge_ai_traces(interval) from public, anon, authenticated;
grant execute on function public.purge_ai_traces(interval) to service_role;

-- Schedule daily via pg_cron when available (local Supabase may not load it). Idempotent.
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('purge-ai-traces-30d', '17 3 * * *', $cron$ select public.purge_ai_traces() $cron$);
  end if;
exception when others then
  -- pg_cron present but schedule failed (e.g. dup) — non-fatal for the migration.
  null;
end $$;
