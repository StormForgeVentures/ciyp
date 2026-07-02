# Project Memory — Failures

> What broke, why, and the fix. The most valuable file in project memory — failures are where
> skills come from. Write here when: a test fails and gets fixed, a human corrects you, or your
> 3-attempt loop exhausts and you escalate.
> Tag `[generalizable]` + `(role: <your-role>)` when the root cause isn't project-specific.

Format per entry:

### <what failed> (role: <role>) [generalizable]?
**Symptom:** what was observed
**Root cause:** the actual why (not the first guess)
**Fix:** what resolved it
**Lesson:** the reusable insight, one sentence
**Date:** YYYY-MM-DD

---

### Figma component variants collapsed to 10px and clipped their content (role: designer) [generalizable]
**Symptom:** Input/Card/Nav/State component variants rendered as thin overlapping strips — label/field/helper stacked on top of each other, values hidden.
**Root cause:** I called `node.resize(w, 10)` AFTER setting `primaryAxisSizingMode='AUTO'`. `resize()` resets BOTH sizing modes to FIXED (documented gotcha), so the hug axis became FIXED at height 10 and clipped children. Components that never called resize (Button/Badge/Tabs — pure HUG) were unaffected.
**Fix:** Re-assert the hug axis (`primaryAxisSizingMode='AUTO'` for vertical, `counterAxisSizingMode='AUTO'` for horizontal-hug) AFTER resize + after appending children.
**Lesson:** To fix a component's width but hug its height, set `resize()` FIRST then the sizing mode — or re-assert the hug axis last; resize() silently reverts sizing modes to FIXED.
**Date:** 2026-07-02

---
## [generalizable] (role: security-reviewer) Append-only + Supabase-default-grant gotchas (wave-1 audit, 2026-07-02)
**Context:** Postgres "append-only" ledger enforced by (a) no UPDATE/DELETE grant + (b) BEFORE UPDATE OR DELETE trigger.
**Lesson 1 — TRUNCATE bypasses both.** RLS never applies to TRUNCATE and a row-level BEFORE UPDATE/DELETE trigger never fires on it. Append-only is a lie unless you ALSO `REVOKE TRUNCATE` from every non-owner role AND add a `BEFORE TRUNCATE ... FOR EACH STATEMENT` guard. Always test `truncate <ledger>` as the app role (rolled back).
**Lesson 2 — Supabase leaks base grants to anon/authenticated/service_role.** Migrations that only `GRANT` (never `REVOKE`) leave `anon`/`service_role` holding `REFERENCES,TRIGGER,TRUNCATE` on every table from Supabase's default privileges. Always dump `information_schema.role_table_grants` for anon on sensitive tables — don't trust the migration's grant statements.
**Lesson 3 — RESTRICTIVE member fence `(current_member_id() IS NULL OR col=...)` fails OPEN.** When the member GUC is unset the clause is a no-op → full-tenant visibility. The tenant fence (`col = current_tenant_id()`) fails CLOSED. A "defense-in-depth" fence that fails open provides no defense in its own failure mode. Verify the fail DIRECTION of every isolation layer, not just that it works when set.
**Lesson 4 — GUC-based tenancy (`app.tenant_id`) is asserted, not JWT-bound.** Any principal that can run SQL as the app role sets it freely; isolation collapses to "backend never sets the wrong tenant." No RLS defense against a confused-deputy backend. Distinct from auth.uid() models.
**Lesson 5 — global unique on `idempotency_key`/`event_id` is a cross-tenant collision/DoS.** Scope replay/idempotency uniqueness to `(tenant_id, key)` in multi-tenant money tables.

---

### Cited "final" commits ≠ the worktree being reviewed (role: qa-reviewer) [generalizable]
**Symptom:** Task pinned Track B as "final at 92f1c3f, 9df52ed", but `git status` showed modified files + an untracked migration carrying the load-bearing cross-track glue (an `engine_config` column, seed/verify wiring, and a `Kyle→donor` comment scrub). Everything passed in the working tree; the *committed HEAD* would fail CI (coach-IP grep matches "Kyle" in migration comments) and ship an inert config the next wave can't read.
**Root cause:** Devs verify against their dirty worktree and report green; the commit they cite predates the fixes they made after.
**Fix:** Always `git status -s` + `git diff` each worktree FIRST, and run the CI-critical checks against the *committed blob* (`git show HEAD:path | grep …`), not just the working tree. Report the commit-gap as a Must-fix.
**Lesson:** "Tests pass" is scoped to the tree they ran in — a green worktree can hide a red HEAD; verify what actually merges.
**Date:** 2026-07-02

---

### pgvector HNSW not chosen for kNN at seed scale (role: developer) [generalizable]
**Symptom:** EXPLAIN on a tenant+member kNN recall used a partial btree / bitmap scan (or seq scan on a pure order-by), never the HNSW index — failing a literal "plan uses HNSW" check.
**Root cause:** At small volume (tens–hundreds of rows) exact scan over a selective filtered set is genuinely cheaper than an HNSW graph traversal, so the planner correctly avoids HNSW. Also a subquery query-vector defeats the ANN order key — production passes a constant/parameter vector.
**Fix:** Prove HNSW is valid + selected as the *vector access path* by forcing off the small-table alternatives (`set enable_seqscan/indexscan/bitmapscan = off`) with a CONSTANT query vector; the plan then shows `Index Scan using <table>_embedding_hnsw`. Document that the optimizer selects HNSW naturally at production scale (architecture flip triggers). "No sequential scan" is still satisfied at seed scale via btree index scans.
**Lesson:** An HNSW-usage assertion must account for cost — force off alternatives to prove usability rather than expecting the planner to pick it on a tiny table.
**Date:** 2026-07-02

