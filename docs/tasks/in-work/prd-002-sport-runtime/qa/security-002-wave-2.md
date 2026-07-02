# Security Audit — Wave 2 (post-merge, pre-acceptance)

**Auditor:** security-reviewer (adversarial, assume-breach)
**Date:** 2026-07-02
**Scope:** `main` @ `288f91c` — three merged tracks:
- **Sport runtime** (002 §2–4): `apps/api/src/lib/sport/*` (scope-resolver, tenant-context, turn, vector-store, trace-sink), migration `20260702121300` (ai_traces/eval_snapshots RLS).
- **Admin shell** (006a §1.0): `apps/api/src/{auth,http,routes,audit}/*`, migration `20260702130000` (platform_operators, admin_audit_log).
- **Access store** (008a §1.1–1.3): `apps/api/src/store/*`, migration `20260702130100` (member_subscriptions, tenant_integrations stripe provider).

**Method:** static read of every new/changed apps/api source + migration, plus **live adversarial probes** against the running local DB (`supabase_db_ciyp-platform`, pg17) as the non-bypassrls `authenticated` role. All destructive probes in rolled-back transactions. Reproduced, not trusted.

---

## VERDICT: NOT MERGE-BLOCKING (one High + one Medium must-fix-before-store-goes-live)

The central wave-2 mandate — close **H2** (asserted-not-bound GUCs) and the **app.context forgery** carry-forward — is **CLOSED at the apps/api layer for every wave-2 surface a client can actually reach.** Proven live: the admin surface hard-codes `context='coach'` + derives tenant from the verified principal (never the token); the store member surface hard-codes `context='member'`; the sport resolver structurally cannot let a `member` kind yield `context='coach'` (invariant-tested). The DB-layer forgeability that decision #19 accepts by design is **not reachable by any member-authenticated HTTP request** in wave 2.

The one substantive finding is the store's **interim HS256 member-session seam** (H-1): a second, weaker, disjoint auth trust-root mounted live in production on money/PII routes, whose (tenant, member) identity is self-asserted in the token with **no DB membership binding**. It is **not exploitable at rest today** (no `SESSION_JWT_SECRET` set, no token-minting route, secret not committed) — so it does not block the wave merge — but it MUST be gated/removed before the store is exposed in production.

| Severity | Count | IDs |
|----------|-------|-----|
| Critical | 0 | — |
| High | 1 | H-1 |
| Medium | 2 | M-1, M-2 |
| Low | 2 | L-1, L-2 |
| Passed / positive | — | see §Passed (all proven live) |

**H2 + app.context forgery closure:** ✅ **NOW CLOSED** for all wave-2 reachable surfaces (admin + store-member), with two forward-carried caveats that are *not yet live* (H-1 store binding; M-2 sport HTTP route not built).

---

## HIGH

### H-1 — Store interim HS256 member-session is a disjoint, weaker trust-root on money/PII routes; identity is self-asserted, not DB-bound
**Severity:** High (latent auth-bypass class — arbitrary cross-tenant member impersonation on secret compromise)
**Affected:** `apps/api/src/store/auth.ts` (`verifyMemberSession`), `apps/api/src/store/routes.ts` (`/v1/entitlement`, `/v1/checkout-session`), `apps/api/src/store/db.ts` (`withMemberSession`), `apps/api/src/index.ts` (unconditional mount at `/`).

**The gap.** The admin surface binds identity correctly: the Supabase ES256 JWT is JWKS-verified → `auth_user_id` → **DB lookup** in `admins`/`platform_operators` → tenant is read from the DB row, never from the token (`principal.ts`, `scope.ts`). The store surface does the opposite. `verifyMemberSession` verifies an HS256 token against a shared symmetric secret (`SESSION_JWT_SECRET`), then takes `{tid, mid}` **straight out of the token body** and hands them to `withMemberSession`, which sets `app.tenant_id = tid` / `app.member_id = mid` / `app.context = 'member'`. There is:
- no check that `mid` is a real member,
- no check that member `mid` belongs to tenant `tid`,
- no linkage to a verified Supabase auth user.

