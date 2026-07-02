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
