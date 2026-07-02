/**
 * `runOrchestratorTurn` — the TRANSPORT-AGNOSTIC orchestration callable (the single
 * most load-bearing requirement of the brain).
 *
 * Input: member/thread/turn context + the assembled system prompt + the injected
 * substrate, streamer, classifier wiring, and linter wiring.
 * Output: `{ parts, assistantMessage, classification, linterResult }` — a
 * linter-passed assistant turn + the STORAGE parts for that turn.
 *
 * THIS CALLABLE DOES NOT WRITE TO AN SSE STREAM, SET HTTP HEADERS, OR KNOW ITS
 * TRANSPORT. The SSE handler and the voice path both wrap THIS SAME callable (the
 * drift invariant). Baking transport writes into this cognition is a High finding.
 *
 * The transport observes streamed text via the optional `onTextDelta` sink — a plain
 * callback the callable invokes with text chunks.
 *
 * Flow:
 *   classify() CONCURRENT with the assistant stream → linter chain on the assembled
 *   text (block → one re-prompt for the hard block, then the safe template) → map the
 *   classifier decision to offer parts → return.
 *
 * DE-ENUM: `target` and `agent_kind` are OPAQUE tenant-config strings. The offer PART
 * TYPE is decided by the classifier ACTION (`respond_and_offer_process` → process_offer,
 * `respond_and_offer_utility` → utility_offer); `agent_kind` is the target key
 * verbatim. The donor's hardcoded target→agent_kind map (and dash→underscore rewrite)
 * is dropped — it was a coach-specific artifact.
 */

import type { AgentSubstrate, LlmStreamer } from '../llm/types.js';
import type { ClassifierOutput } from '../classifier/schema.js';
import {
  runLinterChain,
  stripArchetypeNames,
  type LinterChainContext,
  type LinterChainResult,
} from '../linters/index.js';
import type { ToolDispatcher, LibraryCitationResult, MemberDocResult } from './tools.js';
import { detectMemberDocReference } from './doc-reference.js';

/** A member-doc body folded into the turn grounding. */
export interface MemberDocGrounding {
  title?: string;
  body: string;
}

// Storage parts are typed in `@stormforgeventures/ciyp-shared`; we mirror only the
// shapes this callable constructs to avoid a value-import cycle in the pure package.
export interface TextPart {
  type: 'text';
  text: string;
}
export interface ProcessOfferPart {
  type: 'process_offer';
  /** DE-ENUM: an opaque coaching-process key (tenant config). */
  agent_kind: string;
  reasoning: string;
}
export interface UtilityOfferPart {
  type: 'utility_offer';
  /** DE-ENUM: an opaque utility-agent key (tenant config). */
  agent_kind: string;
  reasoning: string;
}
export interface LibraryCitationPart {
  type: 'library_citation';
  library_item_id: string;
  anchor: { kind: 'timestamp' | 'page'; value: number };
  snippet: string;
  title?: string;
}
export type OrchestratorPart =
  | TextPart
  | ProcessOfferPart
  | UtilityOfferPart
  | LibraryCitationPart;

/** The wink-counter wiring the runtime injects. */
export interface WinkCounter {
  /** Current wink count for the thread (feeds the playfulness linter). */
  get: () => Promise<number>;
  /** Increment after a wink is deployed (+ the caller writes wink_deployed). */
  increment: () => Promise<void>;
}

/**
 * The cascade signals the orchestrator learns ONLY after the classifier resolves
 * (concurrent with the stream): the REAL `detected_state`, the `archetype_lean`, and
 * any library citations / member docs from tool dispatch. The runtime injects a
 * re-assembler that re-runs the cascade with these signals so archetype/state shaping
 * + citations are populated on the LIVE turn. `@ciyp/agents` stays pure: it never
 * imports the cascade assembler; it only calls this injected closure.
 */
export interface CascadeSignals {
  detectedState: ClassifierOutput['detected_state'];
  archetypeLean: ClassifierOutput['archetype_lean'];
  libraryCitations?: Array<{ title?: string; snippet: string }>;
  /**
   * The member's OWN doc body/bodies, folded into the turn grounding as a transient
   * `[MEMBER DOCUMENT]` block (NOT persisted). Empty/omitted ⇒ no block.
   */
  memberDocs?: MemberDocGrounding[];
}
export type ReassembleSystemPrompt = (signals: CascadeSignals) => string;

