# @ciyp/db — schema seed, seed-verify, and RLS isolation proof

Owns the **data-layer developer loop** for the multi-tenant control plane (PRD-001b/c):
the Luminify default-tenant seed, its verification suite, and the two-layer RLS proof.
Migrations themselves live in `supabase/migrations/` (applied by `supabase db reset`);
this package is everything that runs **after** the schema is in place.

## Commands (run from repo root)

```bash
pnpm db:reset      # supabase db reset — applies all migrations to a clean local DB
pnpm seed          # idempotent seed (deterministic UUIDv5 + ON CONFLICT DO NOTHING)
pnpm seed:verify   # 37-assertion query suite; exits non-zero on any regression
pnpm --filter @ciyp/db test   # RLS isolation proof (fixture tenant B)
```

Canonical loop: `pnpm db:reset && pnpm seed && pnpm seed:verify`.

## How the pieces fit

- **`src/lib/`** — `env` (loads the repo-root `.env`), `pg` (pool), `uuid` (deterministic
  UUIDv5 → idempotency), `chunk` (canon ~500-char / 20% overlap / title-prepended), and
  `voyage` (real `voyage-3-large` document embeddings @ 1024-dim, **cached as content-hash
  fixtures** in `fixtures/embeddings/` so re-runs and CI cost **zero** Voyage tokens).
- **`src/content/`** — the authored seed: `config` (slot map + archetypes + tiers + process
  directives), `corpus` (20-doc AI-adoption/AI-coding coaching library → 227 chunks), and
  `members` (5 demo members carrying deliberate edge shapes + the wallet/usage/trace plan).
  All content is **provisional** placeholder for the seed tenant — Tim authors the real
  archetype/tier copy and body-of-work at provisioning (OQ-2). Zero donor-coach identifiers.
- **`src/seed/index.ts`** — orchestrates the seed as the bypassrls `postgres` role.
- **`src/verify/index.ts`** — `seed-verify`: asserts slots, corpus counts + dims, every edge
  shape, wallet balance == SUM(ledger), pricing invariants, and HNSW recall usability.
- **`test/isolation.test.ts`** — proves the two-layer GUC fence on a real DB as the
  non-bypassrls `authenticated` role.

## RLS model (important)

CIYP is a **backend-mediated control plane**: tenancy rides on the connection via GUCs, not
`auth.uid()`. The backend connects as a non-bypassrls role (`authenticated`) and sets
`app.tenant_id` (+ `app.member_id` in member context) per request. RLS reads them via
`public.current_tenant_id()` / `public.current_member_id()`:

- **Tenant fence** — a PERMISSIVE `_tenant_isolation` policy on every tenant-scoped table
  (`tenant_id = current_tenant_id()`, USING + WITH CHECK).
- **Member fence** — a RESTRICTIVE `_member_isolation` policy on member-owned tables; ANDs
  with the tenant fence, and is a no-op in coach/admin context (member GUC unset).

`service_role` / `postgres` bypass RLS for system + seed writes.

## Fixtures

`fixtures/embeddings/*.json` are committed real embeddings keyed by
`sha256(model|input_type|dim|text)`. Only changed content re-embeds; delete a fixture to
force a re-embed of that text. **A live `VOYAGE_API_KEY` is required only on a cache miss.**
