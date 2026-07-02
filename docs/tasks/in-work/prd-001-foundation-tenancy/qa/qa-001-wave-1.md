# QA — PRD-001 Foundation & Tenancy · Wave-1 boundary (Track B: schema + seed)

> Reviewer: qa-reviewer · Date: 2026-07-02 · Branch `feature/schema-seed` (worktree `/home/twolf/repos/ciyp-wt-schema-seed`)
> Method: independent re-run of every suite + live DB probing against local Supabase (`127.0.0.1:55322`), not trust of dev-reported results.
> **Verdict: NOT merge-ready as committed.** 2 Must-fix, 1 Should-fix, 3 Notes. Merge-ready after B-M1 (commit the glue) + B-M2 (revoke TRUNCATE) close.

---

## ⚠️ Reviewed state ≠ cited "final" commits

The task cites `feature/schema-seed` as *final at 92f1c3f, 9df52ed*. **It is not.** The worktree carries uncommitted work that is load-bearing for both correctness and CI:

```
 M packages/db/src/content/config.ts                          (adds ENGINE_CONFIG)
 M packages/db/src/seed/index.ts                              (inserts engine_config)
 M packages/db/src/verify/index.ts                            (adds engine_config checks)
 M supabase/migrations/20260702120000_..._helpers_enums.sql   (Kyle→donor comment scrub)
 M supabase/migrations/20260702120200_identity.sql            (Kyle→donor comment scrub)
?? supabase/migrations/20260702121100_app_config_engine_config.sql   (UNTRACKED new migration)
```

