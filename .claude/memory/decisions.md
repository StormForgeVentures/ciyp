# Project Memory — Decisions

> Episodic memory for THIS project. Agents append; humans prune at wave boundaries.
> Write a decision here whenever an architecture/design choice is made.
> Tag entries `[generalizable]` + `(role: <your-role>)` if the lesson applies beyond this
> project — `cadre distill` extracts tagged entries for the cross-project skill library.

Format per entry:

### <decision title> (role: <role>) [generalizable]?
**Decision:** what was chosen
**Rationale:** why
**Alternatives rejected:** what else was considered and why not
**Date:** YYYY-MM-DD

---

### GUC-based two-layer RLS via installer helpers (role: developer) [generalizable]
**Decision:** For a backend-mediated multi-tenant control plane, enforce tenancy with GUCs (`app.tenant_id`/`app.member_id` read by `current_tenant_id()`/`current_member_id()`), not `auth.uid()`. Tenant fence = PERMISSIVE policy; member fence = RESTRICTIVE policy `(current_member_id() is null or member_col = current_member_id())` so it ANDs with the tenant fence and is a no-op in coach context. Installed via plpgsql helpers `enable_tenant_rls`/`enable_member_rls`/`grant_app_access` so 38 tables stay consistent.
**Rationale:** RESTRICTIVE is required for AND-composition (multiple PERMISSIVE policies OR together and would BROADEN access). Helpers eliminate per-table copy divergence. App connects as non-bypassrls `authenticated`; postgres/service_role bypass for seed/system writes.
**Alternatives rejected:** auth.uid()-based policies (EL-OS's PostgREST model) — wrong for a backend that mediates all member access; hand-written per-table policies — 38x divergence risk.
**Date:** 2026-07-02

### Content-hash embedding fixture cache (role: developer) [generalizable]
**Decision:** Cache real embeddings on disk keyed by `sha256(model|input_type|dim|text)`, commit the fixtures, and only call the provider on a cache miss. Seed/CI re-runs cost zero tokens; a live key is needed only when content changes.
**Rationale:** Real embeddings (never synthetic) + free deterministic re-runs + no provider key required in CI. Deleting a fixture forces a re-embed of exactly that text.
**Date:** 2026-07-02
