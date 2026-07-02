import { describe, it, expect } from 'vitest';
import { createEmbedder, type VoyageInputType } from '../../src/lib/sport/embedder.js';

/** PRD-002b AC-6: index calls carry input_type `document`, query calls carry `query`. */
describe('embedder — asymmetric input types are structural', () => {
  it('embedForIndex emits input_type=document; embedForQuery emits query', async () => {
    const captured: VoyageInputType[] = [];
    const caller = async (texts: string[], inputType: VoyageInputType) => {
      captured.push(inputType);
      return texts.map(() => new Array(1024).fill(0.1));
    };
    const e = createEmbedder(caller);

    await e.embedForIndex(['a doc', 'another doc']);
    await e.embedForQuery('a query');

    expect(captured).toEqual(['document', 'query']);
  });

  it('there is NO generic embed() — wrong pairing is unrepresentable', () => {
    const e = createEmbedder(async (t) => t.map(() => [1]));
    expect('embed' in e).toBe(false);
    expect(typeof e.embedForIndex).toBe('function');
    expect(typeof e.embedForQuery).toBe('function');
  });

  it('a query embedded as a document would be caught: the captured type mismatches', async () => {
    const captured: VoyageInputType[] = [];
    const e = createEmbedder(async (texts, t) => {
      captured.push(t);
      return texts.map(() => [1]);
    });
    await e.embedForQuery('q');
    // The query leg MUST NOT carry 'document' — assert the correct asymmetry.
    expect(captured).not.toContain('document');
    expect(captured).toEqual(['query']);
  });

  it('embedForIndex short-circuits on empty input (no caller hit)', async () => {
    let called = false;
    const e = createEmbedder(async (t) => {
      called = true;
      return t.map(() => [1]);
    });
    expect(await e.embedForIndex([])).toEqual([]);
    expect(called).toBe(false);
  });
});