All verification below was run against the **working tree** (the dev's evident intended state). Everything passes there. But merging the branch as-committed ships the broken HEAD — see B-M1.

---

## Findings

### B-M1 — Must-fix — Cross-track glue is uncommitted; committed HEAD is broken and fails CI
**What:** The `engine_config` column migration, the seed/verify wiring, and the coach-IP comment scrub exist only in the working tree. If the branch is merged at its committed HEAD (9df52ed):
1. **CI goes red.** The instance-agnostic guard runs `grep -rniE 'kyle|...' supabase/migrations packages/db/src/content` (ci.yml L68). Committed migration comments still contain "Kyle":
   - `20260702120000_platform_foundation_helpers_enums.sql:14` — "Kyle-era archetype …"
   - `20260702120200_identity.sql:7` — "The Kyle `archetype` … enums are DE-ENUMED …"
2. **Wave-2 assembly has nothing to read.** Without migration `..121100`, `app_config.engine_config` does not exist, so the ported engine's per-tenant knobs (`lightnessWideningLeans`, `memberDocCues`) are absent.

**Repro (evidence):**
```
# committed HEAD:
$ git show HEAD:.../20260702120000_..._helpers_enums.sql | grep -n kyle
14:--     Kyle-era archetype / enrollment_tier / method-agent_kind / E.M.P.O.W.E.R.
# CI grep on committed migrations -> exit 1 (fails the guard)
# working tree (with scrub) -> "clean -> CI pass"
```
**Fix (Developer):** Commit the working tree (new migration + seed/verify wiring + comment scrub) to `feature/schema-seed` before merge. Re-confirm the CI grep is clean on the committed blob.

---

### B-M2 — Must-fix — TRUNCATE bypasses append-only on the money ledgers
**What:** FR-7 makes `wallet_ledger` / `usage_ledger` append-only via (a) no UPDATE/DELETE grant to the app role and (b) BEFORE UPDATE/DELETE guard triggers. AC-5 tests only UPDATE/DELETE. **TRUNCATE is blanket-granted to `authenticated` on all 39 public tables, and TRUNCATE does not fire UPDATE/DELETE triggers** — so the app role can wipe the entire money trail.

**Repro (live, proven):**
```
set role authenticated;
truncate wallet_ledger;   --> TRUNCATE TABLE (succeeded)
select count(*) from wallet_ledger;  --> 0
```
Grant inventory: `authenticated` holds INSERT/SELECT/REFERENCES/TRIGGER/**TRUNCATE** on 39 tables; UPDATE/DELETE on only 31 (the 8 append-only tables correctly withheld UPDATE/DELETE — but TRUNCATE slipped through the blanket grant). The append-only guard trigger has no TRUNCATE arm.

**Why it matters:** production money platform; append-only is the integrity guarantee behind wallet balance = SUM(ledger). The spec letter (no UPDATE/DELETE grant) was met while the intent (immutable money trail) is defeated — the "silent pass" failure mode.
**Reachability caveat:** exploitable only where code runs as `authenticated` with arbitrary-SQL access; the runtime may write via `service_role`. Regardless, the control should not depend on "no one runs TRUNCATE."
**Fix (Developer):** `REVOKE TRUNCATE ON wallet_ledger, usage_ledger, stripe_events` (and any other append-only table) `FROM authenticated;` — and prefer scoping the blanket grant to exclude TRUNCATE. **Escalated to security-reviewer** (money/PII rule).

---

### B-S1 — Should-fix — AC-7 (HNSW) not met under the default planner; verify check overstates what it proves
**What:** 001b AC-7 requires the tenant+member-scoped kNN recall query's EXPLAIN to *use the HNSW index, no sequential scan*. Under **default** planner settings at seed volume (31 member_facts rows), the query **seq-scans and does not touch the HNSW index**.

**Evidence — default settings (`EXPLAIN (ANALYZE, BUFFERS)`):**
```
-> Sort (Sort Key: (embedding <=> $1))  Sort Method: quicksort
     -> Seq Scan on member_facts  (Filter: embedding IS NOT NULL AND member_id = …)
Execution Time: 0.521 ms
```
**Evidence — verify's own check** forces `enable_seqscan=off; enable_indexscan=off; enable_bitmapscan=off` (verify/index.ts L147) then asserts `member_facts_embedding_hnsw` appears. Forcing *every* alternative off proves the index is a **usable access path**, not that the planner naturally selects it. The passing check names — "uses the HNSW index", "never seq-scans" — overstate this; a reader would wrongly believe production recall uses HNSW at any volume.

**Judgment:** The index is correctly defined (`hnsw (embedding vector_cosine_ops) m=16 ef_construction=64`) and the seq-scan-at-31-rows is *correct* optimizer behavior that flips to HNSW at scale. So the schema is right, but **AC-7 as literally worded is not satisfied at seed volume** and is **not independently VERIFIED-eligible** under that wording.
**Secondary:** verify's kNN query filters `member_id` only (no `tenant_id`) and runs as superuser (RLS bypassed) — it does not exercise the RLS-scoped production path AC-7 describes.
**Fix (PM/Architect + Developer):** reconcile AC-7 wording to "HNSW index is a usable access path (planner correctly prefers exact scan at seed volume)", OR add a larger fixture so natural selection flips to HNSW; and rename the verify assertions to state they hold *with alternatives forced off*.

---

### B-N1 — Note — Embed model `voyage-3-large` vs §2/ADR-007 `voyage-3.5`
Seed records `model_routing.embed = {voyage, voyage-3-large, output_dimension:1024}`; ai-architecture §2 + ADR-007 name `voyage-3.5`. Both 1024-dim; the checked-in fixtures were generated with `voyage-3-large` and are internally consistent (query-time embedding resolves the same slot). Config-only, overridable at provisioning. Reconcile: ratify `voyage-3-large` in §2/ADR-007 or correct the seed value.

### B-N2 — Note — member_id-bearing admin/billing tables are tenant-fenced only
`entitlements`, `usage_ledger`, `stripe_customers`, `admin_interventions`, `ai_traces` carry `member_id` but have **no** member fence. **Correct per FR-6** (the member fence is only for member-owned tables; admin/observability/billing tables are coach-side, tenant-fence only). Forward note for the template team: when the member PWA API lands, those queries must enforce member scoping *in-query* — RLS will not.

### B-N3 — Note — Append-only is defense-in-depth (grant-withholding + triggers); good
UPDATE/DELETE are both withheld *and* trigger-guarded (belt-and-suspenders). The only gap is TRUNCATE (B-M2). REFERENCES/TRIGGER are also broadly granted — low risk, flag to security-reviewer for completeness.

---

## Independent verification (working-tree state)

- `supabase db reset` → all **12** migrations (11 committed + the uncommitted `..121100`) apply clean, zero drift. **[001b AC-1 ✓]**
- RLS policy sweep: every member-owned table (member_facts, member_recent_state, chat_threads, chat_messages, member_uploads, member_plans, check_ins, streaks, coaching_outputs, …) has a **RESTRICTIVE** member fence `current_member_id() IS NULL OR member_id = current_member_id()` AND a PERMISSIVE tenant fence. Admin tables (ai_traces/prompt_versions/eval_snapshots) tenant-fenced only (FR-6-correct). **[AC-2 ✓, AC-4 ✓]**
- RLS isolation suite: **7/7** passed; shared contracts **18/18**. **[AC-3 ✓]**
- Append-only UPDATE as `authenticated` → `ERROR: permission denied` (but see B-M2 for TRUNCATE). **[AC-5 ✓ for UPDATE/DELETE]**
- `pnpm seed` run 1: 20 items / 227 chunks / **0 Voyage tokens** (content-hash fixtures hit on a *fresh reset* — confirms fixtures are checked in and used). Run 2: identical counts, 0 tokens. **[001c AC-1 ✓]**
- `pnpm seed:verify`: **42/42** checks pass — all 11 slots resolve, tts.voice_id present, engine_config knobs valid + every lean is a seeded archetype key, 3–4 archetypes non-empty, 2 process directives, ≥200 chunks/≥8 items 1024-dim + tsvector, edge-shape members, wallet balance = SUM(ledger), markup 1.1, rollup consistent (priced ≤ cost×1.1), traces linked, no coach-IP in content. **[001c AC-2/AC-3/AC-4/AC-5/AC-6/AC-7 ✓]**
- Coach-IP grep (AC-8 / AC-7): **working tree clean**; **committed HEAD fails** (B-M1).

### Ledger rows independently VERIFIED-eligible (PM updates the ledger)
Conditional on B-M1 being committed (so HEAD == reviewed working tree):
- **001b:** AC-1, AC-2, AC-3, AC-4, AC-5 (UPDATE/DELETE only), AC-8 (working tree).
  - AC-6 (idempotency_key unique) — suite-covered, not independently re-exercised by a duplicate insert; PM/dev confirm.
  - **AC-7 — NOT verified** (B-S1: default plan seq-scans; only index-usability proven).
- **001c:** AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7 — all independently reproduced.

## Merge-readiness (Track B)
Forks from `d62d1d6`. Cross-branch file overlap with Track A = only `.claude/memory/decisions.md` + `failures.md` (append-only logs — trivial merge, keep both appends). No overlap on migrations, ci.yml, root package.json, or apps/api. **Blocker: commit the working tree (B-M1) + revoke TRUNCATE (B-M2) before merge.**
