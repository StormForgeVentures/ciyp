# Wave 0 handoff — foundation scaffold + contract freeze (2026-07-02)

## TL;DR (what's live)

- Monorepo runs green end-to-end: `pnpm install && pnpm typecheck && pnpm build && pnpm test` all exit 0
  (7 workspaces; EL-OS shape). Merged to `main` (614b2ca).
- **Contracts 01–06 are frozen as code**: zod schemas in `@stormforgeventures/ciyp-shared` (`src/contracts/*`), closed `parts`
  union proven by test, 15-test fixture suite green, export surface matches contract 06's manifest.
- **Purity gates enforce architecture**: `scripts/dependency-lint.mjs` (in `pnpm test`) — agents deps
  exactly shared+zod, prompts zero-deps, no direct Pi-engine imports. Verified by planted violations.
- API scaffold serves `GET /health` live (parts union parse proven at the engine edge); web shell builds
  (Vite+React+TanStack Query, ui-tokens bound); voice skeleton (Docker + pytest) in place.
- CI (`.github/workflows/ci.yml`) + publish (`publish.yml`, `shared-v*` tags) workflows prepared.
  Publish SHAPE proven locally: pnpm-pack tarballs installed into a clean external project (dist exports
  resolve — the exact thing ciyp-template will do).

## Flagged / blocked (operator asks — status 2026-07-02 EOD)

1. **GitHub repo — ✅ RESOLVED**: repo = `StormForgeVentures/ciyp`; `shared-v0.1.0` published
   (packages renamed `@stormforgeventures/ciyp-{shared,ui-tokens}` — decision #17); clean external
   install proven in CI (`verify-install.yml` → `REGISTRY-INSTALL OK`). ciyp-template unblocked.
   Sport-package read token — ✅ RESOLVED: `NODE_AUTH_TOKEN` in the dev shell (verified reads both
   orgs); root `.npmrc` + `.env.example` committed. CI still needs a cross-org `SPORT_PACKAGES_TOKEN`
   secret when sport-* deps land (PRD-002 §2.0 — noted in ci.yml).
2. **Local Supabase — ✅ RESOLVED**: stack up via `supabase start` (ports shifted to 553xx to coexist
   with the EL-OS local stack — see `supabase/config.toml`).
3. **Paid Voyage API key — ✅ RESOLVED**: in `.env` as `VOYAGE_API_KEY`; smoke-tested live
   (voyage-3-large, 200 OK, 1024 dims — matches `member_facts vector(1024)`). All operator asks closed.
4. **Local Python tooling — ✅ RESOLVED**: pip 24.0 + venv installed globally (Tim, 2026-07-02);
   local voice tests now runnable.

## Decisions made in-wave (small, recorded here)

- Workspace packages resolve to `src/` in dev; `publishConfig` rewrites to `dist/` at pack/publish
  (EL-OS DX + publishable artifacts; proven by the pack-install test).
- Entitlement `source` stays the literal `'stripe'` at v1; widening to include `'api'` ships additively
  with 008a FR-9 (note in `src/contracts/entitlement.ts`).
- pnpm 11 `allowBuilds: esbuild: true` (build-script approval gate).

## Next (wave 1, per handoff/wave-plan.md)

- 001 §3.0–4.0 schema + RLS + Luminify seed (needs asks 2–3) ∥ 002 §1.0 engine port from EL-OS
  (pure package — needs no infra; can start immediately).
- QA sweep of wave 0 at the next boundary (qa-reviewer; scaffold-level risk is low — checked ACs carry
  evidence in `handoff/acceptance-ledger.md`, Verifier column intentionally left for QA).
- PM session report to alpha-vault pending: VAULT_PATH not discoverable from this session — sync this
  file's contents to `Areas/CIYP-Platform/sessions/2026-07-02-pm-report.md` when the vault MCP is available.