### docker exec heredoc silently produced no output (role: developer) [generalizable]
**Symptom:** `docker exec supabase_db_... psql ... <<'SQL'` returned nothing (selects didn't print).
**Root cause:** Missing `-i` — without it docker doesn't attach stdin, so the heredoc never reaches psql.
**Fix:** `docker exec -i <container> psql ...` for any stdin-fed heredoc/pipe.
**Lesson:** Always `-i` on `docker exec` when feeding SQL/stdin.
**Date:** 2026-07-02

---

### Forced-off-alternatives EXPLAIN proves index USABILITY, not selection (role: qa-reviewer) [generalizable]
**Symptom:** A seed-verify check asserted "kNN recall uses the HNSW index / never seq-scans" and passed — but it first ran `set enable_seqscan/indexscan/bitmapscan = off`. Under DEFAULT planner settings the query seq-scans and never touches the index (correct optimizer behavior at ~31 rows).
**Root cause:** Forcing every alternative off leaves the index as the only legal plan → proves the index CAN serve the query, says nothing about whether the planner naturally picks it. The assertion name overstates the guarantee.
**Fix:** Always run `EXPLAIN (ANALYZE, BUFFERS)` under default settings too. For a "no seq scan" AC at tiny seed volume, either reword the AC to "index is a usable access path" or add a fixture large enough that natural selection flips.
**Lesson:** A vector-index EXPLAIN check that disables seqscan is a usability probe, not a "the plan uses HNSW" proof — and never VERIFIED-eligible for a literal "no sequential scan" AC.
**Date:** 2026-07-02

---

## 2026-07-02 — vitest vi.fn + generic function type: let contextual typing infer [generalizable] (role: developer)
When a vi.fn mock must satisfy a GENERIC function-type property (e.g. `traceAICall: <T>(opts: TraceAICallOpts<T>) => Promise<T>`), do NOT annotate the mock's parameter/generics explicitly — `vi.fn(async <T>(o: TraceAICallOpts<T>) => ...)` collapses to `Mock<(o: TraceAICallOpts<unknown>) => Promise<unknown>>` which is NOT assignable to the generic type (TS2322 "unknown not assignable to T"). Instead write `vi.fn(async (o) => ...)` inside a literal that is contextually typed by the target (e.g. `const s: AgentSubstrate = { traceAICall: vi.fn(async (o) => ...) }` or a function with return type `AgentSubstrate`) — contextual typing re-infers the generic correctly. If the mock is a standalone const you still need for `.toHaveBeenCalled` assertions, type its param via `Parameters<Fn>[0]` and cast at the assignment site (`x as unknown as Fn`); the runtime object stays the mock so `expect(x)` still works. Also: `noUncheckedIndexedAccess` + a no-arg `vi.fn(() => ...)` makes `mock.calls[0][0]` a TS2493 (tuple length 0) — give the mock a typed param so `calls[0]` carries the arg.

---

### [generalizable] (role: developer) Supabase default privileges silently grant TRUNCATE to app roles
**When:** Any append-only / money table on Supabase where migrations only GRANT.
**Symptom:** `authenticated`/`anon`/`service_role` hold TRUNCATE (+REFERENCES/TRIGGER) on
every table your migrations create — from `postgres`'s default ACL on schema public
(`anon=Dxtm/postgres`). TRUNCATE is RLS-exempt AND skips BEFORE UPDATE/DELETE guards, so
append-only + no-UPDATE/DELETE-grant is NOT enough. Verify with `pg_default_acl` +
`information_schema.role_table_grants`, not by reading the migration.
**Fix:** REVOKE truncate/references/trigger on all tables from app roles + `alter default
privileges for role postgres ... revoke` (future tables) + a BEFORE TRUNCATE FOR EACH
STATEMENT guard trigger (reject_mutation works as-is; TG_OP/TG_TABLE_NAME are populated).
**Date:** 2026-07-02

### [generalizable] (role: developer) RESTRICTIVE member fence with `col IS NULL OR ...` fails OPEN
**When:** Two-layer RLS where a member GUC scopes a second fence.
**Symptom:** `using (current_member_id() IS NULL OR col = current_member_id())` gives
full-tenant visibility when the member GUC is unset — a member session that forgets
`set app.member_id` reads the whole tenant. The "defense-in-depth" layer provides zero
defense in exactly its failure mode.
**Fix:** Fail closed via an explicit context GUC: `current_context()='coach' OR
(current_member_id() IS NOT NULL AND col = current_member_id())`. Coach-wide is an opt-in;
unset context is member-scoped (0 rows). Update tests that codified the fail-open no-op.
**Date:** 2026-07-02
