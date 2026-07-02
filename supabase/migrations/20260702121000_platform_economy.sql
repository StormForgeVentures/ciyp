-- Migration: platform_economy
-- PRD-001b task 3.3 — platform-economy tables (SCHEMA ONLY; behavior in later
-- PRDs). Append-only ledgers with a guard trigger + no UPDATE/DELETE grant;
-- unique idempotency_key on usage_ledger; envelope-encrypted integration tokens.
-- Money topology per ADR-008 (member payments settle on the coach's own Stripe;
-- only wallet top-ups — flow (b) — touch the platform account).

-- ===========================================================================
-- wallets — one AI credit wallet per tenant (the coach's prepaid balance).
--   balance_credits is MATERIALIZED from wallet_ledger (no magic numbers).
--   markup_rate default = 1.1x (decision #13; seed sets it explicitly).
-- ===========================================================================
create table wallets (
  tenant_id                     uuid          primary key references tenants (id) on delete cascade,
  balance_credits               bigint        not null default 0,
  markup_rate                   numeric(6,3)  not null default 1.100,   -- decision #13 (1.1x)
  low_balance_threshold_credits bigint        not null default 0,
  updated_at                    timestamptz   not null default now()
);

create trigger wallets_set_updated_at
  before update on wallets
  for each row execute function public.set_updated_at();

select public.enable_tenant_rls('public', 'wallets');
select public.grant_app_access('public', 'wallets');

-- ===========================================================================
-- usage_ledger — append-only metered usage. unique idempotency_key (exactly-once).
--   priced_cost_micros / pricebook_version carry the OQ-A pricebook decision
--   (the wallet bills priced tokens, not provider-derived zero-cost). Created
--   BEFORE wallet_ledger (which references it).
-- ===========================================================================
create table usage_ledger (
  id                uuid        primary key default gen_random_uuid(),
  tenant_id         uuid        not null references tenants (id) on delete cascade,
  member_id         uuid        references members (id) on delete set null,
  feature           text        not null,
  provider          text,
  model             text,
  prompt_tokens     integer,
  completion_tokens integer,
  cost_micros       bigint,                              -- provider-derived (may be 0 off-table)
  priced_cost_micros bigint,                             -- platform pricebook (billable)
  pricebook_version text,
  idempotency_key   text        not null,
  ai_trace_id       uuid        references ai_traces (id) on delete set null,
  created_at        timestamptz not null default now(),
  -- Exactly-once metering is PER-TENANT (M1): a global unique on idempotency_key
  -- would let tenant A's key collide-block or existence-probe tenant B on a money
  -- table. Scope the uniqueness to the tenant.
  constraint usage_ledger_tenant_idempotency_key_uq unique (tenant_id, idempotency_key)
);

create index usage_ledger_tenant_created_idx        on usage_ledger (tenant_id, created_at desc);
create index usage_ledger_tenant_feature_created_idx on usage_ledger (tenant_id, feature, created_at desc);
create index usage_ledger_tenant_member_idx          on usage_ledger (tenant_id, member_id, created_at desc);

-- Append-only: guard trigger rejects UPDATE/DELETE for EVERY role; no UPDATE/DELETE
-- grant is the second fence for the app role. The BEFORE TRUNCATE statement trigger
-- closes the C1 vector — TRUNCATE is RLS-exempt and skips the row-level guard, so it
-- gets its own statement-level guard (paired with REVOKE TRUNCATE, migration 121200).
create trigger usage_ledger_append_only
  before update or delete on usage_ledger
  for each row execute function public.reject_mutation();
create trigger usage_ledger_no_truncate
  before truncate on usage_ledger
  for each statement execute function public.reject_mutation();

select public.enable_tenant_rls('public', 'usage_ledger');
select public.grant_app_access('public', 'usage_ledger', true);

-- ===========================================================================
-- wallet_ledger — append-only credit movements. balance = SUM(credits_delta).
--   topup (+), debit (-), adjustment (+/-). Corrections are compensating entries.
-- ===========================================================================
create table wallet_ledger (
  id             uuid              primary key default gen_random_uuid(),
  tenant_id      uuid              not null references tenants (id) on delete cascade,
  entry_type     wallet_entry_type not null,
  credits_delta  bigint            not null,
  usage_event_id uuid              references usage_ledger (id) on delete set null,
  stripe_ref     text,
  created_at     timestamptz       not null default now()
);

create index wallet_ledger_tenant_created_idx on wallet_ledger (tenant_id, created_at desc);
-- One debit per usage event (idempotent metering → wallet).
create unique index wallet_ledger_usage_event_uq
  on wallet_ledger (usage_event_id) where usage_event_id is not null;

create trigger wallet_ledger_append_only
  before update or delete on wallet_ledger
  for each row execute function public.reject_mutation();
create trigger wallet_ledger_no_truncate
  before truncate on wallet_ledger
  for each statement execute function public.reject_mutation();

select public.enable_tenant_rls('public', 'wallet_ledger');
select public.grant_app_access('public', 'wallet_ledger', true);

-- ===========================================================================
-- stripe_events — inbound Stripe webhook audit (idempotency by event id).
-- ===========================================================================
create table stripe_events (
  id           uuid        primary key default gen_random_uuid(),
  tenant_id    uuid        not null references tenants (id) on delete cascade,
  event_id     text        not null,
  type         text        not null,
  payload      jsonb       not null,
  status       text        not null default 'pending',
  received_at  timestamptz not null default now(),
  processed_at timestamptz,
  -- Replay-protection is PER-TENANT (M3): per ADR-008 webhooks arrive from DIFFERENT
  -- coach Stripe accounts, where event ids are unique per account, not globally. A
  -- global unique would let coach B's event be silently dropped as a replay of an
  -- identical id coach A already processed.
  constraint stripe_events_tenant_event_id_uq unique (tenant_id, event_id)
);

create index stripe_events_tenant_received_idx on stripe_events (tenant_id, received_at desc);

select public.enable_tenant_rls('public', 'stripe_events');
select public.grant_app_access('public', 'stripe_events');

-- ===========================================================================
-- stripe_customers — member <-> Stripe customer mapping on the coach's account.
-- ===========================================================================
create table stripe_customers (
  id                 uuid        primary key default gen_random_uuid(),
  tenant_id          uuid        not null references tenants (id) on delete cascade,
  member_id          uuid        references members (id) on delete set null,
  stripe_customer_id text        not null,
  created_at         timestamptz not null default now(),
  constraint stripe_customers_tenant_customer_uq unique (tenant_id, stripe_customer_id)
);

create index stripe_customers_tenant_member_idx on stripe_customers (tenant_id, member_id);

select public.enable_tenant_rls('public', 'stripe_customers');
select public.grant_app_access('public', 'stripe_customers');

-- ===========================================================================
-- entitlements — what a member is entitled to (sku), from Stripe or manual grant.
-- ===========================================================================
create table entitlements (
  id         uuid               primary key default gen_random_uuid(),
  tenant_id  uuid               not null references tenants (id) on delete cascade,
  member_id  uuid               not null references members (id) on delete cascade,
  sku        text               not null,
  status     entitlement_status not null default 'active',
  source     entitlement_source not null,
  stripe_ref text,
  expires_at timestamptz,
  created_at timestamptz        not null default now(),
  updated_at timestamptz        not null default now()
);

create index entitlements_tenant_member_idx on entitlements (tenant_id, member_id, status);

create trigger entitlements_set_updated_at
  before update on entitlements
  for each row execute function public.set_updated_at();

select public.enable_tenant_rls('public', 'entitlements');
select public.grant_app_access('public', 'entitlements');

-- ===========================================================================
-- tenant_integrations — per-tenant MCP/connector catalog (ADR-005). Tokens are
--   envelope-ENCRYPTED bytea, never plaintext (the 005c vault owns the DEK).
-- ===========================================================================
create table tenant_integrations (
  id                uuid                 primary key default gen_random_uuid(),
  tenant_id         uuid                 not null references tenants (id) on delete cascade,
  provider          integration_provider not null,
  status            integration_status  not null default 'pending',
  server_config     jsonb                not null default '{}'::jsonb,
  access_token_enc  bytea,                               -- envelope-encrypted
  refresh_token_enc bytea,                               -- envelope-encrypted
  token_rotated_at  timestamptz,
  created_at        timestamptz          not null default now(),
  updated_at        timestamptz          not null default now(),
  constraint tenant_integrations_tenant_provider_uq unique (tenant_id, provider)
);

create index tenant_integrations_tenant_status_idx on tenant_integrations (tenant_id, status);

create trigger tenant_integrations_set_updated_at
  before update on tenant_integrations
  for each row execute function public.set_updated_at();

select public.enable_tenant_rls('public', 'tenant_integrations');
select public.grant_app_access('public', 'tenant_integrations');
