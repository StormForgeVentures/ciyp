import { describe, expect, it, vi } from 'vitest';
import { runOrchestratorTurn, type CascadeSignals } from './run.js';
import { ToolDispatcher, type LibraryCitationResult } from './tools.js';
import type { AgentSubstrate, LlmStreamer, TraceAICall } from '../llm/types.js';
import type { ClassifierOutput } from '../classifier/schema.js';

/**
 * runOrchestratorTurn: concurrent classify+stream, linter-chain-on-output + re-prompt,
 * de-enum offer mapping (action-driven, opaque agent_kind), transport-agnostic shape.
 */

function makeSubstrate(): AgentSubstrate {
  return {
    llm: vi.fn(async () => ''),
    getModelSlot: vi.fn(async () => ({ model: 'test/chat-model' })),
    traceAICall: vi.fn(async (opts) => opts.call()),
  };
}

const baseLinter = {
  registeredArchetypeNames: ['Sage', 'North Star', 'Beacon', 'Atlas', 'Orion'],
};

function baseInput(over: Partial<Parameters<typeof runOrchestratorTurn>[0]> = {}) {
  const substrate = makeSubstrate();
  const streamer: LlmStreamer = async ({ onDelta }) => {
    onDelta?.('Hello, ');
    onDelta?.('how are you?');
    return 'Hello, how are you?';
  };
  return {
    memberId: 'm1',
    threadId: 't1',
    messageId: 'msg1',
    userMessage: 'I feel stuck.',
    systemPrompt: '[SYSTEM]',
    classifierPrompt: '[CLASSIFIER]',
    recentTurns: [],
    substrate,
    streamer,
    chatModel: 'test/chat-model',
    linter: baseLinter,
    ...over,
  };
}

const classifyRespond = async (): Promise<ClassifierOutput> => ({
  action: 'respond',
  archetype_lean: [],
  detected_state: 'focused',
  reasoning: 'general chat',
});

