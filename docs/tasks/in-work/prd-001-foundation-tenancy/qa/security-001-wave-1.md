# Security Audit — Wave 1 (pre-merge)

**Auditor:** security-reviewer (adversarial, assume-breach)
**Date:** 2026-07-02
**Scope:** `feature/schema-seed` (92f1c3f, 9df52ed — 11 migrations + `packages/db` seed/verify/RLS test + CI) · `feature/engine-port` (286d2a8 — pure `@ciyp/agents` + `@ciyp/prompts`)
**Method:** static read + live attack on the running local DB (`supabase_db_ciyp-platform`, pg17) as the non-bypassrls `authenticated`/`anon`/`service_role` roles. All destructive probes run inside rolled-back transactions.

## VERDICT: MERGE-BLOCKING

One **Critical** money-integrity defect (append-only ledgers are TRUNCATE-able platform-wide) and one **High** member-PII fail-open. Both are proven live. Tenant RLS coverage itself is excellent (complete, forced, no gaps) — the failures are in privilege scoping and the member layer's fail direction, not in the policy set.

| Severity | Count | IDs |
|----------|-------|-----|
| Critical | 1 | C1 |
| High | 2 | H1, H2 |
| Medium | 3 | M1, M2, M3 |
| Low | 3 | L1, L2, L3 |
| Passed / positive | — | see §Passed |

---

## 🚨 CRITICAL — fix before merge

### C1 — Append-only money ledgers are TRUNCATE-able (append-only invariant is false)
**Severity:** Critical (money integrity + availability, platform-wide, all tenants)
**Affected:** `supabase/migrations/20260702120000_platform_foundation_helpers_enums.sql` (`reject_mutation`, `grant_app_access`), `20260702121000_platform_economy.sql` (`wallet_ledger`, `usage_ledger`)

The append-only guarantee for `wallet_ledger` / `usage_ledger` rests on two fences: (1) no UPDATE/DELETE grant to `authenticated`, and (2) a `BEFORE UPDATE OR DELETE` trigger (`reject_mutation`) firing for every role. **Neither fence covers `TRUNCATE`, and RLS never applies to `TRUNCATE`.** Meanwhile the roles hold TRUNCATE via Supabase's base default privileges, which the migrations never revoke.

Proven live (rolled back):
```sql
set role authenticated;
select set_config('app.tenant_id','00000000-...-0',true);
truncate wallet_ledger;                 -- => TRUNCATE TABLE (succeeds)
-- superuser view after: 0 rows (was 61) — ALL tenants' ledger wiped
```
- `authenticated` TRUNCATE `wallet_ledger` → **succeeds** (all 61 rows gone, superuser-confirmed).
- `anon` TRUNCATE `wallet_ledger` → **succeeds**.
- `service_role` TRUNCATE → **succeeds** (bypassrls + grant).
- Control: `authenticated` `DELETE` → correctly `permission denied` (no grant). `authenticated`/`service_role` `ALTER TABLE ... DISABLE TRIGGER` → correctly `must be owner` (tables owned by `postgres`). So DELETE and trigger-disable vectors are closed — TRUNCATE is the open one.

Grant evidence (`information_schema.role_table_grants`): `anon`, `authenticated`, `service_role` all carry `TRUNCATE` on `wallet_ledger`, `usage_ledger`, `tenants`, `members`, `tenant_integrations`, `stripe_events`.

**Exploit path:** `balance_credits` is materialized from `wallet_ledger`. The backend (`apps/api`) issues normal traffic **as `authenticated`**. Any SQL-injection or confused-deputy in `apps/api` — or a compromised backend credential — can run `TRUNCATE usage_ledger, wallet_ledger CASCADE` and destroy every coach's prepaid-credit financial history platform-wide in one statement, defeating the stated append-only design and bypassing every RLS tenant fence (TRUNCATE is table-level, tenant-blind). This is a money table; per audit policy a broken money invariant is Critical by construction.

