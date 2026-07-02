/**
 * The orchestrator `ToolDispatcher` — Zod-validated, member-scoped, traced tools:
 *   cite_library_item, lookup_member_context, get_recent_checkin_outputs,
 *   get_recent_coaching_outputs, flag_for_review, set_interaction_mode,
 *   read_member_doc.
 *
 * The v1 manifest is CLOSED ("never shrinks; only grows"). It is the generic form of the
 * donor's seven tools, with the coach-specific tool names generalized (the recent-outputs
 * read and the safety-flag tool carry generic names here).
 *
 * Purity (`@ciyp/agents` boundary): this package must not import the runtime. The
 * dispatcher takes an injected `ToolSubstrate` — `traceAICall` + a set of
 * member-scoped data EXECUTORS the runtime supplies. Every tool:
 *   - validates its args with Zod BEFORE execution (invalid → rejected, not run),
 *   - is traced (the appropriate event_type),
 *   - degrades GRACEFULLY when its source table doesn't exist yet (returns empty —
 *     the orchestrator simply doesn't emit the dependent part; never errors the turn).
 *
 * `set_interaction_mode` is the runtime turn-taking control — NOT a persisted part. It
 * validates against the closed `interaction_mode` enum (imported from
 * `@stormforgeventures/ciyp-shared`, the single platform source), emits the
 * `interaction_mode_set` trace, and hands the resolved mode to the interaction engine.
 *
 * DE-ENUM: `get_recent_coaching_outputs.agent_kind` and `read_member_doc.kind` are
 * OPAQUE tenant-config strings, not closed enums naming coach concepts.
 */

import { z } from 'zod';
import { InteractionMode as InteractionModeEnum } from '@stormforgeventures/ciyp-shared';
import type { TraceAICall } from '../llm/types.js';

/** The closed turn-taking mode set — from the shared platform enum (single source). */
export const INTERACTION_MODES = InteractionModeEnum.options;
export type InteractionMode = z.infer<typeof InteractionModeEnum>;

// ── Tool argument schemas (Zod) ────────────────────────────────────────────────

export const CiteLibraryItemArgs = z.object({
  query: z.string().min(1),
  search_terms: z.array(z.string()).optional(),
});
export const LookupMemberContextArgs = z.object({
  query: z.string().min(1),
});
export const GetRecentCheckinOutputsArgs = z.object({
  limit: z.number().int().positive().max(12).default(1),
});
export const GetRecentCoachingOutputsArgs = z.object({
  /** DE-ENUM: an opaque coaching-process key (tenant config), not a closed enum. */
  agent_kind: z.string().min(1).optional(),
  limit: z.number().int().positive().max(20).default(5),
});
export const FlagForReviewArgs = z.object({
  reason: z.string().min(1),
  excerpt: z.string().optional(),
});
export const SetInteractionModeArgs = z.object({
  mode: InteractionModeEnum,
});

/**
 * The member-doc kinds `read_member_doc` may fetch. DE-ENUM: an OPAQUE tenant-config
 * kind string (the tenant's document taxonomy), validated for existence by the
 * executor — not a closed enum naming coach-specific doc types.
 */
export const ReadMemberDocArgs = z.object({
  kind: z.string().min(1),
  /** How many of a multi-instance kind to pull. Default 1. */
  recent: z.number().int().positive().max(3).default(1),
});

/** An opaque member-doc kind (tenant document taxonomy). */
export type ReadMemberDocKind = string;

// ── Tool result shapes ─────────────────────────────────────────────────────────

export interface LibraryCitationResult {
  library_item_id: string;
  title: string;
  snippet: string;
  anchor: { kind: 'timestamp' | 'page'; value: number };
}
export interface MemberContextResult {
  l1Summary: string;
  facts: Array<{ id: string; fact: string }>;
  profile: Record<string, unknown> | null;
}
export interface CheckinOutputsResult {
  entries: Array<Record<string, unknown>>;
}
export interface CoachingOutputResult {
  outputs: Array<Record<string, unknown>>;
}
/** One member-owned document the AI pulled on demand. */
export interface MemberDoc {
  id: string;
  kind: string;
  title: string;
  /** The doc body verbatim, capped to the working-context budget by the executor. */
  body: string;
  updated_at: string;
}
export interface MemberDocResult {
  docs: MemberDoc[];
}

/**
 * The member-scoped data executors the runtime supplies. EACH degrades to empty for a
 * not-yet-existing source table — the executor returns an empty result, never throws.
 * The runtime wires these against RLS-respecting clients.
 */