describe('runOrchestratorTurn', () => {
  it('returns { parts, assistantMessage } with no transport coupling', async () => {
    const res = await runOrchestratorTurn(baseInput(), classifyRespond);
    expect(res.assistantMessage).toBe('Hello, how are you?');
    expect(res.parts[0]).toEqual({ type: 'text', text: 'Hello, how are you?' });
  });

  it('runs classify concurrently with the stream (classify does not gate text)', async () => {
    const deltas: string[] = [];
    let streamFinished = false;
    const classify = async () => {
      await new Promise((r) => setTimeout(r, 20));
      expect(streamFinished).toBe(true);
      return classifyRespond();
    };
    const streamer: LlmStreamer = async ({ onDelta }) => {
      onDelta?.('hi');
      streamFinished = true;
      return 'hi';
    };
    await runOrchestratorTurn(
      baseInput({ streamer, onTextDelta: (d) => deltas.push(d) }),
      classify,
    );
    expect(deltas).toEqual(['hi']);
  });

  it('de-enum: action respond_and_offer_process → process_offer with the opaque target as agent_kind', async () => {
    const classify = async (): Promise<ClassifierOutput> => ({
      action: 'respond_and_offer_process',
      target: 'tenant_process_key',
      archetype_lean: [],
      detected_state: 'focused',
      reasoning: 'offer a process',
    });
    const res = await runOrchestratorTurn(baseInput(), classify);
    const offer = res.parts.find((p) => p.type === 'process_offer');
    expect(offer).toMatchObject({ type: 'process_offer', agent_kind: 'tenant_process_key' });
  });

  it('de-enum: action respond_and_offer_utility → utility_offer with the opaque target as agent_kind', async () => {
    const classify = async (): Promise<ClassifierOutput> => ({
      action: 'respond_and_offer_utility',
      target: 'tenant_utility_key',
      archetype_lean: [],
      detected_state: 'dysregulated',
      reasoning: 'offer a utility',
    });
    const res = await runOrchestratorTurn(baseInput(), classify);
    const offer = res.parts.find((p) => p.type === 'utility_offer');
    expect(offer).toMatchObject({ type: 'utility_offer', agent_kind: 'tenant_utility_key' });
  });

  it('assistant text passes through the linter chain (shame → safe template)', async () => {
    const streamer: LlmStreamer = async () => 'You failed again and you are behind.';
    const classify = async (): Promise<ClassifierOutput> => ({
      action: 'respond',
      archetype_lean: [],
      detected_state: 'overwhelmed',
      reasoning: 'x',
    });
    const res = await runOrchestratorTurn(baseInput({ streamer }), classify);
    // After re-prompt (the re-prompted streamer returns the same shame text in this
    // stub), the chain substitutes the safe template (isReprompt second block).
    expect(res.assistantMessage).not.toContain('You failed');
  });

  it('archetype leak in the first draft → reprompt fires AND the returned text is name-free', async () => {
    let call = 0;
    const streamer: LlmStreamer = vi.fn(async () => {
      call += 1;
      return call === 1
        ? 'Think of it the way Sage would.'
        : 'Think of it the way a wise mentor would.';
    });
    const res = await runOrchestratorTurn(baseInput({ streamer }), classifyRespond);
    expect(streamer).toHaveBeenCalledTimes(2); // initial stream + ONE reprompt
    expect(res.assistantMessage).not.toMatch(/sage/i);
    expect(res.assistantMessage).toBe('Think of it the way a wise mentor would.');
  });

  it('persistent leak (reprompt STILL names the archetype) → deterministic strip floor removes it', async () => {
    const streamer: LlmStreamer = vi.fn(async () => 'Channeling a bit of Atlas here.');
    const res = await runOrchestratorTurn(baseInput({ streamer }), classifyRespond);
    expect(streamer).toHaveBeenCalledTimes(2); // initial + reprompt (both leak)
    expect(res.assistantMessage).not.toMatch(/atlas/i);
  });

  it('reads the wink counter for the playfulness linter', async () => {
    const get = vi.fn(async () => 0);
    const streamer: LlmStreamer = async () => 'Steady work today.';
    await runOrchestratorTurn(
      baseInput({ streamer, winkCounter: { get, increment: vi.fn(async () => {}) } }),
      classifyRespond,
    );
    expect(get).toHaveBeenCalled();
  });

  it('re-assembles the system prompt with the classifier detected_state + archetype_lean', async () => {
    const reassemble = vi.fn((s: { detectedState: string }) => `[REASSEMBLED ${s.detectedState}]`);
    const classify = async (): Promise<ClassifierOutput> => ({
      action: 'respond',
      archetype_lean: ['warm_lean'],
      detected_state: 'overwhelmed',
      reasoning: 'state read',
    });
    await runOrchestratorTurn(
      baseInput({ reassembleSystemPrompt: reassemble }),
      classify,
    );
    expect(reassemble).toHaveBeenCalledWith(
      expect.objectContaining({ detectedState: 'overwhelmed', archetypeLean: ['warm_lean'] }),
    );
  });

  function makeDispatcher(citations: LibraryCitationResult[]) {
    const cite = vi.fn(async () => citations);
    const dispatcher = new ToolDispatcher({
      traceAICall: async (opts) => opts.call(),
      executors: {
        citeLibraryItem: cite,
        lookupMemberContext: async () => ({ l1Summary: '', facts: [], profile: null }),
        getRecentCheckinOutputs: async () => ({ entries: [] }),
        getRecentCoachingOutputs: async () => ({ outputs: [] }),
        readMemberDoc: async () => ({ docs: [] }),
      },
    });
    return { dispatcher, cite };
  }

  it('dispatches cite_library_item on respond_and_offer_library and emits a library_citation part', async () => {
    const citation: LibraryCitationResult = {
      library_item_id: 'lib-1',
      title: 'The Editor',
      snippet: 'Your inner critic is just The Editor.',
      anchor: { kind: 'timestamp', value: 42 },
    };
    const { dispatcher, cite } = makeDispatcher([citation]);
    const classify = async (): Promise<ClassifierOutput> => ({
      action: 'respond_and_offer_library',
      archetype_lean: [],
      detected_state: 'focused',
      reasoning: 'wants a resource',
      search_terms: ['inner critic'],
    });
    const res = await runOrchestratorTurn(baseInput({ toolDispatcher: dispatcher }), classify);
    expect(cite).toHaveBeenCalled();
    const part = res.parts.find((p) => p.type === 'library_citation');
    expect(part).toMatchObject({
      type: 'library_citation',
      library_item_id: 'lib-1',
      anchor: { kind: 'timestamp', value: 42 },
    });
  });

  it('feeds dispatched citations into the cascade re-assembler', async () => {
    const citation: LibraryCitationResult = {
      library_item_id: 'lib-1',
      title: 'The Editor',
      snippet: 'Your inner critic is just The Editor.',
      anchor: { kind: 'timestamp', value: 42 },
    };
    const { dispatcher } = makeDispatcher([citation]);
    const reassemble = vi.fn(() => '[REASSEMBLED]');
    const classify = async (): Promise<ClassifierOutput> => ({
      action: 'respond_and_offer_library',
      archetype_lean: [],
      detected_state: 'focused',
      reasoning: 'wants a resource',
      search_terms: ['inner critic'],
    });
    await runOrchestratorTurn(
      baseInput({ toolDispatcher: dispatcher, reassembleSystemPrompt: reassemble }),
      classify,
    );
    expect(reassemble).toHaveBeenCalledWith(
      expect.objectContaining({
        libraryCitations: [{ title: 'The Editor', snippet: 'Your inner critic is just The Editor.' }],
      }),
    );
  });

  function makeDocDispatcher(docs: Array<{ id: string; kind: string; title: string; body: string; updated_at: string }>) {
    let scopedMember: string | null = null;
    const read = vi.fn(async (memberId: string) => {
      scopedMember = memberId;
      return { docs };
    });
    const dispatcher = new ToolDispatcher({
      traceAICall: async (opts) => opts.call(),
      executors: {
        citeLibraryItem: async () => [],
        lookupMemberContext: async () => ({ l1Summary: '', facts: [], profile: null }),
        getRecentCheckinOutputs: async () => ({ entries: [] }),
        getRecentCoachingOutputs: async () => ({ outputs: [] }),
        readMemberDoc: read,
      },
    });
    return { dispatcher, read, getScopedMember: () => scopedMember };
  }

  it('a member-doc reference dispatches read_member_doc and folds the body into the re-generation grounding (member-scoped)', async () => {
    const { dispatcher, read, getScopedMember } = makeDocDispatcher([
      { id: 'd1', kind: 'plan', title: 'My Plan', body: 'Anchor in steadiness.', updated_at: '2026-06-01T00:00:00Z' },
    ]);
    const reassemble = vi.fn(() => '[REASSEMBLED]');
    await runOrchestratorTurn(
      baseInput({
        userMessage: 'can you read my plan back to me?',
        toolDispatcher: dispatcher,
        reassembleSystemPrompt: reassemble,
      }),
      classifyRespond,
    );
    expect(read).toHaveBeenCalled();
    expect(getScopedMember()).toBe('m1'); // member-scoped via the dispatch ctx
    expect(reassemble).toHaveBeenCalledWith(
      expect.objectContaining({
        memberDocs: [{ title: 'My Plan', body: 'Anchor in steadiness.' }],
      }),
    );
  });

  it('NO doc reference ⇒ read_member_doc is never dispatched (byte-unchanged grounding)', async () => {
    const { dispatcher, read } = makeDocDispatcher([
      { id: 'd1', kind: 'plan', title: 'M', body: 'b', updated_at: '2026-06-01T00:00:00Z' },
    ]);
    const reassemble = vi.fn((_s: CascadeSignals) => '[REASSEMBLED]');
    await runOrchestratorTurn(
      baseInput({
        userMessage: 'I feel overwhelmed today',
        toolDispatcher: dispatcher,
        reassembleSystemPrompt: reassemble,
      }),
      classifyRespond,
    );
    expect(read).not.toHaveBeenCalled();
    expect(reassemble).toHaveBeenCalled();
    const signals = reassemble.mock.calls[0]![0];
    expect(signals.memberDocs).toBeUndefined();
  });

  it('emits NO citation part when retrieval returns empty', async () => {
    const { dispatcher } = makeDispatcher([]);
    const classify = async (): Promise<ClassifierOutput> => ({
      action: 'respond_and_offer_library',
      archetype_lean: [],
      detected_state: 'focused',
      reasoning: 'wants a resource',
      search_terms: ['nothing'],
    });
    const res = await runOrchestratorTurn(baseInput({ toolDispatcher: dispatcher }), classify);
    expect(res.parts.some((p) => p.type === 'library_citation')).toBe(false);
  });

  it('dispatches flag_for_review on respond_and_flag_review (control-only, no part)', async () => {
    const cite = vi.fn(async () => [] as LibraryCitationResult[]);
    const reviewTrace = vi.fn(async (opts: Parameters<TraceAICall>[0]) => opts.call());
    const dispatcher = new ToolDispatcher({
      traceAICall: reviewTrace as unknown as TraceAICall,
      executors: {
        citeLibraryItem: cite,
        lookupMemberContext: async () => ({ l1Summary: '', facts: [], profile: null }),
        getRecentCheckinOutputs: async () => ({ entries: [] }),
        getRecentCoachingOutputs: async () => ({ outputs: [] }),
        readMemberDoc: async () => ({ docs: [] }),
      },
    });
    const classify = async (): Promise<ClassifierOutput> => ({
      action: 'respond_and_flag_review',
      archetype_lean: [],
      detected_state: 'overwhelmed',
      reasoning: 'safety concern',
    });
    const res = await runOrchestratorTurn(baseInput({ toolDispatcher: dispatcher }), classify);
    expect(reviewTrace).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'review_handoff_triggered' }),
    );
    expect(res.parts.some((p) => p.type === 'library_citation')).toBe(false);
  });
});
