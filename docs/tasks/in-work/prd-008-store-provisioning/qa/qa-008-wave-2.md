# QA — PRD-008 Store & Provisioning — Wave 2 (§1.1–1.3 Access Store)

**Reviewer:** qa-reviewer · **Date:** 2026-07-02 · **Scope:** integrated `main` (HEAD 288f91c).
**Verdict:** **MERGE-QUALITY.** Contract-05 fidelity met, webhook projection atomic + idempotent, member RLS fence proven. Carry-forward: the interim HS256 member auth (security) and no live-Stripe leg.

## Re-run evidence

- Store tests pass: `checkout.int` (4), `webhook.int` (5), `entitlement.int` (7), `auth` (7), `vault` (5).
- **Contract-05 fidelity MET (the wave's key question).** `entitlement.ts` computes status from `member_subscriptions.stripe_status` + `current_period_end` — bypassing the too-narrow wave-1 `entitlement_status` enum (`active|expired|revoked`) — and validates via `Entitlement.parse(value)` before returning. `computeStatus` maps all six contract states (active/trialing/past_due/canceled/expired/none). Verified `active` + `expired` through the live endpoint; trialing/past_due/canceled/none via the mapping.
- Migration `20260702130100`: `member_subscriptions` with two-layer RLS (tenant + member fence), `stripe_status` stored **verbatim text** (not a restrictive enum) — correct.

## Findings

### Should-fix (→ Security)

- **The interim HS256 self-minted member session is a shared-secret impersonation liability, now coexisting with the real admin JWKS.** `store/auth.ts#verifyMemberSession` trusts an HS256 token whose `{tid, mid}` become the tenant/member GUCs. Anyone able to call `signMemberSession`, or who obtains `SESSION_JWT_SECRET`, can mint a token for **any** tenant/member → full member impersonation (the RLS fence then scopes to the *forged* member — not a defense). The two mounted endpoints (`GET /v1/entitlement`, `POST /v1/checkout-session`) are reachable and gated **only** by this.
  - **Not yet externally exploitable:** no member-login route issues these tokens in this wave (`signMemberSession` is used by the interim seam + tests). Disclosed as interim (the production path is Supabase Auth, per the module header).
  - **Action:** must be replaced by the Supabase-Auth verification path before any real member traffic. Route to **security-reviewer** — this is the concrete edge of the three-auth-layer debt.

### Note

- **AC-06 (checkout) live-account leg UNVERIFIED.** No `STRIPE_SECRET_KEY` in `.env`; `checkout.ts` logic/params (price from tenant, member id in metadata + client_reference_id, no application fee, 409 active, 503 unprovisioned) are asserted against a **stubbed** Stripe API only. The real test-account leg (008a AC-1/AC-2) is unverified — disclosed by the dev; needs Tim's test key.
- **trialing / past_due / canceled lack endpoint-level integration coverage** — only `computeStatus` unit logic + active/expired exercised through `GET /v1/entitlement`. Minor coverage gap; mapping is simple.
- **Webhook dedupe is genuinely atomic and race-safe** (verified by read): `insert … on conflict (tenant_id,event_id) do nothing` → `select … for update` gate → project → mark processed, all in one `withSystemTx`; a concurrent replay blocks on the row lock and re-reads `processed` → 2xx deduped. 400 on signature failure (Stripe retries), never a partial write.
- **AC-08 forged-param + RLS proven:** body/query `tenant_id`/`member_id` and a spoof `x-tenant-id` header are ignored (identity from token); under a member session, cross-member and cross-tenant reads return 0 rows, own row visible.

### Out of scope (must stay OPEN — not this wave)

- **AC-008-…-10 (AC-5)** and **-11 (AC-6)** — the session-start entitlement gate (`checkEntitlementAtSessionStart`) is **task 1.4, unchecked**, a later wave (it modifies PRD-003a/004b hook points). No chat/voice refusal path exists yet; these cannot be verified now.

## VERIFIED-eligible ledger rows (008)

- **AC-008-…-07** (webhook `checkout.session.completed` → `status:'active'` + tierKey), **-08** (event-id dedupe replay → one row set, unchanged), **-09** (contract-05 zod schema on the entitlement response), **-12** (period-end moved past → `status:'expired'`), **-13** (forged `tenant_id` param ignored + member RLS fence).
- **AC-008-…-06** (checkout) — **PARTIAL**: logic verified via stub; live test-account leg unverified (no Stripe key).
- **AC-008-…-10, -11** — **OUT OF SCOPE** (session-start gate not built; keep OPEN).
