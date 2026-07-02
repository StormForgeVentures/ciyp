-- Migration: store_member_subscriptions (PRD-008a §1.1/§1.3, wave 2)
-- Adds the Stripe-mirrored subscription projection the program-access store writes
-- from webhook events, and the 'stripe' integration_provider value so the interim
-- coach-Stripe connector can vault the restricted key + webhook signing secret in
-- the existing tenant_integrations encrypted-bytea table (ADR-008; the full 005c
-- connector vault drops in behind the connector port in wave 4).
--
-- Runs AFTER 20260702121200_privilege_hardening: the ALTER DEFAULT PRIVILEGES there
-- already strips truncate/references/trigger/maintain (authenticated/service_role)
-- and all-from-anon for tables created here, so member_subscriptions inherits the
-- hardened baseline; grant_app_access re-grants only the DML it needs.
--
-- NOTE on the enum add: `alter type ... add value` is safe inside this migration's
-- transaction because nothing here USES the new 'stripe' literal in DML/DDL (the
-- Postgres "unsafe use of new enum value" rule only bites same-transaction USE). The
-- seed and the runtime connector reference provider='stripe' in later, separate
-- transactions.

-- ---------------------------------------------------------------------------
-- 1) Extend the connector catalog enum so the interim Stripe connector can store
--    its vault row (provider='stripe'). Idempotent.
-- ---------------------------------------------------------------------------
alter type integration_provider add value if not exists 'stripe';

-- ---------------------------------------------------------------------------
-- 2) member_subscriptions — the Stripe subscription MIRROR (rebuildable projection
--    source for contract-05 entitlement). One row per (tenant, member, stripe sub).
--    stripe_status is stored VERBATIM (Stripe's own status); the contract-05 status
--    (active|trialing|past_due|canceled|expired|none) is COMPUTED at read time from
--    stripe_status + current_period_end (a lapsed period end reads as 'expired' even
--    before the renewal-failure webhook lands — PRD-008a FR-7 / AC-7). tier_id is the
--    program-access tier the SKU grants; tierKey + features[] resolve from it.
--    Mutable (webhooks upsert/update it); the append-only audit lives in stripe_events.
-- ---------------------------------------------------------------------------
create table member_subscriptions (
  id                     uuid        primary key default gen_random_uuid(),
  tenant_id              uuid        not null references tenants (id) on delete cascade,
  member_id              uuid        not null references members (id) on delete cascade,
  tier_id                uuid        references tenant_tiers (id) on delete set null,
  stripe_customer_id     text,
  stripe_subscription_id text        not null,
  stripe_status          text        not null,                 -- Stripe status verbatim
  current_period_end     timestamptz,
  trial_end              timestamptz,
  updated_from_event_id  text,                                 -- audit join → stripe_events.event_id
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  -- One row per Stripe subscription within a member (the webhook upsert target).
  constraint member_subscriptions_tenant_member_sub_uq
    unique (tenant_id, member_id, stripe_subscription_id)
);

-- FK-covering + access-path indexes (every FK gets an index; DB principles).
create index member_subscriptions_tenant_member_idx
  on member_subscriptions (tenant_id, member_id, updated_at desc);
create index member_subscriptions_tier_idx
  on member_subscriptions (tenant_id, tier_id);
-- Webhook subscription.updated/deleted arrive keyed by the Stripe subscription id.
create index member_subscriptions_sub_idx
  on member_subscriptions (stripe_subscription_id);

create trigger member_subscriptions_set_updated_at
  before update on member_subscriptions
  for each row execute function public.set_updated_at();

-- Two-layer fence: tenant + member (a member session reads only its OWN subscription
-- rows; contract-05 FR-8). Defense-in-depth behind the app deriving member from token.
select public.enable_tenant_rls('public', 'member_subscriptions');
select public.enable_member_rls('public', 'member_subscriptions', 'member_id');
select public.grant_app_access('public', 'member_subscriptions');

-- ---------------------------------------------------------------------------
-- 3) Resolve the coach-Stripe webhook endpoint → tenant BY ENDPOINT IDENTITY
--    (ADR-008: each coach account has its own per-tenant endpoint). The opaque
--    endpoint token lives in server_config->>'webhookEndpointToken'; index the
--    expression so resolution is a single index probe. Non-partial (no reference to
--    the freshly-added 'stripe' enum value, which would trip the same-transaction
--    rule); the runtime query still filters provider='stripe'.
-- ---------------------------------------------------------------------------
create index tenant_integrations_webhook_endpoint_idx
  on tenant_integrations ((server_config ->> 'webhookEndpointToken'));
