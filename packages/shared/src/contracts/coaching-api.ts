/**
 * Contract 02 — Coaching API (UI → engine).
 * The `parts` discriminated union is FROZEN at v1: identical on the SSE wire, in storage
 * (chat_messages.parts), and in the client renderer. Never add a part type without a
 * migration + renderer update in the same wave. Source: docs/contracts/02-coaching-api.md.
 */
import { z } from 'zod';

// ── §0 The parts union (load-bearing — frozen) ────────────────────────────────

export const TextPart = z.object({
  type: z.literal('text'),
  text: z.string(),
});
export type TextPart = z.infer<typeof TextPart>;

export const AudioPart = z.object({
  type: z.literal('audio'),
  /** TTS output (per-tenant voice persona); streamed/served by the engine. */
  url: z.string().url(),
  durationMs: z.number().int().nullable(),
  transcript: z.string().nullable(),
});
export type AudioPart = z.infer<typeof AudioPart>;

export const LibraryCitationPart = z.object({
  type: z.literal('library_citation'),
  resourceId: z.string().uuid(),
  title: z.string(),
  snippet: z.string(),
  /** Page/section anchor (PDF page, transcript timestamp label, …). */
  locator: z.string().nullable(),
});
export type LibraryCitationPart = z.infer<typeof LibraryCitationPart>;

export const ProcessOfferPart = z.object({
  type: z.literal('process_offer'),
  /** A coaching_process_definitions key (ADR-002 — tenant config, not an enum). */
  processKey: z.string(),
  label: z.string(),
  modality: z.enum(['voice', 'guided', 'text']),
});
export type ProcessOfferPart = z.infer<typeof ProcessOfferPart>;

export const VoiceInputRefPart = z.object({
  type: z.literal('voice_input_ref'),
  /** References a captured member voice input. */
  voiceInputId: z.string().uuid(),
  transcript: z.string().nullable(),
});
export type VoiceInputRefPart = z.infer<typeof VoiceInputRefPart>;

/** Closed at v1 — parsing an unknown `type` MUST fail (see contract fixtures). */
export const MessagePart = z.discriminatedUnion('type', [
  TextPart,
  AudioPart,
  LibraryCitationPart,
  ProcessOfferPart,
  VoiceInputRefPart,
]);
export type MessagePart = z.infer<typeof MessagePart>;

// ── §1 Chat / turn (SSE streaming) ────────────────────────────────────────────

export const ChatTurnRequest = z.object({
  /** null = start a new thread. */
  threadId: z.string().uuid().nullable(),
  /** Member input as parts (text and/or voice_input_ref). */
  input: z.array(MessagePart),
  interactionMode: z.enum(['instruct', 'call_response', 'free', 'hold']).default('free'),
  /** Client idempotency for the turn (retry-safe). */
  clientMsgId: z.string().uuid(),
});
export type ChatTurnRequest = z.infer<typeof ChatTurnRequest>;

/** SSE event frames (discriminated by `event`). */
export const ChatTurnEvent = z.discriminatedUnion('event', [
  z.object({ event: z.literal('thread'), threadId: z.string().uuid() }),
  z.object({
    event: z.literal('part_delta'),
    partIndex: z.number().int(),
    delta: z.string(),
  }),
  z.object({ event: z.literal('part'), part: MessagePart }),
  z.object({
    event: z.literal('message_done'),
    messageId: z.string().uuid(),
    /** The FULL parts[] persisted to chat_messages.parts — identical shape. */
    parts: z.array(MessagePart),
  }),
  z.object({ event: z.literal('error'), code: z.string(), message: z.string() }),
  /** ADR-003 hard enforcement surfaced — a first-class UI state, not an error to swallow. */
  z.object({ event: z.literal('spend_denied'), remainingCredits: z.number() }),
]);
export type ChatTurnEvent = z.infer<typeof ChatTurnEvent>;

// ── §2 Check-in (bounded cadence thread) ──────────────────────────────────────

export const CheckinStartRequest = z.object({
  /** e.g. "daily_checkin" — from Instance Config journeys (contract 01). */
  journeyKey: z.string(),
});
export type CheckinStartRequest = z.infer<typeof CheckinStartRequest>;

// ── §3 Voice session (P0) ─────────────────────────────────────────────────────

export const VoiceSessionStartRequest = z.object({
  /** null = free voice coaching. */
  journeyKey: z.string().nullable(),
});
export type VoiceSessionStartRequest = z.infer<typeof VoiceSessionStartRequest>;

export const VoiceSessionStartResponse = z.object({
  sessionId: z.string().uuid(),
  /** Pipecat transport endpoint. */
  transportUrl: z.string().url(),
  /** Short-lived session token. Hard-denied starts return 402 spend_denied instead. */
  transportToken: z.string(),
});
export type VoiceSessionStartResponse = z.infer<typeof VoiceSessionStartResponse>;
