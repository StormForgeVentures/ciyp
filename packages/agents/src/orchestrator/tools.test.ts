import { describe, expect, it, vi } from 'vitest';
import {
  ToolDispatcher,
  TOOL_NAMES,
  INTERACTION_MODES,
  type ToolSubstrate,
  type ToolExecutors,
} from './tools.js';

/**
 * ToolDispatcher: 7 Zod-validated tools, graceful-empty pre-table, member-scoped,
 * flag_for_review trace, set_interaction_mode enum + trace + hands the mode to the
 * engine (NOT a persisted part). Tool names + doc kinds are the generic manifest.
 */

function makeSubstrate(overrides: Partial<ToolExecutors> = {}) {
  const traces: { eventType: string; memberId?: string | null; data?: Record<string, unknown> }[] = [];
  const modesSet: string[] = [];
  const executors: ToolExecutors = {
    citeLibraryItem: async () => [], // pre-library graceful empty
    lookupMemberContext: async (memberId) => ({ l1Summary: `L1 for ${memberId}`, facts: [], profile: null }),
    getRecentCheckinOutputs: async () => ({ entries: [] }),
    getRecentCoachingOutputs: async () => ({ outputs: [] }),
    readMemberDoc: async () => ({ docs: [] }), // graceful empty by default
    ...overrides,
  };
  const substrate: ToolSubstrate = {
    traceAICall: vi.fn(async (opts) => {
      traces.push({ eventType: opts.eventType, memberId: opts.memberId, data: opts.data });
      return opts.call();
    }),
    executors,
    onSetInteractionMode: async (mode) => {
      modesSet.push(mode);
    },
  };
  return { substrate, traces, modesSet };
}

const ctx = { memberId: 'm1', threadId: 't1', messageId: 'msg1' };