**Remediation (Developer):** in the foundation migration, `REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM anon, authenticated, service_role` (and revoke everything from `anon`, see M2) **and** add a statement-level `BEFORE TRUNCATE` guard to the ledgers (`create trigger ..._truncate_guard before truncate on wallet_ledger for each statement execute function public.reject_mutation()` — extend `reject_mutation` to handle `TG_OP='TRUNCATE'`, which is statement-level). Belt-and-suspenders: keep the ledgers owned by `postgres` (already true) so no app role can re-enable. Re-run the isolation test with an added TRUNCATE-rejection assertion.

---

## HIGH

### H1 — Member-isolation fence fails OPEN when `app.member_id` is unset
**Severity:** High (member PII/journal/chat cross-exposure within a tenant)
**Affected:** `20260702120000_...enums.sql` (`enable_member_rls`) — applied to 16 member tables (members, member_facts, member_recent_state[_history], chat_threads/messages, check_ins, member_uploads, member_plans, coaching_outputs, coach_message*, library_progress, status_history, streaks, chat_thread_memory).

The RESTRICTIVE member fence is `using (current_member_id() IS NULL OR col = current_member_id())`. When `app.member_id` is unset it is a deliberate no-op (coach/admin context sees the whole tenant). The consequence: **a member session that sets `app.tenant_id` but omits `app.member_id` sees every member's rows in the tenant.** The member boundary fails *open* to full-tenant scope — the inverse of the tenant fence, which fails *closed*.

Proven live (rolled back):
```sql
set role authenticated;
select set_config('app.tenant_id', '<tenant>', true);
-- member GUC NOT set:
select count(*) from members;   -- => 5  (ALL members visible)
-- with member GUC set:
select set_config('app.member_id','<member>',true);
select count(*) from members;   -- => 1  (own row only)
```
The branch's own `isolation.test.ts` (lines 177–183) codifies this as intended (`coachFacts` = 2 when member unset). That is correct for coach context but means the member surface (the sibling `ciyp-template` PWA connecting through the backend) has **zero DB-level protection** if the backend ever fails to set `app.member_id` for a member — a single missing `set_config` promotes a member to coach-wide read of all members' journals, chats, uploads, and facts (the most sensitive PII in the system).

**Exploit path:** any code path in `apps/api` that establishes a member session and forgets (or conditionally skips) `set app.member_id` → that member reads all co-tenants' private coaching data. The "defense-in-depth second layer" provides no defense in exactly the failure mode it exists to catch.

**Remediation (Architect + Developer, tracked into the apps/api wave):** make the member layer fail closed for member sessions. Options: (a) carry an explicit `app.context = 'member'|'coach'` GUC and, in member context, require a non-null `current_member_id()` (member policy becomes `col = current_member_id()` with a separate explicit coach-context policy); or (b) enforce at the connection layer that member sessions always set both GUCs, with a session-level assertion. Do not rely on every call site remembering to set the GUC.

### H2 — Tenant isolation is asserted, not bound: no defense against a confused-deputy backend
**Severity:** High (design dependency — becomes Critical if unaddressed in apps/api)
**Affected:** whole GUC model (`current_tenant_id()` + all `*_tenant_isolation` policies).