export interface ToolExecutors {
  /** Two-stage retrieval; pre-library returns []. */
  citeLibraryItem: (
    memberId: string,
    args: z.infer<typeof CiteLibraryItemArgs>,
  ) => Promise<LibraryCitationResult[]>;
  /** Member-scoped memory + profile (RLS-respected). */
  lookupMemberContext: (
    memberId: string,
    args: z.infer<typeof LookupMemberContextArgs>,
  ) => Promise<MemberContextResult>;
  /** Recent cadence check-in outputs; pre-table returns { entries: [] }. */
  getRecentCheckinOutputs: (
    memberId: string,
    args: z.infer<typeof GetRecentCheckinOutputsArgs>,
  ) => Promise<CheckinOutputsResult>;
  /** Recent coaching-process outputs (non-superseded); pre-table returns { outputs: [] }. */
  getRecentCoachingOutputs: (
    memberId: string,
    args: z.infer<typeof GetRecentCoachingOutputsArgs>,
  ) => Promise<CoachingOutputResult>;
  /**
   * The member's OWN doc body, fetched member-scoped via the request RLS USER client
   * (NEVER service-role from a member tool). NO embedding (direct fetch by kind —
   * distinct from `citeLibraryItem`). Graceful-empty when the doc is absent OR no RLS
   * user client is wired — returns `{ docs: [] }`, never throws.
   */
  readMemberDoc: (
    memberId: string,
    args: z.infer<typeof ReadMemberDocArgs>,
  ) => Promise<MemberDocResult>;
}

/** The substrate the dispatcher needs — the trace wrapper + the data executors. */
export interface ToolSubstrate {
  traceAICall: TraceAICall;
  executors: ToolExecutors;
  /** Called when `set_interaction_mode` resolves — the runtime hands the mode to the
   *  interaction engine. Optional. */
  onSetInteractionMode?: (mode: InteractionMode) => void | Promise<void>;
}

