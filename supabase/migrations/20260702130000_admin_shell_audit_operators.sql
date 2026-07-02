-- Migration: admin_shell_audit_operators
-- PRD-006a task 1.3 — the security spine's two missing tables:
--   * platform_operators — the Luminify superadmin allowlist (cross-tenant operators).
--     NOT tenant-scoped (no tenant_id): a superadmin acts ACROSS tenants. Resolved by
--     apps/api during identity lookup (as the bypassrls system role); the `authenticated`
--     app role is never granted access to it.
--   * admin_audit_log — every superadmin-switched mutation writes a row here (operator id,
--     target tenant, action, entity, timestamp). Append-only (same discipline as the money
--     ledgers): SELECT/INSERT only for the app role, UPDATE/DELETE/TRUNCATE rejected.
--
-- MUST run AFTER 20260702121200_privilege_hardening: that migration's ALTER DEFAULT
-- PRIVILEGES strips TRUNCATE/REFERENCES/TRIGGER/MAINTAIN from tables created later, so these
-- two tables inherit the hardened default (no leaked TRUNCATE on the new audit ledger).

-- ===========================================================================
-- platform_operators — superadmin (Luminify operator) allowlist. Platform-level,
-- NOT tenant-scoped. auth_user_id links to a Supabase Auth user (nullable so the seed
-- can pre-create by email and backfill the id when the GoTrue user is minted).
-- RLS is enabled + forced with NO policy and NO app grant: the `authenticated` role
-- can never read or write it. apps/api reads it only as the bypassrls system role
-- during identity resolution (before any tenant scope exists).
-- ===========================================================================
create table if not exists platform_operators (
  id           uuid        primary key default gen_random_uuid(),
  auth_user_id uuid        unique,
  email        text        not null unique,
  display_name text        not null,
  created_at   timestamptz not null default now()
);

alter table platform_operators enable row level security;
alter table platform_operators force row level security;
-- Intentionally NO policy and NO grant_app_access: fail-closed for `authenticated`.

-- ===========================================================================
-- admin_audit_log — append-only audit trail (PRD-006a data requirements). Written by
-- every superadmin-switched mutation and reused by 006b/006c write paths. Tenant-scoped
-- (the target tenant of the action), indexed (tenant_id, created_at).
-- ===========================================================================
-- tenant_id is ON DELETE RESTRICT, NOT cascade: the audit trail must OUTLIVE a tenant record.
-- A cascade would let a tenant hard-delete silently wipe its money/config audit history — the
-- exact append-only invariant this table exists to protect. Tenants are suspended, not deleted;
-- a hard delete is blocked while any audit row references the tenant (fail-safe).
create table if not exists admin_audit_log (
  id                   uuid        primary key default gen_random_uuid(),
  tenant_id            uuid        not null references tenants (id) on delete restrict,
  actor_user_id        uuid        not null,           -- Supabase auth_user_id of the actor
  acting_as_superadmin boolean     not null default false,
  action               text        not null,           -- e.g. 'tenant.suspend', 'team.add_member'
  entity               text        not null,           -- e.g. 'tenant', 'admin'
  entity_id            text,                            -- affected row id (text: heterogeneous)
  created_at           timestamptz not null default now()
);

create index if not exists admin_audit_log_tenant_created_idx
  on admin_audit_log (tenant_id, created_at);

-- Append-only for the APP role, enforced primarily by the grant below (SELECT + INSERT only —
-- `authenticated` holds no UPDATE/DELETE/TRUNCATE privilege, and post-hardening default privileges
-- deny TRUNCATE on new tables). On top of that: an UPDATE guard makes rows IMMUTABLE for every
-- role (an audit entry is never edited in place), and a TRUNCATE guard blocks a bulk wipe by any
-- role. Targeted DELETE by the system role (`postgres`) is intentionally permitted — unlike the
-- money ledgers (121000, fully postgres-proof), this action log must support legitimate lifecycle
-- maintenance (tenant offboarding, test-fixture teardown). The app/coach can never tamper with or
-- remove an entry; only trusted platform maintenance can, and only row-targeted (never a wipe).
create trigger admin_audit_log_no_update
  before update on admin_audit_log
  for each row execute function public.reject_mutation();
create trigger admin_audit_log_no_truncate
  before truncate on admin_audit_log
  for each statement execute function public.reject_mutation();

-- Two-layer RLS in-file (wave-1 convention): permissive tenant fence (USING + WITH CHECK)
-- via the shared installer, then the append-only app grant (SELECT + INSERT only).
select public.enable_tenant_rls('public', 'admin_audit_log');
select public.grant_app_access('public', 'admin_audit_log', true);
