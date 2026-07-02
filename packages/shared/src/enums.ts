/**
 * Platform-mechanic enums — the ADR-002 "stay" list. These encode engine state machines,
 * NOT coach IP. Rule of thumb: if a coach would ever want to name it differently, it's
 * per-tenant config (rows), never an entry here.
 */
import { z } from 'zod';

/** Turn-taking modes the interaction engine reasons over. */
export const InteractionMode = z.enum(['instruct', 'call_response', 'free', 'hold']);
export type InteractionMode = z.infer<typeof InteractionMode>;

/** Delivery modality of a coaching process / journey. */
export const CoachingModality = z.enum(['voice', 'guided', 'text']);
export type CoachingModality = z.infer<typeof CoachingModality>;

export const ChatThreadState = z.enum(['open', 'closed', 'finalized']);
export type ChatThreadState = z.infer<typeof ChatThreadState>;

export const ChatMessageRole = z.enum(['member', 'assistant', 'system']);
export type ChatMessageRole = z.infer<typeof ChatMessageRole>;

/** How a coaching process emits its output. */
export const CoachingProcessOutputType = z.enum(['doc-approved', 'structured', 'none']);
export type CoachingProcessOutputType = z.infer<typeof CoachingProcessOutputType>;

/** Provenance of a coaching-process definition — the code→authored graduation seam. */
export const CoachingProcessSource = z.enum(['code', 'authored']);
export type CoachingProcessSource = z.infer<typeof CoachingProcessSource>;

/** Member-memory fact tiers + provenance (rule 8 / anti-dependency member editing). */
export const MemberFactTier = z.enum(['durable', 'contextual', 'ephemeral']);
export type MemberFactTier = z.infer<typeof MemberFactTier>;

export const MemberFactSource = z.enum(['ai_extraction', 'member_edit', 'doc_distillation']);
export type MemberFactSource = z.infer<typeof MemberFactSource>;

/** Why the L1 rolling summary was refreshed. */
export const MemberRecentStateReason = z.enum(['turn', 'compaction', 'doc', 'manual']);
export type MemberRecentStateReason = z.infer<typeof MemberRecentStateReason>;

/** Per-tenant member billing mode (ADR-008). Read at metering/enforcement seams only. */
export const MemberBillingMode = z.enum(['absorbed', 'member_credits']);
export type MemberBillingMode = z.infer<typeof MemberBillingMode>;