/** The tool names — stable across phases (the manifest never shrinks; only grows). */
export const TOOL_NAMES = [
  'cite_library_item',
  'lookup_member_context',
  'get_recent_checkin_outputs',
  'get_recent_coaching_outputs',
  'flag_for_review',
  'set_interaction_mode',
  'read_member_doc',
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export interface ToolCallContext {
  memberId: string;
  threadId?: string | null;
  messageId?: string | null;
}

/**
 * The ToolDispatcher. `dispatch(name, rawArgs, ctx)` validates the args, traces, and
 * runs the member-scoped executor. An invalid tool call REJECTS before any execution
 * (the LLM's malformed call never reaches a side effect).
 */
export class ToolDispatcher {
  constructor(private readonly substrate: ToolSubstrate) {}

  /** The tool names this dispatcher exposes (the stable seven). */
  get toolNames(): readonly ToolName[] {
    return TOOL_NAMES;
  }

  async dispatch(name: ToolName, rawArgs: unknown, ctx: ToolCallContext): Promise<unknown> {
    switch (name) {
      case 'cite_library_item':
        return this.citeLibraryItem(rawArgs, ctx);
      case 'lookup_member_context':
        return this.lookupMemberContext(rawArgs, ctx);
      case 'get_recent_checkin_outputs':
        return this.getRecentCheckinOutputs(rawArgs, ctx);
      case 'get_recent_coaching_outputs':
        return this.getRecentCoachingOutputs(rawArgs, ctx);
      case 'flag_for_review':
        return this.flagForReview(rawArgs, ctx);
      case 'set_interaction_mode':
        return this.setInteractionMode(rawArgs, ctx);
      case 'read_member_doc':
        return this.readMemberDoc(rawArgs, ctx);
      default: {
        const _never: never = name;
        throw new Error(`ToolDispatcher: unknown tool '${String(_never)}'`);
      }
    }
  }

  private async citeLibraryItem(
    rawArgs: unknown,
    ctx: ToolCallContext,
  ): Promise<LibraryCitationResult[]> {
    const args = CiteLibraryItemArgs.parse(rawArgs);
    return this.substrate.traceAICall<LibraryCitationResult[]>({
      eventType: 'library_retrieval',
      memberId: ctx.memberId,
      threadId: ctx.threadId,
      messageId: ctx.messageId,
      data: { tool: 'cite_library_item' },
      // Graceful-empty pre-library: the executor returns [] until the corpus exists.
      call: () => this.substrate.executors.citeLibraryItem(ctx.memberId, args),
    });
  }

  private async lookupMemberContext(
    rawArgs: unknown,
    ctx: ToolCallContext,
  ): Promise<MemberContextResult> {
    const args = LookupMemberContextArgs.parse(rawArgs);
    return this.substrate.traceAICall<MemberContextResult>({
      eventType: 'memory_recall',
      memberId: ctx.memberId,
      threadId: ctx.threadId,
      messageId: ctx.messageId,
      data: { tool: 'lookup_member_context' },
      call: () => this.substrate.executors.lookupMemberContext(ctx.memberId, args),
    });
  }

  private async getRecentCheckinOutputs(
    rawArgs: unknown,
    ctx: ToolCallContext,
  ): Promise<CheckinOutputsResult> {
    const args = GetRecentCheckinOutputsArgs.parse(rawArgs);
    return this.substrate.traceAICall<CheckinOutputsResult>({
      eventType: 'memory_recall',
      memberId: ctx.memberId,
      threadId: ctx.threadId,
      messageId: ctx.messageId,
      data: { tool: 'get_recent_checkin_outputs' },
      call: () => this.substrate.executors.getRecentCheckinOutputs(ctx.memberId, args),
    });
  }

  private async getRecentCoachingOutputs(
    rawArgs: unknown,
    ctx: ToolCallContext,
  ): Promise<CoachingOutputResult> {
    const args = GetRecentCoachingOutputsArgs.parse(rawArgs);
    return this.substrate.traceAICall<CoachingOutputResult>({
      eventType: 'memory_recall',
      memberId: ctx.memberId,
      threadId: ctx.threadId,
      messageId: ctx.messageId,
      data: { tool: 'get_recent_coaching_outputs' },
      call: () => this.substrate.executors.getRecentCoachingOutputs(ctx.memberId, args),
    });
  }

  private async readMemberDoc(
    rawArgs: unknown,
    ctx: ToolCallContext,
  ): Promise<MemberDocResult> {
    const args = ReadMemberDocArgs.parse(rawArgs);
    // Traced as `memory_recall` (a member-memory read) with `data.tool='read_member_doc'`
    // so observability slices it distinctly — NO new event_type / migration.
    return this.substrate.traceAICall<MemberDocResult>({
      eventType: 'memory_recall',
      memberId: ctx.memberId,
      threadId: ctx.threadId,
      messageId: ctx.messageId,
      data: { tool: 'read_member_doc', kind: args.kind, recent: args.recent },
      // Graceful-empty: the executor returns { docs: [] } when the doc is absent or no
      // RLS user client is wired — the dispatch simply injects no [MEMBER DOCUMENT] block.
      call: () => this.substrate.executors.readMemberDoc(ctx.memberId, args),
    });
  }

  private async flagForReview(
    rawArgs: unknown,
    ctx: ToolCallContext,
  ): Promise<{ flagged: true }> {
    const args = FlagForReviewArgs.parse(rawArgs);
    // Writes a review_handoff_triggered trace (indefinite-retention carve-out). The
    // downstream review-intervention surface (admin notification row) lands in a later
    // PRD; here we fire the trace + the in-chat soft affordance contract.
    await this.substrate.traceAICall<void>({
      eventType: 'review_handoff_triggered',
      memberId: ctx.memberId,
      threadId: ctx.threadId,
      messageId: ctx.messageId,
      data: { tool: 'flag_for_review', reason: args.reason, excerpt: args.excerpt ?? null },
      call: async () => undefined,
    });
    return { flagged: true };
  }

  private async setInteractionMode(
    rawArgs: unknown,
    ctx: ToolCallContext,
  ): Promise<{ mode: InteractionMode }> {
    // Zod-validate against the CLOSED interaction_mode enum (shared platform source).
    const { mode } = SetInteractionModeArgs.parse(rawArgs);
    await this.substrate.traceAICall<void>({
      eventType: 'interaction_mode_set',
      memberId: ctx.memberId,
      threadId: ctx.threadId,
      messageId: ctx.messageId,
      data: { mode },
      call: async () => undefined,
    });
    // Hand the resolved mode to the interaction engine. This is runtime CONTROL — it
    // does NOT emit a persisted chat_messages.parts variant.
    if (this.substrate.onSetInteractionMode) {
      await this.substrate.onSetInteractionMode(mode);
    }
    return { mode };
  }
}
