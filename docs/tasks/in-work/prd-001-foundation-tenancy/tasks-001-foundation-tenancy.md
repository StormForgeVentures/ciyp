# Tasks — PRD-001 Platform Foundation & Tenancy

> Source: prd-001-foundation-tenancy-index.md + sub-PRDs a–c. Wave-0 material: 1.0–2.0 gate ALL parallel
> work (contract freeze); 3.0–4.0 gate every feature PRD. No UI parents in this module (developer-facing).

## Relevant Files

- Root: `package.json` · `pnpm-workspace.yaml` · `turbo.json` · `tsconfig.base.json` · `eslint.config.mjs` · `scripts/dependency-lint.mjs` · `.github/workflows/{ci,publish}.yml`
- `packages/shared/`: `src/contracts/{instance-config,coaching-api,usage-event,spend-authorization,entitlement,index}.ts` · `src/{enums,guards,index}.ts` · `test/contracts.test.ts` (15 tests) + `test/fixtures/contracts.ts`
- `packages/ui-tokens/src/index.ts` · `packages/agents/src/index.ts` (scaffold — PRD-002a fills) · `packages/prompts/src/index.ts` (scaffold)
- `apps/api/src/index.ts` + `test/health.test.ts` · `apps/web/{index.html,src/main.tsx,vite.config.ts}` · `apps/voice/{Dockerfile,requirements*.txt,pytest.ini,pipecat_app/,tests/}`

## Tasks

- [x] 1.0 Monorepo scaffold with purity gates — workspace builds green end-to-end (maps to: 001a FR-1..4,9 / AC-001-foundation-tenancy-01, -05..-07)
  - [x] 1.1 pnpm + turbo workspace, tsconfig.base, eslint/prettier, Node ≥ 22 — verified 2026-07-02: `pnpm install && pnpm -r typecheck && pnpm -r build` exit 0
  - [x] 1.2 App scaffolds boot empty — verified: `GET /health` live via `pnpm dev` returned `{ok:true, scaffold:{partsUnionLoaded:true}}`; web `vite build` green; voice pytest runs in CI (NOTE: local host lacks python3-pip/venv — ask Tim: `! sudo apt install python3-pip python3.12-venv` to verify locally)
  - [x] 1.3 Dependency-lint gates (`scripts/dependency-lint.mjs`, wired into `pnpm test`) — verified: clean pass; planted `left-pad` in agents deps → exit 1 with purity message; a literal earendil-pattern occurrence was caught live during the build
  - [x] 1.4 CI entrypoint — verified: root `pnpm ci` script + `.github/workflows/ci.yml` (install → typecheck → build → test incl. purity gates + voice pytest)
- [x] 2.0 Contract freeze — six contracts as zod in `@stormforgeventures/ciyp-shared`, published (maps to: 001a FR-5..8 / AC-001-foundation-tenancy-02, -08..-10)
  - [x] 2.1 Zod schemas + inferred types for contracts 01–06, incl. closed `parts` union — verified: `pnpm --filter @stormforgeventures/ciyp-shared typecheck` standalone green; package deps = zod only
  - [x] 2.2 Contract fixture suite (valid+invalid per contract, unknown `parts.kind` rejected, contract-06 export-surface manifest test) — verified: 15/15 tests green
  - [x] 2.3 Private-registry publish (GitHub Packages, `shared-v*` tag cadence) — verified 2026-07-02: repo home = `StormForgeVentures/ciyp`; packages renamed to `@stormforgeventures/ciyp-{shared,ui-tokens}` (GitHub Packages requires scope = repo owner); tag `shared-v0.1.0` → publish run 28606406512 green; clean-external-project install proven in CI (`verify-install.yml` run 28607010885 — `REGISTRY-INSTALL OK`, root + `./contracts` dist exports resolve).