export interface RunOrchestratorTurnInput {
  memberId: string;
  threadId: string;
  messageId?: string | null;
  /** The incoming member message text. */
  userMessage: string;
  /** The pre-assembled system prompt (from the cascade assembler). */
  systemPrompt: string;
  /** The classifier system prompt (from `@ciyp/prompts#buildClassifierPrompt`). */
  classifierPrompt: string;
  /** The working-memory window passed to the classifier as recent turns. */
  recentTurns: Array<{ role: 'member' | 'assistant'; content: string }>;
  /** Injected substrate (`llm`, `getModelSlot`, `traceAICall`). */
  substrate: AgentSubstrate;
  /** The streaming LLM caller (chat slot, resolved by the runtime). */
  streamer: LlmStreamer;
  /** Resolved chat-slot model name (the runtime resolves the slot once). */
  chatModel: string;
  /** Max output tokens for the assistant turn. */
  maxTokens?: number;
  /** Linter wiring (no-shame judge, retention toggle, etc.). */
  linter: Omit<LinterChainContext, 'detectedState' | 'winkCount' | 'archetypeLean'>;
  /** Transport-agnostic text-delta sink (SSE/voice/test). Optional. */
  onTextDelta?: (delta: string) => void;
  /** Wink-counter wiring (optional; default treats count as 0). */
  winkCounter?: WinkCounter;
  /**
   * Injected cascade re-assembler. When supplied, the orchestrator re-flows the system
   * prompt with the classifier's real `detected_state` + `archetype_lean` (+ any
   * tool-dispatched library citations / member docs) before the linter pass. Omitted →
   * the pre-assembled `systemPrompt` is used as-is (back-compat).
   */
  reassembleSystemPrompt?: ReassembleSystemPrompt;
  /**
   * Injected ToolDispatcher. When supplied, the orchestrator dispatches
   * classifier-action-driven tools mid-turn. Each dispatch is already traced inside the
   * dispatcher. Omitted → no tool dispatch (back-compat).
   */
  toolDispatcher?: ToolDispatcher;
}

export interface RunOrchestratorTurnResult {
  /** The STORAGE-variant parts for this assistant turn (text + any offers). */
  parts: OrchestratorPart[];
  /** The final linter-passed assistant text. */
  assistantMessage: string;
  /** The classifier decision (so the transport can drive follow-on UI). */
  classification: ClassifierOutput;
  /** The linter chain result for the final text (for observability). */
  linterResult: LinterChainResult;
}

/**
 * Run one orchestrator turn. Pure-ish: no transport, no DB beyond the injected
 * `traceAICall`. Returns parts + the assistant message.
 */
