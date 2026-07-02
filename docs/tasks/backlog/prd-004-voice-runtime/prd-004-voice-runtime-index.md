# PRD-004: Voice Runtime

> Source: docs/project-brief.md + docs/architecture.md §8 | Folder location = lifecycle status (do not add a Status field)

## Overview

### Goals

Members hold real-time voice coaching conversations grounded in their coach's library, spoken back in
the coach's own cloned voice — the P0 differentiator (project-state decision #5). This module ports
EL-OS's proven Pipecat service into an instance-configurable form and wires it to the platform's spend
enforcement, addressing three distinct concerns: (1) a tenant-agnostic real-time voice pipeline
(streaming STT → engine turn → per-tenant TTS), (2) hard wallet enforcement on the most spend-heavy
path (session start refusal + mid-call checkpoint cut), and (3) full trace/metering coverage so every
voice AI decision lands in `ai_traces` and bills the coach's wallet. It unblocks the member UI's voice
client (ciyp-template P0) and is the primary consumer of the spend-authorization hard-check seam.

### Scope

| In scope | Out of scope |
|----------|--------------|
| Instance-configurable Pipecat voice service (Docker, one image for all tenants) | Any AI execution on the member device (thin-client mandate) |
| Streaming STT via the tenant's `stt` slot (Deepgram nova-3 at seed) | Batch media transcription (library ingestion — PRD-005) |
| Per-tenant TTS voice persona (`tts.voice_id`, Fish-audio at seed) | Voice persona *authoring/cloning* workflow (provisioning input — PRD-008) |
| Barge-in turn-taking (EL-OS port) | Multi-party / group voice sessions |
| Voice session lifecycle: start (hard spend check) → checkpoints → settle/release | Voice client UI (ciyp-template repo) |
| `session_cut` / `spend_denied` wire signals per contracts 02 + 04 | Postpaid or soft-limit enforcement modes (prepaid hard enforcement only, ADR-003) |
| Trace + metering coverage for STT / turn / TTS decisions | Sport SDK voice fast-path (EL-OS's undeployed `voiceOrigin` route — future) |

## Sub-PRDs

| Sub-PRD | File | Scope (one line) |
|---------|------|------------------|
| 004a | `prd-004a-voice-runtime-pipecat-service.md` | Port `apps/voice` as a tenant-agnostic, instance-configured Pipecat service (STT → internal turn → TTS, barge-in) |
| 004b | `prd-004b-voice-runtime-spend-integration.md` | Contract-04 heavy-path integration: start hard-check, checkpoint re-check + cut, settle/release, enforcement evals |

## Personas

- **Member** — a coach's client on the thin UI; opens a voice session, talks, gets coached in the
  coach's voice; must get a graceful, comprehensible stop (not a crash) when the coach's wallet is empty.
- **Luminify operator** — owns AI economics; needs every voice second traced, metered, and billed to the
  right tenant wallet, and needs enforcement to actually bite (voice is the loss vector at zero balance).
- **Developer agents** — build against this spec; the voice service must stay a pure API client (no
  Sport/DB access) so the port remains mechanical and testable with synthetic audio.

## Module-level acceptance criteria

Cross-cutting / integration-level; sub-feature criteria live in the sub-PRDs.

| # | Given / When / Then |
|---|---------------------|
| AC-1 | Given the Luminify seed and a funded mid-journey member, when the member completes a scripted voice session using the synthetic-audio fixture (utterance in → reply out), then the reply audio part references the Luminify tenant's configured `tts.voice_id`. |
| AC-2 | Given that completed session, then `ai_traces` rows exist for the STT utterance, the coaching turn, and the TTS synthesis, each carrying `provider`, `model`, and token/cost columns. |
| AC-3 | Given that session ends normally, then exactly one `settle()` has replaced the session's heavy reservation and the resulting Usage Event appears in `usage_ledger` (idempotent under retry). |
| AC-4 | Given the near-zero-wallet seed tenant, when its member calls `POST /v1/voice/session`, then the response is `402 { code: 'spend_denied', remainingCredits }` and no transport token is issued. |
| AC-5 | Given an active session whose wallet drains below the reservation floor, when the next checkpoint fires, then the transport closes with reason `spend_denied` within one checkpoint interval and the reservation is settled for actual cost. |
| AC-6 | Given `apps/voice` source, when grepped for `sport-core`, `sport-server`, or `@earendil`, then there are zero matches (voice is a pure HTTP client of the API). |
| AC-7 | Given the same Docker image, when booted against two different tenants' sessions, then each session resolves that tenant's STT model and TTS voice from session config (no tenant identity baked into the image or env). |

## Core UX per Surface

- **Member (ciyp-template — consumer, not built here):** taps "voice session" → connects to the
  transport URL from `VoiceSessionStartResponse` → talks naturally with barge-in → on `402` at start or
  a mid-call `session_cut(spend_denied)`, renders the contract's "wallet paused" state, never a raw error.
  This module's obligation is emitting those wire states exactly per contracts 02/04.
- **Admin (`apps/web`):** no dedicated voice screens in this module; voice sessions surface through the
  existing trace/eval and wallet views (PRD-006/007).

## Technical Considerations

Reference: `docs/architecture.md` §8 (voice), §5.5 (process model), ADR-003 §4, ADR-006 rule 1
(voice calls the API's internal turn route; no Sport code in voice).

### One brain, HTTP seam

The Pipecat service never runs AI logic: each final STT transcription POSTs to the API's internal turn
route (`modality: 'voice'`), and the linter-passed reply text comes back for TTS. This is EL-OS's "drift
invariant" — the LLM is not a Pipecat service — and it is what keeps voice inheriting Sport, tracing,
memory, and enforcement transitively with zero duplication. Removing it (e.g. calling a model from
Python "just for latency") would silently bypass tracing, wallet metering, and the linter chain.

### Latency budget shapes the enforcement design

Voice turns cannot afford a wallet round-trip per utterance. Enforcement therefore lives at session
grain: one hard check + reservation at start, periodic checkpoint re-checks (interval is a platform
tunable, architecture OQ-5), settle at end. Per-utterance calls ride the session's authorization.

### Security

- Transport access only via the short-lived `transportToken` minted by the engine at session start;
  the voice service validates it and resolves the session server-side — the client never supplies
  tenant or member ids (contract 02 constraint).
- Voice service ↔ API internal routes are authenticated with a shared service secret header and are
  not internet-routable; Deepgram/Fish credentials live only in the voice service's platform env
  (Luminify is the single AI vendor of record) — never in session config payloads, tokens, or logs.
- Rate limit session creation per member (voice is the most expensive call class).

## Dependencies

| Dependency | Source | Status |
|------------|--------|--------|
| Coaching turn runtime (internal turn route, tracing, memory) | PRD-002 | Required |
| Spend authorization service (contract 04 impl) | PRD-007 | Required (buildable against the frozen contract in parallel) |
| Seed edge shapes (funded member, near-zero-wallet tenant) | PRD-001 | Required |
| `stt`/`tts` slot values per tenant (`app_config.model_routing`) | PRD-006 (authoring) / PRD-001 (seed) | Required (seed values suffice for v1 build) |
| Contracts 02 §3 + 04 (frozen shapes) | `docs/contracts/` | Available |

## Non-Goals

- No on-device AI, ever (thin-client mandate).
- No voice-persona cloning workflow (a provisioning input; PRD-008 records the `voice_id`).
- No group sessions, no inbound PSTN/telephony.
- No Sport SDK integration inside the Python service (it arrives transitively via the API).

## Success Metrics

- A seeded member completes a voice session end-to-end on the provisioning runbook's verification pass
  (success criterion #3 of the brief).
- 100% of voice AI decisions in a session produce `ai_traces` rows with cost columns (metering coverage).
- Enforcement evals green: start-refusal and mid-call-cut deterministic tests pass in CI.
- Voice turn latency P95 within the architecture's end-to-end coaching budget (~3–6s speech-to-first-audio).

## Implementation Priority

1. **004a Pipecat service port** — mechanical port of proven EL-OS code; unblocks all voice integration
   testing with synthetic audio; no wallet dependency (stub authorize in dev).
2. **004b spend integration** — layers the contract-04 heavy path onto a working pipeline; its evals are
   the module's acceptance spine and need PRD-007's authorize/settle/release (or its contract stub) live.

## Related

- Task list: `tasks-004-voice-runtime.md` (this folder — generate-tasks output)
- QA report: `qa/qa-004-voice-runtime.md` (authored by the qa-reviewer, NOT the PM)
- Acceptance ledger: `handoff/acceptance-ledger.md` (`AC-004-voice-runtime-NN` rows)
