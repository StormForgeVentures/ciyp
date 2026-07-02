# Tasks — PRD-004 Voice Runtime

> Source: prd-004-voice-runtime-index.md + sub-PRDs a–b. Depends on PRD-002 (internal turn route) and
> PRD-001 (seed edge shapes); 004b's evals need PRD-007's contract-04 impl before acceptance (buildable
> against a contract-faithful stub first). Order: 1.0 → 2.0.

## Relevant Files

- (kept current by build-run)

## Tasks

- [ ] 1.0 Pipecat service port — tenant-agnostic voice pipeline live against the engine (maps to: 004a FR-1..10 / AC-004-voice-runtime-08..-15, index AC-1/AC-6/AC-7 → -01/-06/-07)
  - [ ] 1.1 Port service skeleton (server/pipeline/events/config, Docker) with transportToken handshake → engine session-config fetch before audio; `/healthz`; structured logs (no secrets/audio) — verify: 004a AC-1/AC-2 token tests
  - [ ] 1.2 Pipeline: streaming STT (per-config model) → CoachCoreProcessor (internal turn route, service-secret header, timeout → recoverable error event) → TTS (per-config voiceId) — verify: AC-3/AC-4/AC-6 with fake transport + stubbed engine
  - [ ] 1.3 Barge-in turn-taking port + voice_input_ref/audio part reporting to the engine — verify: AC-5 interrupt test + parts persisted by engine (integration)
  - [ ] 1.4 Lifecycle events (`session_started|session_cut|session_ended` + end report) and tenant-agnostic image proof; CI grep for sport/earendil in apps/voice — verify: AC-7/AC-8 + module AC-6/AC-7; synthetic-audio session on seed = module AC-1/AC-2
- [ ] 2.0 Spend integration — hard enforcement proven on the heavy path (maps to: 004b FR-1..8 / AC-004-voice-runtime-16..-23, index AC-3/AC-4/AC-5 → -03/-04/-05)
  - [ ] 2.1 `POST /v1/voice/session`: heavy authorize (estimate from pricebook config), session record + reservation authToken, transportToken mint; 402 spend_denied w/ remainingCredits on deny — verify: 004b AC-1/AC-2 on seed edge shapes
  - [ ] 2.2 `voice_sessions` migration (RLS same file, indexes) + internal config/end routes (single-use config against valid token; idempotent end) — verify: AC-5 duplicate-end test
  - [ ] 2.3 Checkpoint loop (60s default, config-read w/ invalidation) → cut instruction → `session_cut(spend_denied)` within one interval; in-flight reply finishes then close (Q-2 proposed, confirm at acceptance) — verify: AC-3/AC-8
  - [ ] 2.4 Settlement: actual cost = sum of session's traced rows, settle exactly-once, release for zero-billable sessions, auto-release TTL for dangling reservations — verify: AC-4/AC-6/AC-7 + module AC-3
  - [ ] 2.5 Deterministic enforcement evals in CI (start-refusal, mid-call cut, settle idempotency) wired into the 002d harness — verify: eval suite green = module AC-4/AC-5

## Wave candidates

- 1.0 is independent of PRD-003 (uses the internal turn route from PRD-002 directly) — wave-parallel with
  PRD-003 and PRD-005. 2.0 follows 1.0 and consumes PRD-007b's interface (stub until wave merge; evals
  re-run against the real impl before module acceptance — `Modified here` collision on the SpendAuthorizer
  seam means 2.0 and PRD-007b must not share a wave).
- Q-2 (cut UX grace) is flagged for Tim at acceptance.
