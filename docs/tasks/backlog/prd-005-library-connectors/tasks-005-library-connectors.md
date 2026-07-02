# Tasks — PRD-005 Library & Connectors

> Source: prd-005-library-connectors-index.md + sub-PRDs a–d. Depends on PRD-001 (schema/seed), PRD-002
> (ports, slots, MCP catalog seam), PRD-006a (admin shell for the UI slices). Order per index priority:
> 1.0 → 2.0, then 3.0 ∥ (parallel-eligible with 2.0 once 1.0's document shape is frozen) → 4.0.

## Relevant Files

- (kept current by build-run)

## Tasks

- [ ] 1.0 Ingestion pipeline — content to tenant-fenced retrievable chunks (maps to: 005a FR-1..8 / AC-005-library-connectors-06..-11, index AC-1 partial)
  - [ ] 1.1 `library_documents`/`library_chunks` migrations (RLS + HNSW + GIN + provenance fields in-file) + staged BullMQ worker (`pending→…→indexed`, skip-recorded stages, resumable, stage-idempotent, `failed` w/ machine-readable stage+reason) — verify: 005a AC-1/AC-2/AC-3
  - [ ] 1.2 Source acquisition: PDF extract; Cloudflare Stream direct upload + signature-verified idempotent webhook → Deepgram batch via `stt` slot; Vimeo reference — verify: per-source fixture runs reach `indexed`
  - [ ] 1.3 Chunk/embed: canon chunking (~500/20%, title-prepended, `page_number`/`start_seconds`), `embed` slot w/ `input_type:'document'`, chunk `tenant_id` NOT NULL + rule-4 port writes — verify: AC-5/AC-6
  - [ ] 1.4 Delete-then-re-index on update/re-import (H-3) + seed-corpus ingestion for PRD-001c — verify: AC-4 stale-chunk test; retrieval of seed corpus green (module AC-1 pipeline half)
- [ ] 2.0 Library management UI — coach-operable pipeline on real data (maps to: 005b FR-1..6 / AC-005-library-connectors-12..-17, index AC-1/AC-5)
  - [ ] 2.1 Admin endpoints per 005b table (list/create/detail/retry/delete; tenant-from-session, role-gated, P95 targets) — verify: endpoint tests incl. 409-unless-failed retry + member 403/404 (AC-5)
  - [ ] 2.2 Library screens: list w/ source badges + ≤10s polling (hidden-tab backoff), upload flows (PDF / Stream direct-upload URL / Vimeo URL), detail w/ stage history + retry, delete — verify: 005b AC-1..4 Playwright; wire live + seed + Figma self-diff
  - [ ] 2.3 Provenance badge from `source` field (imported items in same list, no silo) — verify: AC-6 fixture badge test; module AC-1 end-to-end (upload → indexed → cited via 003a)
- [ ] 3.0 Connector framework — vault, states, per-scope MCP catalog, connections UI (maps to: 005c FR-1..8 / AC-005-library-connectors-18..-24)
  - [ ] 3.1 Migrations: `tenant_integrations` constraints + `integration_tokens` vault (envelope-encrypted bytea, `key_id`, atomic rotation) + `oauth_pending` (state + PKCE, TTL-cleaned) — verify: 005c AC-4 rotation test
  - [ ] 3.2 OAuth 2.1 lifecycle: connect (authorize URL), public callback (state-validated, idempotent), proactive refresh worker, `consent_pending→connected→needs_consent/revoked` state machine — verify: AC-1/AC-5
  - [ ] 3.3 Per-scope MCP catalog registration (`listActive(scope)`, real scope only — sentinel fails test) + toggle → assembly invalidation (002b seam) — verify: AC-6/AC-7
  - [ ] 3.4 Confidentiality + isolation: token columns never serialized to clients/traces/logs (lint + runtime scan), tenant-B 404 test; connections UI (provider cards, connect/disconnect/health, re-consent variant) — verify: AC-2/AC-3 + Playwright; wire live + seed + Figma self-diff
- [ ] 4.0 Granola + Fathom providers — meetings to cited library content (maps to: 005d FR-1..7 / AC-005-library-connectors-25..-31, index AC-3)
  - [ ] 4.1 `TranscriptProvider` port + two adapters (capability flags: folders/pagination/format), fixture-backed doubles for CI (R-1) — verify: adapter contract tests on fixtures
  - [ ] 4.2 Import runs: selection endpoints + `import_runs`/`import_run_items` migrations, chunking-stage entry (no re-transcription), `(tenant_id, source, source_ref)` idempotency, per-item outcomes isolated from failures, rate-limited + traced — verify: 005d AC-2/AC-3/AC-6
  - [ ] 4.3 Import selection UI (folder filter per capability, imported badges, run-progress polling) + explicit re-import (H-3, 409 unless connector source) — verify: AC-1/AC-7 Playwright; wire live + seed + Figma self-diff
  - [ ] 4.4 Import-fidelity deterministic eval (transcript text fully reachable in chunks) + citation provenance flow — verify: AC-4/AC-5 + module AC-3 end-to-end on the fixture double

## Wave candidates

- 1.0 gates everything here and PRD-001c's corpus + PRD-003a's citation AC — schedule early.
- 2.0 and 3.0 are independent of each other (disjoint tables/screens) — parallel candidates once 1.0's
  document shape is frozen; both need PRD-006a's admin shell (`Required`, not modified).
- 4.0 strictly follows 3.0 + 1.0. Q-3 (transcript PII) is flagged to the security-review wave.
- Cross-PRD collision: none `Modified here` overlaps another PRD; `tenant_integrations` is stubbed in 001b
  and constrained here — 001b must merge first.