The token *is* the identity. RLS does not save you here: with the correct `(tid, mid)` pair the tenant fence and member fence both pass, because the connection asserts exactly that identity — this is the wave-1 **H2 "asserted, not bound"** pattern re-appearing at the store layer, weaker than the admin path and on money/PII routes.

**Exploit path (conditional on the secret).** Anyone able to mint a valid HS256 token — i.e. anyone who learns `SESSION_JWT_SECRET`, or a deployer who sets it to a weak/guessable value — forges `{tid: <any tenant>, mid: <any member>}` and:
- `GET /v1/entitlement` → reads that member's subscription tier/status/features (cross-tenant PII), and
- `POST /v1/checkout-session` → opens a Stripe checkout on the coach's account in the victim member's name.

`resolveEntitlement` filters `where ms.member_id = $1` under the forged GUCs, so a correct pair returns the victim's real rows (verified live: a member session scoped to `member_id = m1` reads exactly m1's one subscription row, no more, no less).

**Why it is NOT a live exploit today (and thus not merge-blocking):**
1. `SESSION_JWT_SECRET` is **absent** from `.env` and **absent** from `.env.example` — `verifyMemberSession` throws (`requireEnv`) on any presented token, so the routes 500 rather than authorize. No weak default exists in code (`opts?.secret ?? requireEnv(...)`, no fallback string).
2. No route mints these tokens — `signMemberSession` is called only by tests (grep-confirmed). There is no legitimate issuer in production.
3. The secret is not committed anywhere.

**Remediation (Developer/Architect, before the store is exposed):**
- Do NOT ship the HS256 seam to production. Gate the store member routes behind the real Supabase-Auth member verifier (verify the Supabase JWT → `sub` → `members.auth_user_id` → derive `(tenant_id, member_id)` from the **DB row**, exactly as `principal.ts` does for admins), or feature-flag the `createStoreRoutes` mount off until that lands.
- Add a defense-in-depth DB binding: on the member path, validate `member ∈ tenant` (a `members` lookup, or fold the member fence read so a `(tid, mid)` mismatch returns 0 rows by construction).
- If the HS256 seam must survive for local/interim use, require `SESSION_JWT_SECRET` at **boot** (see M-1) with a documented high-entropy value, and confine the mount to non-production.

---

## MEDIUM

### M-1 — Store/vault secrets are not validated at boot and are undocumented (production-mode "fail loud at boot" violated)
**Severity:** Medium
**Affected:** `apps/api/src/lib/env.ts` (`validateEnv`), `apps/api/src/store/env.ts`, `.env.example`.

`validateEnv()` checks only `DATABASE_URL`/`SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY`. `SESSION_JWT_SECRET` (store auth) and `CONNECTOR_VAULT_KEY` (AES-256-GCM DEK for coach Stripe keys) are read lazily via `store/env.ts requireEnv` at **request time**, and neither appears in `.env.example`. Consequences: (a) the app boots "healthy" but the store/vault fail on first real request — the production-mode rule is fail-loud-at-boot; (b) an undocumented DEK/secret invites an operator to invent a weak value, which directly arms H-1 and weakens the connector vault. **Fix:** add both to `validateEnv()` (and to `.env.example` with generation guidance — `openssl rand -base64 32` for the DEK), fail at boot, and reject short/low-entropy values.

### M-2 — Sport internal-turn context enforcement is unit-correct but has no verified-principal HTTP binding yet
**Severity:** Medium (forward-carried; not a live vuln in wave 2)
**Affected:** `apps/api/src/lib/sport/scope-resolver.ts`, `turn.ts`, `request-context.ts`.

`scopeFromClaims` derives `context` solely from `claims.kind` (`admin → coach`, `member → member`) and is invariant-tested against a hostile `context:'coach'` claim (`scope-resolver.test.ts`). But `runInternalTurn` is **transport-agnostic and not HTTP-reachable in wave 2** (PRD-003 owns the route; grep confirms no non-test caller). Critically, a stock Supabase JWT carries **neither `kind` nor `tenant_id`** — so whoever builds the PRD-003/voice route MUST synthesize `session.claims` server-side from the resolved principal (`admins`/`members` lookup), never pass the raw token claims or any body value. If that route ever reads `kind`/`tenant_id` from client-supplied JSON, H2 reopens at full severity. **Action:** carry this into the PRD-003 wave as a build constraint + add an end-to-end middleware invariant test (member JWT can never produce `context='coach'`) at the point the route lands.