export async function runOrchestratorTurn(
  input: RunOrchestratorTurnInput,
  classify: (opts: {
    userMessage: string;
    recentTurns: Array<{ role: 'member' | 'assistant'; content: string }>;
    systemPrompt: string;
    substrate: AgentSubstrate;
    memberId?: string | null;
    threadId?: string | null;
    messageId?: string | null;
  }) => Promise<ClassifierOutput>,
): Promise<RunOrchestratorTurnResult> {
  const {
    memberId,
    threadId,
    messageId,
    userMessage,
    systemPrompt,
    classifierPrompt,
    recentTurns,
    substrate,
    streamer,
    chatModel,
    maxTokens,
    onTextDelta,
    winkCounter,
    reassembleSystemPrompt,
    toolDispatcher,
  } = input;

  // 1. classify() CONCURRENT with the assistant stream. The classifier must NOT block
  //    the first text delta — kick both off, await both.
  const classifyPromise = classify({
    userMessage,
    recentTurns,
    systemPrompt: classifierPrompt,
    substrate,
    memberId,
    threadId,
    messageId,
  });

  const streamPromise = substrate.traceAICall<string>({
    eventType: 'model_call',
    modelSlot: 'chat',
    memberId,
    threadId,
    messageId,
    data: { surface: 'orchestrator' },
    call: () =>
      streamer({
        model: chatModel,
        system: systemPrompt,
        user: userMessage,
        temperature: 0.7,
        maxTokens: maxTokens ?? 1024,
        onDelta: onTextDelta,
      }),
  });

  const [classification, rawText] = await Promise.all([classifyPromise, streamPromise]);

  // 2. Tool dispatch — classifier-action-driven, each traced inside the dispatcher.
  //    The library citation is the part-bearing tool; the review flag is control-only.
  //    The member-doc read is a deterministic cue on `userMessage`, INDEPENDENT of the
  //    classifier action. Graceful-empty: a failed/absent retrieval yields no part.
  const { citations, memberDocs } = await dispatchTurnTools(
    classification,
    toolDispatcher,
    userMessage,
    { memberId, threadId, messageId },
  );

  // 3. Re-flow the cascade with the classifier's REAL state/archetype + the citations
  //    + any read member doc. Falls back to the pre-assembled prompt when no
  //    re-assembler is injected (back-compat).
  const effectiveSystemPrompt = reassembleSystemPrompt
    ? reassembleSystemPrompt({
        detectedState: classification.detected_state,
        archetypeLean: classification.archetype_lean,
        libraryCitations: citations.map((c) => ({ title: c.title, snippet: c.snippet })),
        ...(memberDocs.length > 0 ? { memberDocs } : {}),
      })
    : systemPrompt;

  // 4. Linter chain on the assistant text. On a block, run the re-prompt loop (one
  //    rewrite max, then the safe template). Bypassing the chain is a High finding.
  const winkCount = winkCounter ? await winkCounter.get() : 0;
  const finalText = await runLinterPass(
    rawText,
    {
      ...input.linter,
      detectedState: classification.detected_state,
      archetypeLean: classification.archetype_lean,
      winkCount,
      memberId,
      threadId,
      messageId,
    },
    { substrate, chatModel, maxTokens, userMessage, systemPrompt: effectiveSystemPrompt, streamer, onTextDelta },
  );

  // 5. Build the parts: the final text + any offer the classifier asked for + any
  //    library citations. The offer PART TYPE is decided by the classifier ACTION;
  //    `agent_kind` is the opaque target key verbatim (no hardcoded map).
  const parts: OrchestratorPart[] = [{ type: 'text', text: finalText.text }];

  if (classification.target) {
    const agentKind = classification.target;
    const reasoning = classification.reasoning;
    if (classification.action === 'respond_and_offer_process') {
      parts.push({ type: 'process_offer', agent_kind: agentKind, reasoning });
    } else if (classification.action === 'respond_and_offer_utility') {
      parts.push({ type: 'utility_offer', agent_kind: agentKind, reasoning });
    }
  }

  for (const c of citations) {
    parts.push({
      type: 'library_citation',
      library_item_id: c.library_item_id,
      anchor: c.anchor,
      snippet: c.snippet,
      ...(c.title ? { title: c.title } : {}),
    });
  }

  return {
    parts,
    assistantMessage: finalText.text,
    classification,
    linterResult: finalText.result,
  };
}

/**
 * Dispatch this turn's tools. Returns the library citations (the only part-bearing
 * tool) AND any read member-doc bodies (grounding-only, no part):
 *   - `respond_and_flag_review` → `flag_for_review` (control-only, no part);
 *   - `respond_and_offer_library` → `cite_library_item` (classifier `search_terms`);
 *   - a deterministic member-doc cue on `userMessage` → `read_member_doc`
 *     (INDEPENDENT of the classifier action — a member can reference their doc on any turn).
 * No dispatcher injected → no tools (back-compat). Every dispatch is traced inside the
 * dispatcher; a failure degrades to empty (never errors the turn).
 */
async function dispatchTurnTools(
  classification: ClassifierOutput,
  dispatcher: ToolDispatcher | undefined,
  userMessage: string,
  ctx: { memberId: string; threadId?: string | null; messageId?: string | null },
): Promise<{ citations: LibraryCitationResult[]; memberDocs: MemberDocGrounding[] }> {
  if (!dispatcher) return { citations: [], memberDocs: [] };

  // The member-doc read runs on EVERY action (deterministic cue), so it composes with
  // the classifier-action tools below rather than short-circuiting them.
  const memberDocs = await dispatchMemberDocRead(dispatcher, userMessage, ctx);

  if (classification.action === 'respond_and_flag_review') {
    try {
      await dispatcher.dispatch(
        'flag_for_review',
        { reason: classification.reasoning },
        ctx,
      );
    } catch {
      // Review flag is best-effort observability; never error the turn.
    }
    return { citations: [], memberDocs };
  }

  if (classification.action === 'respond_and_offer_library') {
    try {
      const result = (await dispatcher.dispatch(
        'cite_library_item',
        {
          // The dense leg embeds `query`; the sparse leg fuses `search_terms`.
          query: classification.search_terms?.join(' ') || classification.reasoning,
          search_terms: classification.search_terms,
        },
        ctx,
      )) as LibraryCitationResult[];
      return { citations: Array.isArray(result) ? result : [], memberDocs };
    } catch {
      // Graceful-empty: pre-library / retrieval failure → no citation part.
      return { citations: [], memberDocs };
    }
  }

  return { citations: [], memberDocs };
}

