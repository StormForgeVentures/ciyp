-- Migration: platform_foundation_helpers_enums
-- PRD-001b task 3.1 (prerequisite for 3.1–3.3).
--
-- Establishes the multi-tenant control-plane primitives every later migration
-- depends on:
--   * extensions (pgvector @ 1024-dim, pgcrypto, pg_trgm)
--   * GUC-scoped identity readers  current_tenant_id() / current_member_id() /
--     current_context() (the backend sets app.tenant_id / app.member_id /
--     app.context per request; RLS reads them)
--   * two-layer RLS installers: enable_tenant_rls() (permissive tenant fence) +
--     enable_member_rls() (RESTRICTIVE member fence — ANDs with the tenant fence;
--     fails CLOSED — coach-wide visibility requires an EXPLICIT app.context='coach',
--     a member context with app.member_id unset sees ZERO member rows)
--   * append-only guard trigger fn + grant helpers
--   * platform-MECHANIC enums only (ADR-002 §2). ZERO coach-IP enums: the
--     donor-era archetype / enrollment_tier / method-agent_kind / stage-name
--     families are DE-ENUMED to per-tenant config rows or free text (ADR-002 §1).
--
-- RLS model note: CIYP is a backend-mediated control plane. Tenancy is carried on
-- the connection via GUCs, NOT via auth.uid() (that was EL-OS's PostgREST model).
-- The app connects as a NON-bypassrls role (`authenticated`) and sets the GUCs;
-- service_role / postgres bypass RLS for system + seed writes.

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
create extension if not exists vector;      -- pgvector (voyage-3-large @ 1024-dim)
create extension if not exists pgcrypto;    -- gen_random_uuid()
create extension if not exists pg_trgm;     -- trigram assist for text search

-- ---------------------------------------------------------------------------
-- GUC-scoped identity readers (the RLS predicates)
--   btrim + nullif(...,'') → unset / empty / whitespace-only GUC all resolve to
--   NULL (fail-closed to zero rows for the tenant fence). btrim closes the L1
--   whitespace-abort vector: a '   ' GUC no longer raises invalid-uuid and aborts
--   the transaction — it reads as unset. Coach-wide visibility on member tables is
--   an EXPLICIT opt-in via app.context='coach' (see current_context / member fence).
-- ---------------------------------------------------------------------------
create or replace function public.current_tenant_id()
returns uuid
language sql
stable
as $$
  select nullif(btrim(current_setting('app.tenant_id', true)), '')::uuid
$$;

create or replace function public.current_member_id()
returns uuid
language sql
stable
as $$
  select nullif(btrim(current_setting('app.member_id', true)), '')::uuid
$$;

-- Session context: 'coach' | 'member' | NULL(unset). Coach context is the ONLY
-- way to see tenant-wide member rows; anything else is member-scoped and fails
-- closed. btrim/nullif so whitespace/empty read as unset (→ member-scoped).
create or replace function public.current_context()
returns text
language sql
stable
as $$
  select nullif(btrim(current_setting('app.context', true)), '')
$$;

-- ---------------------------------------------------------------------------
-- Shared updated_at trigger fn
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Append-only guard: rejects UPDATE/DELETE (row-level) AND TRUNCATE (statement-
-- level) on the ledgers. Fires for EVERY role (incl. service_role / postgres) —
-- corrections are compensating entries only (architecture §14). TG_OP and
-- TG_TABLE_NAME are populated for a BEFORE TRUNCATE ... FOR EACH STATEMENT trigger,
-- so the same function guards both. Attach BOTH a BEFORE UPDATE OR DELETE FOR EACH
-- ROW trigger and a BEFORE TRUNCATE FOR EACH STATEMENT trigger. TRUNCATE is
-- tenant-blind and RLS-exempt, so this trigger (plus REVOKE TRUNCATE, migration
-- 20260702121200) is the ONLY thing standing between the app role and a
-- platform-wide wipe of the money trail.
-- ---------------------------------------------------------------------------
create or replace function public.reject_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'append-only table %: % rejected (corrections are compensating entries)',
    tg_table_name, tg_op
    using errcode = 'restrict_violation';
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS installers
-- ---------------------------------------------------------------------------

-- Permissive tenant fence on every tenant-scoped table (USING + WITH CHECK).
create or replace function public.enable_tenant_rls(p_schema text, p_table text)
returns void
language plpgsql
as $$
begin
  execute format('alter table %I.%I enable row level security', p_schema, p_table);
  execute format('alter table %I.%I force row level security', p_schema, p_table);
  execute format(
    'create policy %I on %I.%I as permissive for all to authenticated '
    || 'using (tenant_id = public.current_tenant_id()) '
    || 'with check (tenant_id = public.current_tenant_id())',
    p_table || '_tenant_isolation', p_schema, p_table);
end;
$$;

-- RESTRICTIVE member fence (defense-in-depth second layer). ANDs with the tenant
-- fence. FAILS CLOSED (H1 remediation): tenant-wide member visibility requires an
-- EXPLICIT coach context (app.context='coach'). In any other context the row must
-- match a NON-NULL current_member_id(), so a member session that sets app.tenant_id
-- but forgets app.member_id sees ZERO member rows instead of the whole tenant.
--   * coach context (app.context='coach')  → all tenant rows (tenant fence still applies)
--   * member context + app.member_id set    → own rows only
--   * member context + app.member_id unset  → ZERO rows (fail closed)
--   * context unset (default)               → member-scoped (fail closed, not coach)
create or replace function public.enable_member_rls(p_schema text, p_table text, p_member_col text)
returns void
language plpgsql
as $$
begin
  execute format(
    'create policy %I on %I.%I as restrictive for all to authenticated '
    || 'using (public.current_context() = ''coach'' '
    || '       or (public.current_member_id() is not null and %I = public.current_member_id())) '
    || 'with check (public.current_context() = ''coach'' '
    || '       or (public.current_member_id() is not null and %I = public.current_member_id()))',
    p_table || '_member_isolation', p_schema, p_table, p_member_col, p_member_col);
end;
$$;

-- Grant the app role (`authenticated`) DML. append_only=true → SELECT+INSERT only
-- (no UPDATE/DELETE grant is the first append-only fence; the guard trigger is the
-- second). Supabase's default privileges do NOT grant DML on postgres-owned tables.
create or replace function public.grant_app_access(p_schema text, p_table text, p_append_only boolean default false)
returns void
language plpgsql
as $$
begin
  if p_append_only then
    execute format('grant select, insert on %I.%I to authenticated', p_schema, p_table);
  else
    execute format('grant select, insert, update, delete on %I.%I to authenticated', p_schema, p_table);
  end if;
end;
$$;

-- ===========================================================================
-- Platform-mechanic enums (ADR-002 §2) — generic across ALL tenants.
-- ===========================================================================

-- Tenancy + billing
create type tenant_status         as enum ('active', 'paused');
create type member_billing_mode   as enum ('absorbed', 'member_credits');  -- ADR-008

-- Identity & access
create type enrollment_status     as enum ('active', 'lapsed');
create type admin_role            as enum ('owner', 'team');
create type user_kind             as enum ('member', 'admin');
create type push_platform         as enum ('ios', 'android');

-- AI conversations
create type chat_thread_state     as enum ('active', 'completed', 'abandoned');
create type chat_message_role     as enum ('user', 'assistant', 'system');
create type interaction_mode      as enum ('instruct', 'call_response', 'free', 'hold');

-- Coaching-process directive machine (NOT the coach's method names — those are text)
create type coaching_process_modality    as enum ('voice', 'guided', 'text');
create type coaching_process_output_type as enum ('metric_threshold', 'doc_approved', 'ai_verified', 'none');
create type coaching_process_source      as enum ('code', 'authored');  -- graduation seam

-- Member memory
create type member_fact_tier          as enum ('core', 'standard');
create type member_fact_source        as enum ('agent_tool', 'auto_extraction', 'coaching_output', 'explicit');
create type member_recent_state_reason as enum ('session_boundary', 'inline_threshold', 'manual_edit', 'coaching_process_completed');

-- Prompt/eval audit
create type prompt_cascade_layer   as enum ('platform', 'tenant', 'coach', 'routing');

-- Status / cadence mechanics
create type member_status          as enum ('green', 'yellow', 'red');
create type status_trigger         as enum ('daily_checkin', 'language_signal', 'weekly_checkpoint', 'manual_admin', 'recompute_job');
create type emotional_tag          as enum ('calm', 'stressed', 'overwhelmed', 'clear', 'flat', 'excited');

-- Member planning
create type member_plan_source     as enum ('admin_imported', 'ai_coauthored', 'member_authored');
create type member_plan_status     as enum ('active', 'superseded', 'completed');

-- Member uploads
create type member_upload_kind             as enum ('journal_text', 'journal_image', 'voice_note', 'attachment');
create type member_upload_transcript_status as enum ('pending', 'complete', 'failed');

-- Resource library
create type library_item_kind      as enum ('video', 'pdf', 'audio', 'article', 'course_video');
create type library_storage_kind   as enum ('cf_stream', 'supabase_storage', 'vimeo', 'external_url');
create type library_ingest_status  as enum ('pending', 'processing', 'complete', 'failed');
create type library_source         as enum ('upload', 'vimeo', 'granola', 'fathom');  -- provenance (FR-4)

-- Admin & interventions
create type admin_intervention_action as enum ('dm', 'call_scheduled', 'reset_protocol_assigned', 'note_added', 'marked_resolved');

-- Coach messaging
create type coach_message_sender   as enum ('coach', 'member');

-- Platform economy
create type wallet_entry_type      as enum ('topup', 'debit', 'adjustment');
create type entitlement_status     as enum ('active', 'expired', 'revoked');
create type entitlement_source     as enum ('stripe_checkout', 'manual');
create type integration_provider   as enum ('granola', 'fathom', 'ghl', 'other');
create type integration_status     as enum ('pending', 'connected', 'needs_consent', 'revoked');
