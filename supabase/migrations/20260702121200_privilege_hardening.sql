-- Migration: privilege_hardening
-- PRD-001b wave-1 security remediation (security-001-wave-1 C1/M2, qa B-M2).
-- MUST run last: it strips base-default privileges from EXISTING tables, so every
-- table-creating migration must already have run.
--
-- Root cause (verified live on pg17): `postgres`'s default privileges on schema
-- public grant `Dxtm` (TRUNCATE, REFERENCES, TRIGGER, MAINTAIN) to anon /
-- authenticated / service_role on every table our migrations create. The migrations
-- only ever GRANT (via grant_app_access) and never REVOKE, so:
--   * C1 — anon/authenticated/service_role hold TRUNCATE on the append-only money
--     ledgers. TRUNCATE is RLS-exempt and skips the row-level append-only guard, so
--     the app role could wipe every tenant's ledger platform-wide in one statement.
--     (The BEFORE TRUNCATE statement guards added in 121000 are belt-and-suspenders;
--     this REVOKE is the primary fence.)
--   * M2 — anon holds privileges across the whole control plane despite being an
--     unused principal (CIYP is backend-mediated; anon is not a used role).
--   * REFERENCES/TRIGGER let a compromised app role create FKs/triggers on our
--     tables — least-privilege violation; the app never does DDL.

-- ---------------------------------------------------------------------------
-- 1) Existing tables — strip the leaked non-DML privileges.
--    authenticated/service_role keep the SELECT/INSERT(/UPDATE/DELETE) that
--    grant_app_access issued; only TRUNCATE/REFERENCES/TRIGGER/MAINTAIN go.
-- ---------------------------------------------------------------------------
revoke truncate, references, trigger, maintain
  on all tables in schema public from authenticated;
revoke truncate, references, trigger, maintain
  on all tables in schema public from service_role;

-- anon is not a used principal on the CIYP control plane → no privileges at all.
revoke all
  on all tables in schema public from anon;

-- ---------------------------------------------------------------------------
-- 2) Future tables — stop `postgres` (the migration role) from re-granting the
--    leak on tables created by later migrations. Without this, every new table
--    would re-open the TRUNCATE/REFERENCES/TRIGGER surface.
-- ---------------------------------------------------------------------------
alter default privileges for role postgres in schema public
  revoke truncate, references, trigger, maintain on tables from authenticated;
alter default privileges for role postgres in schema public
  revoke truncate, references, trigger, maintain on tables from service_role;
alter default privileges for role postgres in schema public
  revoke all on tables from anon;
