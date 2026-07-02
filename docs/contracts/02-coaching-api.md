# Contract 02 — Coaching API

**Direction:** UI → engine · **Lives in:** `@stormforgeventures/ciyp-shared` · **Stability:** the `parts` union is FROZEN at v1.

The thin client's core surface. Three operations: **chat/turn** (streamed via SSE), **check-in** (bounded
cadence thread), and **voice session**. The heart is the `parts` discriminated union — **the same shape on
the SSE wire, in storage (`chat_messages.parts`), and in the client renderer.** EL-OS's warning carries
forward verbatim: *lock it in the first migration; backfilling is multi-week.*

## 0. The `parts` discriminated union (load-bearing — frozen)

```ts
import { z } from 'zod';

export const TextPart = z.object({
  type: z.literal('text'),
  text: z.string(),
});

export const AudioPart = z.object({
  type: z.literal('audio'),
  url: z.string().url(),            // TTS output (Fish-audio); streamed/served by engine
  durationMs: z.number().int().nullable(),
  transcript: z.string().nullable(),
});

export const LibraryCitationPart = z.object({
  type: z.literal('library_citation'),
  resourceId: z.string().uuid(),
  title: z.string(),
  snippet: z.string(),
  locator: z.string().nullable(),   // page/section anchor
});

export const ProcessOfferPart = z.object({
  type: z.literal('process_offer'),
  processKey: z.string(),           // a coaching_process_definitions key (ADR-002)
  label: z.string(),
  modality: z.enum(['voice', 'guided', 'text']),
});

export const VoiceInputRefPart = z.object({
  type: z.literal('voice_input_ref'),
  voiceInputId: z.string().uuid(),  // references a captured member voice input
  transcript: z.string().nullable(),
});

export const MessagePart = z.discriminatedUnion('type', [
  TextPart, AudioPart, LibraryCitationPart, ProcessOfferPart, VoiceInputRefPart,
]);
export type MessagePart = z.infer<typeof MessagePart>;
```

## 1. Chat / turn (SSE streaming)

```
POST /v1/chat/turn        (auth: member session)
body: ChatTurnRequest
→ 200 text/event-stream  of ChatTurnEvent
```

```ts
export const ChatTurnRequest = z.object({
  threadId: z.string().uuid().nullable(),   // null = start a new thread
  input: z.array(MessagePart),              // member input as parts (text and/or voice_input_ref)
  interactionMode: z.enum(['instruct', 'call_response', 'free', 'hold']).default('free'),
  clientMsgId: z.string().uuid(),           // client idempotency for the turn
});

// SSE event frames (discriminated by `event`)
export const ChatTurnEvent = z.discriminatedUnion('event', [
  z.object({ event: z.literal('thread'),      threadId: z.string().uuid() }),
  z.object({ event: z.literal('part_delta'),  partIndex: z.number().int(), delta: z.string() }), // text streaming
  z.object({ event: z.literal('part'),        part: MessagePart }),     // a completed non-text part (audio/citation/offer)
  z.object({ event: z.literal('message_done'),messageId: z.string().uuid(), parts: z.array(MessagePart) }),
  z.object({ event: z.literal('error'),       code: z.string(), message: z.string() }),
  z.object({ event: z.literal('spend_denied'),remainingCredits: z.number() }), // ADR-003 hard enforcement surfaced
]);
```

- The terminal `message_done` carries the **full `parts[]`** that is persisted to `chat_messages.parts` —
  identical shape. The renderer is a pure function of `parts[]`.
- `spend_denied` is how wallet hard-enforcement (ADR-003) reaches the UI (e.g. deep-model turn refused at
  zero balance); the UI shows a top-up prompt.

## 2. Check-in (bounded cadence thread)

Cadence inputs are **bounded chat threads (4–12 turns)** emitting Zod-validated structured outputs into
domain tables. Same turn machinery, scoped to a journey.

```ts
export const CheckinStartRequest = z.object({
  journeyKey: z.string(),                    // e.g. "daily_checkin" (from Instance Config journeys)
});
// → returns a threadId; subsequent turns use POST /v1/chat/turn with that threadId.
// The engine closes the thread and writes structured output when the cadence completes.
```

```
POST /v1/checkin/start    (auth: member session)  → { threadId }
```

## 3. Voice session (P0)

Opens a real-time session against `apps/voice` (Pipecat). **No AI on device.** Hard spend check at start
(ADR-003).

```ts
export const VoiceSessionStartRequest = z.object({
  journeyKey: z.string().nullable(),         // null = free voice coaching
});
export const VoiceSessionStartResponse = z.object({
  sessionId: z.string().uuid(),
  transportUrl: z.string().url(),            // Pipecat transport endpoint
  transportToken: z.string(),                // short-lived session token
  // if hard-denied at start (empty wallet), engine returns 402 with remainingCredits instead.
});
```

```
POST /v1/voice/session    (auth: member session)
→ 200 VoiceSessionStartResponse | 402 { code: 'spend_denied', remainingCredits }
```

Long sessions re-check the wallet at intervals (ADR-003 §4 / OQ-5); a drained session is cut at a
checkpoint and the transport closes with a reason code.

## Constraints for downstream

- `parts` shape is **identical** on the wire, in storage, and in the renderer. **Never** add a part type
  without a migration + a renderer update in the same wave (frozen union).
- All endpoints are tenant-fenced via the session token (ADR-001); the UI never sends a `tenantId`.
- `clientMsgId` makes turns idempotent (retry-safe).
- `spend_denied` (SSE) and `402 spend_denied` (voice) are first-class UI states, not errors to swallow.
- The UI must handle SSE reconnection and resume from the last `message_done`.
