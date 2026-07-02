# PRD-004a: Pipecat Voice Service (instance-configurable port)

> Parent: prd-004-voice-runtime-index.md | Module: Voice Runtime

## Goal

Port EL-OS's `apps/voice` (Python, Pipecat, ~800 LOC: server / pipeline / coach-core client /
turn-taking / events / config) into a tenant-agnostic service: one Docker image serves every tenant,
resolving per-session STT model and TTS voice from engine-issued session config instead of instance
constants. The service stays a pure HTTP client of the API — no Sport, no DB, no model routing of its own.

## Functional requirements

1. **Session handshake:** the service accepts a WebSocket connection bearing the short-lived
   `transportToken` from `VoiceSessionStartResponse` (contract 02 §3); it validates the token and
   fetches session config from the engine before any audio flows.
2. **Session config payload** (engine → voice, internal): `{ sessionId, tenantId, memberId, threadId,
   stt: { provider, model }, tts: { provider, voiceId }, checkpointIntervalS, limits }`. The service
   treats it as opaque config — no defaults, no fallbacks to baked-in tenant values (there are none).
3. **Pipeline (EL-OS shape, ported):** `transport.input() → streaming STT (per-config model) →
   CoachCoreProcessor → TTS (per-config voiceId) → transport.output()`.
4. **CoachCoreProcessor:** on each final transcription frame, `POST` the engine's internal turn route
   with `{ memberId, threadId, text, modality: 'voice', sessionId }` and the service-secret header;
   push the returned reply text to TTS. Timeouts and turn errors surface as a spoken/system error
   event, never a silent hang.
5. **Barge-in turn-taking:** port EL-OS `turn_taking.py` behavior — member speech interrupts in-flight
   TTS playback and cancels the superseded synthesis.
6. **Voice input capture:** each member utterance is reported to the engine so the turn persists a
   `voice_input_ref` part and the reply persists an `audio` part (contract 02 `parts` union) — the
   engine owns persistence; the service only reports.
7. **Lifecycle events:** the service emits `session_started`, `session_cut { reason }`, and
   `session_ended` on the transport, and notifies the engine of session end (duration, utterance count)
   for settlement (004b).
8. **Tenant-agnostic image:** no tenant identifiers in env or build args. Platform-level env only:
   engine base URL, service secret, Deepgram key, Fish-audio key, port.
9. **Operational surface:** `/healthz` liveness (no auth); structured JSON logs with `sessionId`/
   `tenantId` correlation and zero secrets/audio payloads in logs.
10. **Tests:** pipeline integration tests run against a fake transport + synthetic audio fixtures and a
    stubbed engine — CI-runnable without live STT/TTS keys (EL-OS test posture preserved).

## Acceptance criteria

| # | Given / When / Then |
|---|---------------------|
| AC-1 | Given a valid `transportToken`, when the client connects to `/ws`, then the service fetches session config from the engine and emits `session_started` before processing audio. |
| AC-2 | Given an invalid or expired `transportToken`, when the client connects, then the connection closes with an auth reason code and no engine turn call is made. |
| AC-3 | Given a synthetic utterance fixture, when the pipeline processes it, then the engine's internal turn route receives `{ text, modality: 'voice', memberId, threadId, sessionId }` with the service-secret header. |
| AC-4 | Given two sessions configured with different `tts.voiceId` values, when each produces a reply, then each TTS request carries its own session's `voiceId` (asserted via the stubbed TTS layer). |
| AC-5 | Given in-flight TTS playback, when the member starts speaking, then playback is interrupted and the superseded synthesis is cancelled (barge-in test). |
| AC-6 | Given the engine turn route times out, when a turn is in flight, then the service emits a recoverable error event on the transport and the session survives. |
| AC-7 | Given the repo, when CI greps `apps/voice` for `sport-core|sport-server|@earendil`, then there are zero matches. |
| AC-8 | Given the Docker image, when inspected, then no tenant-specific env/config is present (image is tenant-agnostic). |

## Data requirements

No data model changes. The service is stateless; all persistence (messages, parts, traces, session
records) belongs to the engine.

## Endpoints

Service-side:
- `WS /ws?token=<transportToken>` — the audio transport (EL-OS shape). Auth: transportToken.
- `GET /healthz` — liveness. No auth.

Engine internal routes this service consumes (defined/owned by PRD-002 and 004b, listed for the seam):
- `POST /internal/voice/session/{sessionId}/config` — validate token → session config payload (FR-2). Auth: service secret.
- `POST /internal/coach-core/turn` — the coaching turn (FR-4). Auth: service secret.
- `POST /internal/voice/session/{sessionId}/end` — end-of-session report for settlement. Auth: service secret.

## UI/UX

No frontend changes in this slice (the voice client UI lives in ciyp-template and consumes contract 02 §3).

## Hybrid Interface

Not applicable — AI-native lane (feature-classification #2); single conversational surface.

## Dependencies

| Dependency | Source | Status |
|------------|--------|--------|
| Internal turn route (`/internal/coach-core/turn`) | PRD-002 | Required |
| Session start + token mint (`POST /v1/voice/session`) | PRD-004b | Created here (module) |
| EL-OS `apps/voice` source (port source) | `/mnt/c/Repos/empowered-leader-os` | Available (read-only) |
| Deepgram + Fish-audio platform credentials | ops env | Required |

## Open questions

| # | Question | Why it matters | Resolution |
|---|----------|----------------|------------|
| Q-1 | Transport mechanics: keep EL-OS's exact WS/audio-frame transport, or move to a Pipecat-supported WebRTC transport for the Expo client? | Client-side echo cancellation / network resilience on mobile | Interim: port EL-OS transport unchanged (reuse posture); revisit with the template's voice client wave. |
| Q-2 | Does STT language/locale become a per-tenant slot field now or at first non-English coach? | Deepgram model params | Deferred: platform default `en`; ADR-007 already names multilingual as the re-baseline trigger. |
