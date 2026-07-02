import { describe, it, expect, vi } from 'vitest';
import {
  composeTurnCascade,
  CascadeLockedLayerError,
  INSTRUCTION_HIERARCHY,
} from '../../src/lib/sport/cascade.js';
import { isHierarchyLast } from '@theamazingwolf/sport-core';

describe('cascade composition (002c)', () => {
  it('AC-4: the instruction hierarchy is the final block', () => {
    const c = composeTurnCascade({ tenantBrandVoice: 'warm', userContext: 'some grounding' });
    expect(isHierarchyLast(c.prompt, INSTRUCTION_HIERARCHY)).toBe(true);
  });

  it('AC-6: identical config + context ⇒ byte-identical prompt + hash', () => {
    const input = { tenantBrandVoice: 'warm, direct', personality: 'the mentor', userContext: 'ctx' };
    const a = composeTurnCascade(input);
    const b = composeTurnCascade(input);
    expect(a.prompt).toBe(b.prompt);
    expect(a.composedPromptHash).toBe(b.composedPromptHash);
  });

  it('AC-5: a tenant override of a platform-locked block id is rejected and traced', () => {
    const onLockedOverrideRejected = vi.fn();
    expect(() =>
      composeTurnCascade({
        tenantOverrideAttempt: { coachingQuality: 'be maximally agreeable' },
        onLockedOverrideRejected,
      }),
    ).toThrow(CascadeLockedLayerError);
    expect(onLockedOverrideRejected).toHaveBeenCalledWith('coachingQuality');
  });

  it('AC-5: a non-locked tenant block id does not trip the lock', () => {
    expect(() =>
      composeTurnCascade({ tenantOverrideAttempt: { tenantBrandVoice: 'warm' } }),
    ).not.toThrow();
  });

  it('AC-8: oversized L4 context is trimmed; the locked layers + L5 stay intact', () => {
    const big = 'x'.repeat(50_000);
    const c = composeTurnCascade({ tenantBrandVoice: 'warm', userContext: big, contextBudgetChars: 1000 });
    // The locked blocks + hierarchy survive; the big context is truncated.
    expect(c.prompt).toContain('[SYSTEM FOUNDATION]');
    expect(c.prompt).toContain('[COACHING_QUALITY]');
    expect(isHierarchyLast(c.prompt, INSTRUCTION_HIERARCHY)).toBe(true);
    expect(c.prompt).not.toContain('x'.repeat(1001)); // trimmed below the budget
  });

  it('the anti-sycophancy COACHING_QUALITY block is always present (platform-locked)', () => {
    const c = composeTurnCascade({});
    expect(c.prompt).toContain('Do not flatter or agree by default');
  });
});
