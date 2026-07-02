# Tasks — PRD-006 Admin & Config Studio

> Source: prd-006-admin-config-studio-index.md + sub-PRDs a–c. Depends on PRD-001, PRD-002 (invalidation
> seams, eval harness), PRD-005c (MCP toggles, for 3.0 only). Order per index priority: 1.0 → 2.0 → 3.0.
> The invalidation fan-out (persist → version → slot invalidate → assembly invalidate) is an integration
> test, not a convention — it recurs in 2.4 and 3.3.

## Relevant Files

- (kept current by build-run)

## Tasks

- [ ] 1.0 Admin shell — the security spine every surface mounts into (maps to: 006a FR-1..8 / AC-006-admin-config-studio-07..-12, index AC-1/AC-2 → -01/-02)
  - [ ] 1.1 `apps/web` shell (TanStack Router/Query, left-nav, empty/error/loading states everywhere) + Supabase Auth sign-in; tenant scope established server-side via request-ALS (never client-supplied) — verify: 006a AC-6 unauthenticated redirect/401
  - [ ] 1.2 Role gates (`owner` + `member` v1 per Q-2): nav absence AND API 403; cross-tenant probe 404/403 — verify: AC-1/AC-2 API + Playwright
  - [ ] 1.3 Superadmin: tenants list/create (platform-default `app_config` row per Q-1)/suspend; tenant switcher with "acting in" banner + `admin_audit_log` migration and writes on every switched mutation — verify: AC-3/AC-4; suspended-tenant state (AC-5)
  - [ ] 1.4 Dashboard shell bound to live seed identity + team management (owner adds member by email) — verify: seed-backed render Playwright; wire live + seed + Figma self-diff
- [ ] 2.0 Instance config authoring + contract 01 emission (maps to: 006b FR-1..9 / AC-006-admin-config-studio-13..-19, index AC-3/AC-5 → -03/-05)
  - [ ] 2.1 CRUD endpoints + screens: archetypes (fragment editor w/ server-side validation), tiers, journeys (config rows, no builder), branding; History panel per entity — verify: 006b AC-6 field-level rejection + CRUD Playwright
  - [ ] 2.2 Model-routing slot editor (exact ai-architecture §2 taxonomy; allowed-provider validation; coach edits default/fast/deep/tts, operator-only embed/rerank/stt per Q-1; tts.voice_id field) — verify: slot save → 006b AC-4 two-tenant trace test
  - [ ] 2.3 Write pipeline (transactional): persist → prompt-set bump → `prompt_versions` (actor + required rationale) → slot invalidate → assembly invalidate; branding-only skips the bump but versions contract 01 — verify: AC-1/AC-7 + module AC-5 audit query
  - [ ] 2.4 Eval-gated go-live: `live_prompt_set_version` pointer advanced only by gate pass (audited operator override); pending-version bar + Activate flow streaming eval status — verify: AC-2/AC-3 (edit-to-live ≤ 60s P95); wire live + seed + Figma self-diff
  - [ ] 2.5 `GET /instance-config` contract 01 emission (zod-validated, ETag, tenant-scoped) — verify: AC-5 schema validation test
- [ ] 3.0 Agent studio — coach-authored agents live without a deploy (maps to: 006c FR-1..10 / AC-006-admin-config-studio-20..-27, index AC-4 → -04)
  - [ ] 3.1 Definition tables migrations (`tenant_agent_definitions`, authored `tenant_process_definitions` discipline, `tenant_cascade_blocks` w/ layer ≥ 2 check; unique `(tenant_id,name,version)`, one-active partial index) — verify: constraint tests incl. locked-layer write rejection (006c AC-7)
  - [ ] 3.2 Authoring endpoints + editor screens (agents/processes/blocks/tools tabs): capability verb enum (no coach `dispatch` per Q-1), model override restricted to tenant slots, output-schema catalog picks, curated tool catalog + MCP toggles from `tenant_integrations` — verify: 006c AC-1 versioned draft rows + catalog join test
  - [ ] 3.3 Hydration dry-run on save through real `defineRole`/`defineProcess` constructors; `aiFixHint` → 422 → rendered on the offending field; auto version-bump-on-save everywhere (sport-ai-sdk #26 constraint made a feature) — verify: AC-2 planted-invalid-definition test
  - [ ] 3.4 Activation pipeline: draft → dry-run → interim standard eval pack (faithfulness ≥ 0.9, goal-gate 1.0, groundedness ≥ 0.9 per Q-2; sport-ai-sdk #30 replaces) → pointer flip + `prompt_versions` + slot/assembly invalidation (pointer only after pass; failed invalidation retries + alerts); revert = re-activation of a prior version — verify: AC-3/AC-4/AC-5 + module AC-4
  - [ ] 3.5 Draft sandbox: test-context SSE turn against a draft version (traced test-context, wallet-debited, hard spend cap per Q-3, excluded from member history) + tenant isolation proof — verify: AC-6/AC-8; wire live + seed + Figma self-diff

## Wave candidates

- 1.0 gates 2.0/3.0 and also PRD-005b/005c's admin screens (they mount into this shell) — schedule 1.0 in
  the earliest UI wave. 2.0 precedes 3.0 (3.0 composes 2.x's versioning/eval plumbing).
- Cross-PRD collisions: 3.2's MCP toggles need PRD-005c (`Required`); 3.x and PRD-003d both touch the
  authored-definitions read path (`tenant_process_definitions`) — 003d consumes via fixture until 3.x
  lands, so they may share a wave ONLY if 003d's fixture path is already merged. sport-ai-sdk #25–#27 are
  the module's critical-path external dependency; the interim seam (PRD-002b) de-risks scheduling.