---

## LOW

### L-1 — Webhook projection writes `member_subscriptions` under bypassrls with an unvalidated member↔tenant pairing
**Severity:** Low (integrity/defense-in-depth; not a cross-tenant grant)
**Affected:** `apps/api/src/store/webhook.ts` (`projectCheckoutCompleted`/`projectSubscriptionChange`), migration `20260702130100`.

Projection runs in `withSystemTx` (RLS bypassed) and takes `member_id` from Stripe event metadata. The FK `member_id → members(id)` does not constrain `members.tenant_id = <resolved tenant>`, so a coach (who controls their own Stripe account + webhook secret) can emit a signed event whose metadata names a member from **another** tenant, creating a row `(tenant_id = A, member_id = <B's member>)`. Impact is contained: that orphan row is invisible to everyone via RLS (the tenant fence `tenant_id = current_tenant_id()` excludes it for B's member, and the member fence excludes it for A's members), so it is not a cross-tenant entitlement grant — only data pollution. Granting free access to one's *own* members is already within a coach's authority. **Fix (defense-in-depth):** a composite FK `(tenant_id, member_id) → members(tenant_id, id)`, or an explicit `members` tenant-match check before the upsert.

### L-2 — Webhook endpoint token is the sole tenant-routing identifier in the URL
**Severity:** Low
**Affected:** `apps/api/src/store/connector/interim.ts` (`resolveTenantByEndpoint`), provisioning (008b) owns token generation.

`POST /webhooks/stripe/:endpointToken` resolves the tenant purely by the opaque token. A low-entropy or enumerable token would leak the endpoint→tenant mapping, though writes still require a valid Stripe signature against that tenant's vault secret (so no forged write). **Fix:** ensure the endpoint token is high-entropy random (≥128 bits) at provisioning; document rotation.

---

## Passed / positive (probed, no finding — proven live unless noted)