/**
 * Dispatch `read_member_doc` when the member's message references one of their own docs
 * (deterministic cue). Returns the doc bodies for the transient `[MEMBER DOCUMENT]`
 * grounding block, or `[]` (no cue / absent / no RLS client / failure — graceful-empty).
 */
async function dispatchMemberDocRead(
  dispatcher: ToolDispatcher,
  userMessage: string,
  ctx: { memberId: string; threadId?: string | null; messageId?: string | null },
): Promise<MemberDocGrounding[]> {
  const kind = detectMemberDocReference(userMessage);
  if (!kind) return [];
  try {
    const result = (await dispatcher.dispatch(
      'read_member_doc',
      { kind },
      ctx,
    )) as MemberDocResult;
    return (result?.docs ?? []).map((d) => ({ title: d.title, body: d.body }));
  } catch {
    return [];
  }
}

/** True iff the result still carries a hard archetype-name-leak block. */
function hasArchetypeLeak(result: LinterChainResult): boolean {
  return result.blocks.some((b) => b.kind === 'archetype_name_leak' && b.hard);
}

/**
 * Run the linter chain, then the bounded re-prompt loop. The chain returns blocks +
 * re-prompt instructions; THIS function re-prompts the LLM at most ONCE for a HARD
 * block carrying a re-prompt instruction — covering the no-shame block AND the
 * archetype-name leak. It then accepts the safe-template substitution the chain carries
 * in `finalText`.
 *
 * LAST-RESORT FLOOR: the archetype-name invariant is absolute. If, after the chain (and
 * any re-prompt re-run), a hard `archetype_name_leak` block STILL persists, we
 * deterministically strip every registered name so the name can NEVER reach the wire.
 */
async function runLinterPass(
  text: string,
  ctx: LinterChainContext,
  llm: {
    substrate: AgentSubstrate;
    chatModel: string;
    maxTokens?: number;
    userMessage: string;
    systemPrompt: string;
    streamer: LlmStreamer;
    onTextDelta?: (delta: string) => void;
  },
): Promise<{ text: string; result: LinterChainResult }> {
  const first = await runLinterChain(text, ctx);
  if (first.pass) {
    return { text: first.finalText, result: first };
  }

  // A HARD block carrying a re-prompt instruction → ONE LLM rewrite, then re-run the
  // chain in `isReprompt` mode. The chain runs voice FIRST, so a hard archetype-name
  // leak is prioritized over a later no-shame block.
  const repromptBlock = first.blocks.find((b) => b.hard && b.repromptInstruction);
  if (repromptBlock?.repromptInstruction) {
    const rewritten = await llm.substrate.traceAICall<string>({
      eventType: 'model_call',
      modelSlot: 'chat',
      memberId: ctx.memberId,
      threadId: ctx.threadId,
      messageId: ctx.messageId,
      data: { surface: 'orchestrator', reprompt: true },
      call: () =>
        llm.streamer({
          model: llm.chatModel,
          system: `${llm.systemPrompt}\n\n[REWRITE INSTRUCTION]\n${repromptBlock.repromptInstruction}`,
          user: llm.userMessage,
          temperature: 0.7,
          maxTokens: llm.maxTokens ?? 1024,
          // Re-prompt output is NOT re-streamed to the transport.
        }),
    });
    const second = await runLinterChain(rewritten, { ...ctx, isReprompt: true });
    // Deterministic floor: if the re-prompt STILL named an archetype, strip it.
    const finalText = hasArchetypeLeak(second)
      ? stripArchetypeNames(second.finalText, ctx.registeredArchetypeNames)
      : second.finalText;
    return { text: finalText, result: second };
  }

  // Non-reprompt blocks (voice em-dash normalization, playfulness) — the chain's
  // finalText already carries any normalization/substitution. Accept it.
  return { text: first.finalText, result: first };
}
