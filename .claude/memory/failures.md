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