- [x] 3.0 Multi-tenant schema, two-layer RLS, index plan (maps to: 001b FR-1..9 / AC-001-foundation-tenancy-03, -11..-18)
  - [x] 3.1 Root + config migrations: `tenants`, per-tenant `app_config` (slot map per ai-architecture §2), de-enum tables (`tenant_archetypes`, `tenant_tiers`, `coaching_process_definitions` w/ `source` seam), platform-mechanic enums only — verified 2026-07-02: `20260702120000` (helpers/enums, GUC RLS installers) + `20260702120100` apply clean; coach-IP grep over migrations = 0; archetype/tier/method DE-ENUMED to config rows/text
  - [x] 3.2 Domain-table port migrations (EL-OS §4.3 shapes + `tenant_id` + RLS in same file): identity, cadence, status, chat (`parts jsonb`), memory (`member_facts` vector(1024)), `ai_traces` + cost cols, `prompt_versions`, `eval_snapshots`, library (vector + tsvector + `source` provenance), uploads, admin/notifications, planning, coach messaging — verified: migrations `120200`–`120900`; `pg_policies` sweep = 38/38 tenant-scoped tables carry tenant policy with BOTH USING + WITH CHECK; 16 RESTRICTIVE member fences
  - [x] 3.3 Platform-economy migrations: `wallets`, `wallet_ledger` + `usage_ledger` (append-only grants + guard trigger, unique `idempotency_key`, `priced_cost_micros`/`pricebook_version`), `stripe_events`/`stripe_customers`, `entitlements`, `tenant_integrations` (encrypted token bytea) — verified `20260702121000`: `reject_mutation()` trigger rejects UPDATE+DELETE on both ledgers (restrict_violation); duplicate `idempotency_key` rejected by unique constraint; append-only role grant = SELECT+INSERT only
  - [x] 3.4 Index plan in-migration: `(tenant_id, hot-predicate)` composites, HNSW ×2, GIN tsvector, unique idempotency/stripe indexes — verified: HNSW on `member_facts.embedding` + `library_chunks.embedding`, GIN on `library_chunks.text_search`, unique on `usage_ledger.idempotency_key` + `stripe_events.event_id`; kNN EXPLAIN (no seq-scan) proven on seeded data at 4.x
  - [x] 3.5 Isolation proof: fixture tenant B in test suite; cross-tenant sweep + member-fence tests — verified `packages/db/test/isolation.test.ts` (7/7 green): structural sweep (all 38 tenant tables have USING+WITH CHECK), row-level cross-tenant proof on a 19-table connected fixture graph (tenant-A GUC → zero B rows both directions), member fence (member-1 sees only own rows; coach context sees both; independent), unset-GUC fail-closed, append-only reject under RLS role
- [x] 4.0 Luminify seed + seed-verify wired to CI (maps to: 001c FR-1..10 / AC-001-foundation-tenancy-04, -19..-25)
  - [x] 4.1 Idempotent `pnpm seed`: tenant + full slot config (real values incl. `tts.voice_id`), 3–4 archetypes (non-empty `prompt_fragment`) + 2–3 tiers (OQ-2 placeholders), 2 process directives — verified: `@ciyp/db` seed via deterministic UUIDv5 + ON CONFLICT DO NOTHING; re-run row counts identical (tenants=1, members=5, chunks=227, facts=31) and 0 Voyage tokens; 11-key slot map incl. `tts.voice_id`; 4 archetypes/3 tiers/2 directives
  - [x] 4.2 Library corpus ≥ 8 items / ≥ 200 chunks, canon chunking, real Voyage document-type embeddings cached as content-hash fixtures — verified: 20 items / 227 chunks (~500-char, 20% overlap, title-prepended), REAL voyage-3-large `input_type:document` @ 1024-dim cached as 258 content-hash fixtures (re-run = 0 tokens); every chunk 1024-dim + non-null tsvector
  - [x] 4.3 Demo members with edge shapes (new / mid-journey / expired entitlement / near-zero wallet / long uploads) + wallet ledger that sums to balance + consistent `ai_traces`/`usage_ledger` rows (**markup 1.1× per decision #13/#18 — stale 1.5× note corrected**) — verified: 5 members (new=0 facts/no L1, mid=24 facts+L1+threads+plan, expired entitlement, heavy=near-zero wallet driver, long-fields); balance(40000)==SUM(ledger) and < threshold(100000); every priced ≤ cost×1.1; each debit==-usage.priced; every usage links a real ai_trace
  - [x] 4.4 `seed-verify` query suite in CI after seed; Kyle-identifier grep over schema+seed — verified: `pnpm seed:verify` = 37/37 checks; CI job (`.github/workflows/ci.yml`) runs roles→migrations→seed→seed:verify→test against a `pgvector/pgvector:pg17` service; instance-agnostic grep over schema+seed = 0 (CI step + verify DB-content check)

## Wave candidates

- 1.0 → 2.0 sequential (2.0 publishes what 1.0 scaffolds). 3.0 depends on 1.0 only. 4.0 depends on 3.0 + 2.1.
- Nothing in this module shares an abstraction with another PRD's wave-1 work — PRD-001 IS wave 0; all other PRDs declare it `Required`.