Tenancy is carried on the connection via `app.tenant_id`, freely settable by the `authenticated` role (proven: `set role authenticated; select set_config('app.tenant_id', <any>, ...)` then read that tenant's rows). Unlike an `auth.uid()`/JWT-bound model, the tenant identity is a plain session variable the backend *asserts* — there is no cryptographic binding. Consequences the schema wave cannot itself close:
- If `apps/api` ever derives `app.tenant_id` from a request parameter/body/header instead of the verified session, that is a **total cross-tenant breach** and RLS will not catch it (the policy faithfully honors whatever tenant the connection claims).
- Reachability: Supabase exposes PostgREST as `anon`/`authenticated`. Direct PostgREST access can't set `app.tenant_id` (no `set_config` RPC exposed) so it fails closed to zero rows today — **but this must be verified**, and no exposed/`SECURITY DEFINER` RPC may ever call `set_config`.

The tenant fence *itself* is correct and fails closed (see Passed). This finding is the load-bearing assumption; flag it so the apps/api wave builds the controls: set `app.tenant_id` **transaction-locally** (`SET LOCAL`) from the verified session only, lock down the `authenticator`/`anon`/`authenticated` PostgREST surface, and add a middleware invariant test that a spoofed tenant param cannot change the GUC.

---

## MEDIUM

### M1 — `usage_ledger.idempotency_key` uniqueness is GLOBAL, not per-tenant
**Severity:** Medium (money-metering correctness + cross-tenant DoS/oracle)
**Affected:** `20260702121000_platform_economy.sql` — `constraint usage_ledger_idempotency_key_uq unique (idempotency_key)`.

Proven: an `idempotency_key` inserted for tenant A blocks a *different* tenant from inserting the same key (`duplicate key value violates unique constraint`). Exactly-once metering should be scoped per tenant. If keys are ever derived from anything guessable (trace id, request id) rather than high-entropy random, tenant A can pre-insert keys to (a) block tenant B's usage from being recorded → coach under-billed / platform revenue loss, or (b) probe existence of keys. Even with random UUIDs it is a latent multi-tenant correctness bug on a money table.
**Fix:** `unique (tenant_id, idempotency_key)`; matching change to the `wallet_ledger.usage_event_id` uniqueness is fine as-is (id is a UUID PK, tenant-implicit).

### M2 — `anon` holds privileges on every control-plane table (least-privilege violation, root of C1's anon vector)
**Severity:** Medium
`anon` carries `REFERENCES, TRIGGER, TRUNCATE` on all audited tables (tenants, members, ledgers, tenant_integrations, stripe_events, …) from Supabase base defaults; the migrations only ever *add* grants, never revoke the baseline. `anon` should have **no** privileges on the CIYP control plane (it is a backend-mediated model; `anon` is not a used principal). Revoke all from `anon` on `schema public` tables in the foundation migration.

### M3 — `stripe_events.event_id` globally unique across distinct coach Stripe accounts
**Severity:** Medium
**Affected:** `stripe_events` — `unique (event_id)`. Per ADR-008 webhooks arrive from **different** coach Stripe accounts (member payments settle on the coach's own account). Stripe event ids are unique *per account*, not globally; a global unique index lets an event from coach B be silently rejected as a replay if coach A processed an identical id. Low collision probability, but replay-protection should be tenant-scoped: `unique (tenant_id, event_id)`.

---

## LOW

### L1 — Whitespace `app.tenant_id` GUC aborts the transaction instead of failing closed gracefully
`current_tenant_id()` = `nullif(current_setting('app.tenant_id',true),'')::uuid`. `nullif(...,'')` catches empty but not whitespace: a `'   '` GUC raises `invalid input syntax for type uuid` and aborts the whole transaction (proven). Absent/empty/random all correctly return 0 rows; whitespace is a hard error. Availability nit; the migration comment overstates the fail-closed coverage. **Fix:** `nullif(btrim(current_setting('app.tenant_id',true)),'')::uuid` (same for `current_member_id`).

### L2 — Tenant-authored regex compiled and run against member text (ReDoS surface)
**Affected (engine-port):** `packages/agents/src/orchestrator/doc-reference.ts`, `linters/*.ts` — `app_config.engine_config.memberDocCues` `{pattern, flags}` are compiled to `RegExp` and run via `cue.re.test(memberMessage)` with no length/complexity bound or timeout. A careless or malicious coach config can author catastrophic-backtracking patterns that stall member request handling (self-scoped DoS). Coach is semi-trusted, hence Low. **Fix:** bound pattern length, allowlist `flags`, and/or run under a timeout / use `re2`.

### L3 — Tenant deletion is blocked once any ledger row exists (offboarding surprise)
`wallet_ledger`/`usage_ledger` FK `tenant_id ... on delete cascade`, but the `reject_mutation` `BEFORE DELETE` guard fires on the cascade rows and raises `restrict_violation`, so `DELETE FROM tenants` fails for any tenant with ledger history. Protective for the ledger, but tenant offboarding must be a designed compensating/archival flow, not a row delete. Informational — document it.

---

## Passed / positive (probed, no finding)

- **RLS coverage is complete and forced.** All 39 public base tables have `relrowsecurity` + `relforcerowsecurity`; every table with a `tenant_id` column has a `*_tenant_isolation` (USING + WITH CHECK) policy; 16 member tables carry the RESTRICTIVE `*_member_isolation` fence. Structural sweep returned zero gaps (55 policies).
- **Tenant fence fails closed.** Absent, empty-string, and random `app.tenant_id` → 0 rows on every fixture table; WITH CHECK blocks cross-tenant writes.
- **No SECURITY DEFINER functions** in `public` (all `prosecdef=false`) — no `search_path`-escalation vectors. The GUC readers are SECURITY INVOKER and only reference `pg_catalog` builtins; policies call them schema-qualified (`public.current_tenant_id()`).
- **`ALTER TABLE ... DISABLE TRIGGER`** rejected for `authenticated` and `service_role` (`must be owner`; tables owned by `postgres`).
- **Secrets:** no keys/tokens committed in either branch; `.env` is gitignored and untracked in both worktrees; `.env.example` ships only the well-known **public** Supabase local demo anon/service keys (correctly labeled `[local default]`, invalid outside `supabase start`).
- **Embedding fixtures** (258 files): union of keys across the set is exactly `{model, embedding}` — no leaked `VOYAGE_API_KEY`, no raw API response, no comment leakage. `voyage` grep hits are the `"model":"voyage-3-large"` field only.
- **`.npmrc`** uses `//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}` — env reference, **no literal token, no leak vector.** pnpm's warning here is benign (env var not present at read time / registry-auth deprecation notice); neither npm nor pnpm persists the resolved token into the lockfile or store. No action needed beyond ensuring the token is only ever supplied via CI secret / shell env.
- **CI** (`ci.yml`): triggers on `pull_request` (**not** `pull_request_target`) → secrets are not exposed to fork PRs; `NODE_AUTH_TOKEN=secrets.GITHUB_TOKEN`; no secret echoing; `DATABASE_URL`/`PGPASSWORD` are throwaway local-service creds for the `pgvector/pgvector:pg17` service. Provision/migrate/seed/verify steps are clean.
- **Seed data:** synthetic — member emails are all `@example.com`, names are placeholders (ada/ben/cleo/dev/edith); no real PII, phone numbers, or live Stripe ids. Instance-agnostic guard (donor-coach grep) is wired in CI.
- **Engine-port pure brain:** no `fetch`/`child_process`/`exec`/`eval`/`new Function` in `@ciyp/agents` or `@ciyp/prompts` (the `.exec()` hits are regex `RegExp.prototype.exec`; `fetch` hits are comments). Seed SQL is fully parameterized (`$1…`, 26 uses); `toVectorLiteral` joins numbers only — no injection surface.

---

## Single worst exploit path
Backend runs as `authenticated`. A SQL-injection (or confused-deputy raw query) anywhere in `apps/api` executes `TRUNCATE usage_ledger, wallet_ledger CASCADE` — not restricted by RLS (TRUNCATE is tenant-blind) and not caught by the `BEFORE UPDATE/DELETE` append-only guard — wiping every coach's prepaid-credit ledger platform-wide and zeroing all materialized balances. The append-only money guarantee is silently false today (C1).
