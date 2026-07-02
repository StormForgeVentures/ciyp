# Tasks — PRD-008 Program-Access Store & Instance Provisioning

> Source: prd-008-store-provisioning-index.md + sub-PRDs a–b. 1.0 lands early (PRD-003/004 call its
> session-start gate); 2.0 is the last-mile integrator and doubles as the platform's integration test —
> schedule it in the final build wave before acceptance.

## Relevant Files

- (kept current by build-run)

## Tasks

- [ ] 1.0 Program-access store — checkout to honored entitlement (maps to: 008a FR-1..8 / AC-008-store-provisioning-06..-13, index AC-1/AC-2 → -01/-02)
  - [x] 1.1 Coach-Stripe connector (ADR-008, on the 005c framework): restricted-key vault storage + per-tenant webhook endpoint created on the coach's account; webhook receiver (tenant by endpoint identity, vault-held signing secret, event-id dedupe via `stripe_webhook_events`, handles checkout.completed + subscription.updated/deleted, 2xx-on-replay) + `member_subscriptions` projection rows — verify: 008a AC-2/AC-3 replay test — DONE (wave 2): interim `CoachStripeConnector` port (`apps/api/src/store/connector/`) backed by the `tenant_integrations` AES-256-GCM vault (005c swaps in behind it later). Webhook receiver resolves tenant BY ENDPOINT token, verifies REAL Stripe signature w/ vault secret, dedupes on `stripe_events(tenant_id,event_id)` in one tx (all-or-nothing → failed attempt retries, replay is no-op), projects to a NEW `member_subscriptions` table (migration 20260702130000). NOTE: wave-1 schema shipped `stripe_events` (not `stripe_webhook_events`) — used the real table. `webhook.int.test.ts` AC-2 (completed→active row) + AC-3 (replay: one event row, one sub row, unchanged) green w/ real `generateTestHeaderString` signatures.
  - [x] 1.2 `POST /v1/checkout-session` created on the coach's account through the connector port (SKU resolved from tenant, member id in metadata, no platform fee, 409 if active, 503 if unprovisioned/unconnected) — verify: AC-1 against a dedicated test Stripe account — DONE (wave 2): `checkout.ts` resolves price from connector config (client passes no price id), member id in metadata + client_reference_id, NO application_fee, 409 already-active, 503 unprovisioned/unconnected. `checkout.int.test.ts` green (Stripe API stubbed, DB real). CAVEAT: no live Stripe test key in `.env` (empty) — AC-1's live-account leg (008a AC-1/AC-2 against a real test account) is UNVERIFIED until Tim supplies `STRIPE_SECRET_KEY`; logic + params asserted via the stub.
  - [x] 1.3 Entitlement projection + `GET /v1/entitlement` per contract 05 (tierKey from tenant_tiers, Stripe-mirrored status, features from entitlements_jsonb; tenant+member from token only) — verify: AC-4 schema + AC-7 expiry fixture + AC-8 forged-param RLS test — DONE (wave 2): `entitlement.ts` computes contract-05 status from stripe_status + current_period_end (lapsed→expired, past_due grace per Q-2), tierKey+features from tenant_tiers.entitlements_jsonb, source literal 'stripe'. `entitlement.int.test.ts` green: AC-4 (fixture + real seed member, `Entitlement.parse`), AC-7 (period moved to past → expired; seed expired member → expired), AC-8 (forged tenant_id/member_id query+header ignored — identity from token; + DB-layer RLS proof member fence returns zero for other member/tenant). member_subscriptions carries tenant + RESTRICTIVE member fence.
  - [ ] 1.4 `checkEntitlementAtSessionStart()` library gate wired into thread open (PRD-003a) and voice start (PRD-004b); refusal state distinct from `spend_denied`; no per-turn checks (QA finding if added) — verify: AC-5 (no ai_traces row on refusal) + AC-6 funded-wallet-expired-entitlement test; module AC-1/AC-2
  - [ ] 1.5 External enrollment API (FR-9): `POST /v1/external/entitlements` with per-tenant operator-issued API keys, `source:'api'` grants/revokes, idempotency key, cross-tenant rejection — verify: 008a AC-9 (maps to: AC-008-store-provisioning-22)
- [ ] 2.0 Provisioning runbook + script — a tenant stands up green (maps to: 008b FR-1..8 / AC-008-store-provisioning-14..-21, index AC-3/AC-4/AC-5 → -03/-04/-05)
  - [ ] 2.1 Intake template + zod validation (fail-before-write naming the field; markup placeholder w/ required-review flag per Q-1; integration intent as `pending` rows per Q-3) + runbook doc (prereqs incl. paid Voyage key, per-step recovery, go-live checklist) — verify: 008b AC-3
  - [ ] 2.2 `provision` CLI: six resumable steps against injected TenantContext (ADR-001 promotion-reusable shape), `provisioning_runs` audit table (idempotency: tenant+step), per-step output + final verdict line — verify: AC-1 clean run + AC-5 kill-after-step-3 resume
  - [ ] 2.3 `--dry-run` (zero writes) + step semantics: config field-for-field from intake, ingestion via 005a, Stripe objects + wallet via 008a/007a — verify: AC-2 diff test + AC-4 row-count test
  - [ ] 2.4 Step-5 eval gate (no-eval-no-ship: sabotaged-directive fixture exits non-green, no Instance Config emitted) + step-6 contract 01 verification + new-tenant isolation sweep — verify: AC-6/AC-7/AC-8; module AC-3/AC-4/AC-5 = v1 success criterion 2 rehearsal

## Wave candidates

- 1.0 is independent of PRD-005/006/007 (needs only PRD-001 schema + contracts) — early-wave candidate;
  but 1.4 modifies PRD-003a/004b hook points (`Modified here`) — land 1.4 in the same wave as (or after)
  those surfaces exist, never concurrently with them.
- 2.0 depends on nearly everything (005a, 007a, 008a, 002d, 006b) — final build wave; treat its green run
  as the pre-acceptance integration gate.
- Plan-gate checkbox (008a Q-1): subscription vs one-time SKU — confirm with Tim.
