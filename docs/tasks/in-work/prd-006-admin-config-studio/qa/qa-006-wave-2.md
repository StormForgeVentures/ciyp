# QA — PRD-006 Admin & Config Studio — Wave 2 (§1.0 Admin Shell)

**Reviewer:** qa-reviewer · **Date:** 2026-07-02 · **Scope:** integrated `main` (HEAD 288f91c).
**Verdict:** API/integration layer is **MERGE-QUALITY** (17 adversarial tests green against real GoTrue + DB). The **browser surface is NEEDS-FIXES**: apps/web does not render in the delivered environment, and the only browser-level verification is neither runnable-green out-of-the-box nor in the CI gate.

## Re-run evidence

- Admin suite: **17 integration tests pass** (`apps/api/test/admin.test.ts`) against **real Supabase Auth (GoTrue ES256/JWKS)** + real DB — the production verification path. Adversarial coverage of AC-1..AC-6, audit immutability, cross-tenant isolation.
- Audit writes are **in the same transaction** as each mutation (`audit/log.ts`, `routes/tenants.ts`, `routes/team.ts`) — atomic, no orphaned logs.
- Role/superadmin/suspended gates enforced at the API independently of nav (`http/middleware.ts`).

## Findings

### Major

- **apps/web does not render in the delivered environment.** The working root `.env` is **missing all three `VITE_` vars** that `.env.example` documents (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_BASE_URL` — .env.example lines 34-36). `apps/web/src/lib/supabase.ts` **throws on module load** when they're absent → the React app crashes on mount → blank page.
  - **Repro:** `pnpm --filter @ciyp/web e2e` → **4/4 fail**, including the pure-static unauthenticated sign-in test (`getByRole('button',{name:'Sign in'})` not found; blank page screenshot).
  - **Isolation proof:** exporting the three VITE_ vars (derived from the existing `SUPABASE_URL`/`SUPABASE_ANON_KEY`) → the **unauthenticated sign-in test PASSES** (273ms). So the blank page is purely the missing env; app code + `.env.example` are correct.
  - **Owner:** Developer/DevOps (config). **Fix:** add the three VITE_ vars to the working `.env` (values already in `.env.example`). Not an app-code defect — a delivered-env provisioning gap that nonetheless means the console can't be run or demoed as-shipped.

### Should-fix

- **The admin browser slice is not runnable-green and is excluded from the CI gate.** Three compounding gaps:
  1. `pnpm test` excludes `e2e/**` (`vitest ... exclude e2e/**`), so the browser app has **zero coverage** in the standard gate.
  2. The e2e webServer starts the API with `tsx watch --env-file-if-exists=.env` **relative to `apps/api`** — the root `.env` is never loaded, so the API boots without DB creds.
  3. The authenticated e2e flows assume GoTrue admin identities pre-exist; the unit suite seeds them (`seedAdminIdentities()`) but the e2e has no equivalent step.
  - **Evidence:** even after supplying VITE_ vars, e2e tests 2-4 (sign-in → dashboard) fail at the "Luminify" dashboard heading. Attributed to (2)+(3) harness wiring, **not a proven app defect** — the identical auth+dashboard path passes in the 17 unit tests. **Fix:** have the e2e webServer load the root env + run the identity seed, and add e2e to a CI lane.
- **The entire admin unit suite self-skips when GoTrue is unreachable** (`describe.skipIf(!AUTH_UP)`). Per the test's own comment, CI runs bare Postgres with no auth server → **the admin security spine (auth fence, role gates, cross-tenant isolation, audit) has ZERO automated coverage in CI.** The most security-sensitive surface of the wave has no regression gate. Also route to security-reviewer.

### Note

- **Spec/ledger vs shipped-schema terminology drift.** PRD-006a + ledger say tenant status `active|suspended` and role `owner|member`; the frozen wave-1 schema (`migration 20260702120000`) ships `tenant_status = ('active','paused')` and `admin_role = ('owner','team')`. The **code correctly matches the DB** (`paused`/`team`, e.g. `principal.ts`, `routes/tenants.ts`). No functional defect — flag so the ledger reviewer isn't tripped by "suspended"/"member" wording vs the implemented `paused`/`team` (e.g. AC-11 text).

## VERIFIED-eligible ledger rows (006) — API/integration layer

- **AC-006-…-07** (AC-1 cross-tenant isolation — forged `X-Acting-Tenant` ignored, own-tenant scope), **-08** (AC-2 role gates — API 403 + authorizedSections absence), **-09** (AC-3 create tenant → active + default app_config), **-10** (AC-4 superadmin-switched mutation audited: operator id + target tenant), **-11** (AC-5 suspended tenant → auth ok, writes 403), **-12** (AC-6 unauthenticated → 401).

**Caveat on the UI legs:** AC-2 ("absent from **nav**") and AC-6 ("**redirect** to sign-in") are proven at the API layer + one passing unauthenticated e2e. The **authenticated nav-gating UI is not independently greenable** in the delivered env (see Major + Should). Recommend marking the API-side VERIFIED and holding the browser-UI leg until the e2e is runnable in a clean checkout.
