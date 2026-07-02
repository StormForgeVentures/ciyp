/**
 * The internal turn entrypoint (PRD-002b §2.5 / module AC-1). Wires the merged pure brain
 * (`@ciyp/agents#runOrchestratorTurn`) through the per-scope Sport assembly:
 *
 *   verified session → resolved scope (GUC fence) → host (assembly cache) → slot resolve
 *   → spend authorize (stub) → query embed + hybrid retrieve → cascade compose → brain
 *   turn (classify ∥ stream → tool dispatch → linter chain) → reply, with EVERY decision
 *   traced under ONE correlation id.
 *
 * PRD-003 wraps this in HTTP/SSE routes; PRD-004's voice service calls it via the internal
 * route. This module is transport-agnostic (no HTTP, no SSE).
 */
import { randomUUID } from 'node:crypto';
import type { SessionHandle } from '@theamazingwolf/sport-core';
import {
  runOrchestratorTurn,
  classify,
  type AgentSubstrate,
  type RunOrchestratorTurnResult,
} from '@ciyp/agents';
import { buildClassifierPrompt } from '@ciyp/prompts';
import { resolveCiypScope, type CiypScope } from './scope-resolver.js';
import { runWithRequestContext } from './request-context.js';
import { createHostCache, type HostCache } from './assembly.js';
import { createTraceAICall } from './trace-sink.js';
import { withTenantReadTx } from './tenant-context.js';
import { retrieveWithClient } from './vector-store.js';
import { composeTurnCascade } from './cascade.js';
import { createOpenRouterCaller, type LlmWiring } from './llm-caller.js';
import { createSpendAuthorizerStub, SpendDeniedError, type SpendAuthorizerStubConfig } from './spend-authorizer.js';
import type { Embedder } from './embedder.js';

// One process-wide host cache (the assembly seam). Overridable per call for tests.
const defaultHostCache = createHostCache();

export interface InternalTurnInput {
  session: SessionHandle;
  userMessage: string;
  threadId: string;
  recentTurns?: Array<{ role: 'member' | 'assistant'; content: string }>;
  /** Injected LLM wiring (default: OpenRouter). Tests inject a mock (no network/spend). */
  llmWiring?: (ctx: { scope: CiypScope; correlationId: string; memberId?: string | null; threadId?: string | null }) => LlmWiring;
  /** Injected embedder (default: the host's). Tests inject a fixture embedder (spend 0). */
  embedder?: Embedder;
  hostCache?: HostCache;
  spendConfig?: SpendAuthorizerStubConfig;
}

export interface InternalTurnResult {
  reply: string;
  correlationId: string;
  classification: RunOrchestratorTurnResult['classification'];
  parts: RunOrchestratorTurnResult['parts'];
  retrievedCount: number;
}

/** Read the tenant config the turn needs (brand voice, process keys). Coach-safe reads. */
async function loadTenantTurnConfig(
  scope: CiypScope,
): Promise<{ brandVoice?: string; processKeys: string[]; archetypeNames: string[] }> {
  return withTenantReadTx(scope, async (client) => {
    const cfg = await client.query(
      `select branding from app_config where tenant_id = $1`,
      [scope.tenantId],
    );
    const branding = (cfg.rows[0]?.branding ?? {}) as { brand_voice?: string };
    const procs = await client.query(
      `select key from coaching_process_definitions where tenant_id = $1 and is_active = true`,
      [scope.tenantId],
    );
    const arch = await client.query(
      `select label from tenant_archetypes where tenant_id = $1`,
      [scope.tenantId],
    );
    return {
      brandVoice: branding.brand_voice,
      processKeys: (procs.rows as { key: string }[]).map((r) => r.key),
      archetypeNames: (arch.rows as { label: string }[]).map((r) => r.label),
    };
  });
}

/** Run one internal coaching turn on the seed. Returns the linter-passed reply + trace correlation id. */
export async function runInternalTurn(input: InternalTurnInput): Promise<InternalTurnResult> {
  const scope = await resolveCiypScope(input.session);
  if (scope.context !== 'member' || !scope.subjectId) {
    throw new Error('runInternalTurn: a member-scoped session is required (subjectId + context=member).');
  }
  const memberId = scope.subjectId;
  const correlationId = randomUUID();
  const hostCache = input.hostCache ?? defaultHostCache;

  return runWithRequestContext({ session: input.session, correlationId }, async () => {
    const host = await hostCache.hostFor(scope);
    const traceAICall = createTraceAICall({ scope, correlationId, feature: 'coaching_chat' });
    const getModelSlot = host.getModelSlot(scope);

    const wiring = (input.llmWiring ?? createOpenRouterCaller)({
      scope,
      correlationId,
      memberId,
      threadId: input.threadId,
    });
    const substrate: AgentSubstrate = { llm: wiring.llm, getModelSlot, traceAICall };

    // 1. Spend authorization (stub) — a deny short-circuits the turn (traced).
    const authorizer = createSpendAuthorizerStub(scope, correlationId, input.spendConfig);
    const auth = await authorizer.authorize({
      tenantId: scope.tenantId,
      feature: 'coaching_chat',
      spendClass: 'heavy',
      estimatedCostMicros: 5000,
    });
    if (!auth.allow) throw new SpendDeniedError(auth.reason);

    // 2. Resolve the chat model (the brain streams on the chat/default slot).
    const chatSlot = await getModelSlot('chat');
    if (!chatSlot) throw new Error('runInternalTurn: chat slot unresolved for tenant.');

    // 3. Query embed + hybrid retrieve (tenant-fenced + in-SQL filter), traced.
    const embedder = input.embedder ?? host.embedder;
    const chunks = await traceAICall({
      eventType: 'retrieval',
      memberId,
      threadId: input.threadId,
      call: async () => {
        const qvec = await embedder.embedForQuery(input.userMessage);
        return withTenantReadTx(scope, (client) =>
          retrieveWithClient(client, scope.tenantId, qvec, input.userMessage, { topK: 5 }),
        );
      },
    });

    // 4. Tenant config → cascade compose (L2 brand voice + L4 retrieved grounding).
    const tcfg = await loadTenantTurnConfig(scope);
    const userContext =
      chunks.length > 0
        ? chunks.map((c, i) => `[${i + 1}] ${c.text}`).join('\n\n')
        : undefined;
    const composed = composeTurnCascade({
      tenantBrandVoice: tcfg.brandVoice,
      userContext,
    });
    const classifierPrompt = buildClassifierPrompt({ processKeys: tcfg.processKeys });

    // 5. Run the brain turn — classify ∥ stream → linter chain → parts.
    const result = await runOrchestratorTurn(
      {
        memberId,
        threadId: input.threadId,
        userMessage: input.userMessage,
        systemPrompt: composed.prompt,
        classifierPrompt,
        recentTurns: input.recentTurns ?? [],
        substrate,
        streamer: wiring.streamer,
        chatModel: chatSlot.model,
        linter: {
          registeredArchetypeNames: tcfg.archetypeNames,
          noShame: { regexOnly: true },
        },
      },
      classify,
    );

    return {
      reply: result.assistantMessage,
      correlationId,
      classification: result.classification,
      parts: result.parts,
      retrievedCount: chunks.length,
    };
  });
}
