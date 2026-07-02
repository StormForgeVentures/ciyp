# Tasks — PRD-003 Coaching Surfaces

> Source: prd-003-coaching-surfaces-index.md + sub-PRDs a–d. Depends on PRD-001 + PRD-002 (and PRD-005a
> for citation ACs). Order per index priority: 1.0 → 2.0 → 3.0 → 4.0. Engine-side slices end LIVE at the
> contract-02 wire on the Luminify seed (the member UI renderer is the template repo's).

## Relevant Files

- (kept current by build-run)

## Tasks

- [ ] 1.0 Coaching chat turn live on seed — SSE, parts, tools, guards, metering (maps to: 003a FR-1..9 / AC-003-coaching-surfaces-07..-14, index AC-1/AC-2 → -01/-02)
  - [ ] 1.1 `POST /v1/coaching/turn` + `GET /v1/coaching/threads/:id`: contract-02 shapes, SSE `part|turn_meta|error|done` events, parts persisted verbatim, per-member rate limit (30/hr default) — verify: streamed turn on seed persists identical parts (integration test)
  - [ ] 1.2 Turn internals: classifier on fast slot w/ `routing` trace + safe fallback; two-stage tenant-fenced retrieval (RRF k=60 → rerank top-5, traced ANN degradation); cascade L0–L5 w/ context-as-data — verify: 003a AC-2/AC-4/AC-5/AC-6 fault-injection tests
  - [ ] 1.3 Tool wiring: cite_library_item, lookup_member_context, set_interaction_mode, read_member_doc (cue-gated), offer_process, flag_for_red_review (indefinite retention, non-blocking) — verify: AC-7 red-review test + zod-reject tests
  - [ ] 1.4 Post-hoc guard chain (seam isolated for sport-ai-sdk #28), advisory `authorize()` per turn (traced, never hard-blocks), usage event on completion keyed `(thread_id, turn_id)` — verify: AC-3 idempotent replay test
  - [ ] 1.5 Component contracts + `chat-artifact-registry.md`: `<LibraryCitation>` (display-only), `<ProcessOffer>` (interactive + `/v1/coaching/return-event`); loading/partial/error states specified — verify: registry entries + return-event zod validation test; module AC-1 citation flow green on seed
- [ ] 2.0 Member memory — three tiers, compaction, member control (maps to: 003b FR-1..6 / AC-003-coaching-surfaces-15..-21, index AC-3 → -03)
  - [ ] 2.1 Tier wiring per rule 8: Valkey working memory (TTL ≤ 2h), session transcript, `member_facts` long-term + L1 `member_recent_state`; post-turn extraction pipeline (worker slot, dedup ≥ 0.92, deterministic ids, ON CONFLICT DO NOTHING) — verify: 003b AC-7 TTL audit + extraction idempotency test
  - [ ] 2.2 Recall leg: member-fenced kNN + rerank into L4 frame, traced `memory_recall`, 60s recall cache invalidated on writes/edits — verify: module AC-3 memory-continuity eval = 1.0
  - [ ] 2.3 40-turn compaction with Valkey SETNX EX 600 lock — verify: AC-4 concurrent-race test (exactly one summary)
  - [ ] 2.4 Member control API + screen contract: GET /v1/me/memory (P95<300ms), PATCH fact (re-embed, `member_edit` lock), DELETE (soft, immediate recall exclusion) — verify: AC-2/AC-3/AC-5 tests + wire live on seed (new-member empty state)
- [ ] 3.0 Cadence — bounded ritual threads with queryable records (maps to: 003c FR-1..7 / AC-003-coaching-surfaces-22..-28, index AC-4 → -04)
  - [ ] 3.1 Cadence runner on seeded directives (3 kinds), max-turn budget + forced finalize, interaction-engine mode_arc (transitions traced) — verify: 003c AC-2 budget test + AC-4 mode eval ≥ 0.9
  - [ ] 3.2 `cadence_records` write path per Hybrid Interface: finalize tool sole writer of `finalized`, natural-key idempotency `(member, kind, period)`, retry-once + sweep, metered finalize — verify: AC-1 + AC-3 concurrency test
  - [ ] 3.3 Scheduler (BullMQ): timezone-aware period keys, entitlement gate at open, `expired` rows on period close, `member_cadence_config` — verify: AC-5 timezone test + AC-7 expired-member gate
  - [ ] 3.4 History APIs live on seed: POST /v1/cadence/open (409 on finalized period), GET /v1/me/cadence (P95<200ms), GET /v1/admin/cadence (role-gated, P95<500ms) — verify: AC-6 fence tests + module AC-4 end-to-end
- [ ] 4.0 Guided processes — one runner, doc-approved artifacts (maps to: 003d FR-1..7 / AC-003-coaching-surfaces-29..-35)
  - [ ] 4.1 Runner executes seeded directives through interaction engine + goal gate (deterministic; `doc-approved` requires doc AND member approval); `source='authored'` fixture row proves the graduation seam (JSON-Schema bridge validation interim per Q-1) — verify: 003d AC-3 gate-block + AC-4 authored-fixture end-to-end
  - [ ] 4.2 Document artifacts: render-from-structured-state only, fidelity check gates `offered`, `pinned_lines` bypass linters verbatim — verify: AC-2 fidelity eval = 1.0 + AC-6 pinned-vs-generated trace test
  - [ ] 4.3 `coaching_process_outputs` per Hybrid Interface: deterministic versioned rows, approval state machine `draft→offered→approved|declined` (member-only transition via `<DocApproval>` return event), declined → version n+1 — verify: AC-1 + AC-5 revision test
  - [ ] 4.4 Entry + read surfaces live on seed: POST /v1/processes/start (idempotent per key), process_offer acceptance handoff from 1.0, GET /v1/me/process-outputs + admin view, `<DocApproval>` registered w/ 3 states — verify: AC-7 + 003a AC-8 handoff + module AC-5/AC-6 fence audit

## Wave candidates

- 1.0 gates 2.0–4.0 (all ride the turn loop). 2.0 must precede 4.0 (grounding). 3.0 and 4.0 are
  independent of each other (disjoint tables/runners) — parallel candidates within a wave.
- Cross-PRD: 1.0's citation AC needs PRD-005a's seed ingestion (read-only). `authorize()`/entitlement
  gates ride ports stubbed in 002b/008a — no shared-abstraction collision; swap at wave merge.