- **H2/context-forgery CLOSED on the admin surface.** `withTenantTx` (lib/pool.ts) hard-codes `context='coach'` + `member_id=''` and takes only `scope.tenantId` (from the verified principal / gated `X-Acting-Tenant`). Live: GUCs resolve to `role=authenticated, ctx=coach, mid=''`, scoped to the given tenant, with no leak to the next pooled connection (`scope.test.ts`, reproduced).
- **Member principal cannot reach a coach context.** A coaching member lives in `members`, not `admins`/`platform_operators`; `requireSession` → 403 (`middleware.ts`). The store member path hard-codes `context='member'` (`db.ts`). No wave-2 HTTP route lets a member assert `context='coach'`.
- **Scope-resolver invariant test present + passing** — `scope-resolver.test.ts`: "a member principal can NEVER resolve to context=coach (H2 spoof)" ignores hostile `context`/`role` claims; body-tenant is structurally impossible (no body parameter).
- **ai_traces split RLS (migration 121300) — proven live.** As `authenticated` member context: `ai_traces = 0`, `eval_snapshots = 0`. As coach context: `ai_traces = 58`, `eval_snapshots = 8`. Foreign-tenant `INSERT` into `ai_traces` → `new row violates row-level security policy` (with_check = `tenant_id = current_tenant_id()`). Own-tenant member-context `INSERT` succeeds (member turns write their own traces). Sensitive prompt/model-IO in traces is coach-only; a member cannot read them.
- **member_subscriptions member-fenced — proven live.** Member session scoped to `m1` reads exactly m1's one row (tenant + member two-layer fence).
- **platform_operators unreadable by the app role — proven live.** `select … from platform_operators` as `authenticated` → `permission denied` (RLS forced, no policy, no grant). Only the bypassrls system role reads it during identity resolution.
- **admin_audit_log immutable under the app role — proven live.** As `authenticated`: `INSERT` ok; `UPDATE` / `DELETE` / `TRUNCATE` all `permission denied` (grant-level), backed by `reject_mutation` UPDATE/TRUNCATE triggers. Targeted DELETE reserved to `postgres` for lifecycle maintenance (documented).
- **Superadmin elevation strictly server-gated.** `X-Acting-Tenant` is honored only when `principal.isSuperadmin` (a server-side `platform_operators` lookup, boolean) is true; the header is UUID-validated and, for non-superadmins, ignored in favour of the actor's own membership (`scope.ts`). No btrim/case/whitespace bypass matters — the gate is a boolean, not a string compare — and `requireSuperadmin` re-checks independently.
- **No cross-verifier token replay.** Admin verifier = jose `jwtVerify` with `algorithms:['ES256','RS256']` against Supabase JWKS; store verifier = HS256 against `SESSION_JWT_SECRET`. An ES256 admin token is rejected by the store (alg pin `HS256`); an HS256 store token is rejected by the admin verifier (JWKS asymmetric only). Isolation is by algorithm + key.
- **Stripe webhook cross-tenant safe.** Tenant resolved by endpoint identity FIRST, then signature verified with **that** tenant's vault-held secret; dedupe is `(tenant_id, event_id)` with `SELECT … FOR UPDATE`. Forging tenant B's event requires B's endpoint token AND B's webhook secret. Alg/`none` confusion N/A (Stripe's own HMAC construct).
- **Connector vault crypto floor.** AES-256-GCM, 12-byte random IV per encrypt, 16-byte auth tag, DEK length-checked to 32 bytes; `decryptSecret` throws on tamper/wrong-key (GCM auth). Restricted key + webhook secret never stored plaintext (`vault.ts`, `interim.ts`).
- **No secrets committed / no client leak.** `.env` untracked (gitignored); `.env.example` ships only the well-known public Supabase local-dev demo keys (labeled `[local default]`). No `sk_/rk_/whsec_/BEGIN/eyJ…`-shaped literals in `apps/api/src`. `apps/web` consumes only `VITE_` vars (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_BASE_URL`) — no service-role key, no `SESSION_JWT_SECRET`, no `STRIPE_SECRET` in the browser bundle.
- **`no-jwt-in-resolved-scope` eslint rule wired as `error`** (`apps/api/eslint.config.mjs`), enforcing the ScalingCFO discipline that credentials never enter the traced scope; credentials ride the `request-context` ALS out-of-band.
- **GUC readers fail closed** (`current_tenant_id/member_id/context` = `nullif(btrim(current_setting(...,true)),'')`) — whitespace/empty/absent → unset → 0 rows, transaction survives (wave-1 L1 close still holds).

---

## Single worst exploit path
`SESSION_JWT_SECRET` is set to a weak/shared value in production (or leaks). An attacker mints an HS256 token `{tid: <victim tenant>, mid: <victim member>}`, presents it to `GET /v1/entitlement`, and reads any member's subscription tier/status across any tenant — and opens Stripe checkouts in the victim's name — because the store derives tenant+member straight from the self-asserted token with no DB membership binding (H-1). Gated today only by the secret being unset and no minting route existing; must be closed before the store is exposed.

---

## H2 / context-forgery closure statement (explicit)
**NOW CLOSED** at the apps/api layer for every wave-2 surface reachable by a client:
- Admin (`/admin/*`): tenant from verified principal, `context='coach'` hard-coded, member principals 403'd — proven live.
- Store member (`/v1/*`): `context='member'` hard-coded — a member can never obtain coach context.
- Sport resolver: `member` kind structurally cannot yield `context='coach'` — invariant-tested.

The DB-layer GUC forgeability that decision #19 accepts by design remains (an actor with raw `authenticated` SQL can still `set_config('app.context','coach')`), but **no wave-2 HTTP route exposes that to a member principal.** Two closure caveats are carried forward and are **not yet live**: the store's weaker HS256 identity binding (H-1, must-fix-before-store-goes-live) and the not-yet-built sport HTTP route that must inject `kind`/`tenant_id` from the verified principal (M-2).