describe('ToolDispatcher', () => {
  it('exposes exactly the stable generic tool set (manifest only grows)', () => {
    expect([...TOOL_NAMES]).toEqual([
      'cite_library_item',
      'lookup_member_context',
      'get_recent_checkin_outputs',
      'get_recent_coaching_outputs',
      'flag_for_review',
      'set_interaction_mode',
      'read_member_doc',
    ]);
  });

  it('cite_library_item returns empty gracefully pre-library (no error)', async () => {
    const { substrate } = makeSubstrate();
    const d = new ToolDispatcher(substrate);
    await expect(d.dispatch('cite_library_item', { query: 'self-trust' }, ctx)).resolves.toEqual([]);
  });

  it('lookup_member_context is member-scoped', async () => {
    const { substrate } = makeSubstrate();
    const d = new ToolDispatcher(substrate);
    const res = await d.dispatch('lookup_member_context', { query: 'who am I' }, ctx);
    expect(res).toMatchObject({ l1Summary: 'L1 for m1' });
  });

  it('get_recent_checkin_outputs + get_recent_coaching_outputs return empty gracefully', async () => {
    const { substrate } = makeSubstrate();
    const d = new ToolDispatcher(substrate);
    await expect(d.dispatch('get_recent_checkin_outputs', {}, ctx)).resolves.toEqual({ entries: [] });
    await expect(d.dispatch('get_recent_coaching_outputs', {}, ctx)).resolves.toEqual({ outputs: [] });
  });

  it('flag_for_review writes a review_handoff_triggered trace', async () => {
    const { substrate, traces } = makeSubstrate();
    const d = new ToolDispatcher(substrate);
    await d.dispatch('flag_for_review', { reason: 'self-harm language' }, ctx);
    expect(traces.some((t) => t.eventType === 'review_handoff_triggered')).toBe(true);
  });

  it('an invalid tool call is rejected before execution', async () => {
    let executed = false;
    const { substrate } = makeSubstrate({
      lookupMemberContext: async () => {
        executed = true;
        return { l1Summary: '', facts: [], profile: null };
      },
    });
    const d = new ToolDispatcher(substrate);
    // `query` is required + min(1); empty string fails Zod.
    await expect(d.dispatch('lookup_member_context', { query: '' }, ctx)).rejects.toThrow();
    expect(executed).toBe(false);
  });

  it('get_recent_coaching_outputs accepts an opaque agent_kind key (de-enum, not a closed enum)', async () => {
    let seen: unknown;
    const { substrate } = makeSubstrate({
      getRecentCoachingOutputs: async (_m, args) => {
        seen = args.agent_kind;
        return { outputs: [] };
      },
    });
    const d = new ToolDispatcher(substrate);
    await d.dispatch('get_recent_coaching_outputs', { agent_kind: 'any_tenant_process' }, ctx);
    expect(seen).toBe('any_tenant_process');
  });

  it('set_interaction_mode validates the enum, traces, hands mode to the engine', async () => {
    const { substrate, traces, modesSet } = makeSubstrate();
    const d = new ToolDispatcher(substrate);
    const res = await d.dispatch('set_interaction_mode', { mode: 'call_response' }, ctx);
    expect(res).toEqual({ mode: 'call_response' });
    expect(traces.some((t) => t.eventType === 'interaction_mode_set')).toBe(true);
    expect(modesSet).toEqual(['call_response']);
  });

  it('set_interaction_mode rejects an out-of-enum mode', async () => {
    const { substrate } = makeSubstrate();
    const d = new ToolDispatcher(substrate);
    await expect(d.dispatch('set_interaction_mode', { mode: 'banter' }, ctx)).rejects.toThrow();
  });

  it('the interaction_mode enum is the closed shared platform set', () => {
    expect([...INTERACTION_MODES]).toEqual(['instruct', 'call_response', 'free', 'hold']);
  });

  it('read_member_doc returns the member-scoped docs and traces memory_recall', async () => {
    let scopedMember: string | null = null;
    const { substrate, traces } = makeSubstrate({
      readMemberDoc: async (memberId, args) => {
        scopedMember = memberId;
        return {
          docs: [
            { id: 'd1', kind: args.kind, title: 'My Plan', body: 'Anchor in steadiness.', updated_at: '2026-06-01T00:00:00Z' },
          ],
        };
      },
    });
    const d = new ToolDispatcher(substrate);
    const res = (await d.dispatch('read_member_doc', { kind: 'plan' }, ctx)) as {
      docs: Array<{ kind: string; body: string }>;
    };
    expect(scopedMember).toBe('m1'); // member-scoped (the dispatch ctx member)
    expect(res.docs[0]).toMatchObject({ kind: 'plan', body: 'Anchor in steadiness.' });
    const trace = traces.find((t) => t.data?.tool === 'read_member_doc');
    expect(trace?.eventType).toBe('memory_recall');
    expect(trace?.data).toMatchObject({ kind: 'plan' });
  });

  it('read_member_doc defaults recent=1 and rejects an empty kind before execution', async () => {
    let executed = false;
    const { substrate } = makeSubstrate({
      readMemberDoc: async (_m, args) => {
        executed = true;
        expect(args.recent).toBe(1); // Zod default applied
        return { docs: [] };
      },
    });
    const d = new ToolDispatcher(substrate);
    // valid call applies the default
    await d.dispatch('read_member_doc', { kind: 'reflection' }, ctx);
    expect(executed).toBe(true);
    // an empty kind fails Zod before the executor runs
    executed = false;
    await expect(d.dispatch('read_member_doc', { kind: '' }, ctx)).rejects.toThrow();
    expect(executed).toBe(false);
  });

  it('read_member_doc rejects recent > 3 before execution', async () => {
    const { substrate } = makeSubstrate();
    const d = new ToolDispatcher(substrate);
    await expect(d.dispatch('read_member_doc', { kind: 'reflection', recent: 4 }, ctx)).rejects.toThrow();
  });

  it('read_member_doc degrades to empty gracefully (default executor)', async () => {
    const { substrate } = makeSubstrate();
    const d = new ToolDispatcher(substrate);
    await expect(d.dispatch('read_member_doc', { kind: 'member_note' }, ctx)).resolves.toEqual({ docs: [] });
  });

  it('every successful tool call is traced', async () => {
    const { substrate, traces } = makeSubstrate();
    const d = new ToolDispatcher(substrate);
    await d.dispatch('get_recent_checkin_outputs', {}, ctx);
    expect(traces.length).toBeGreaterThan(0);
    expect(traces.every((t) => t.memberId === 'm1')).toBe(true);
  });
});
