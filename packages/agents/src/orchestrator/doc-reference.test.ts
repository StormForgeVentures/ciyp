import { describe, expect, it } from 'vitest';
import { detectMemberDocReference, type MemberDocCue } from './doc-reference.js';

/**
 * The deterministic member-doc-reference cue detector. Exact-match (no LLM): the grant
 * path for `read_member_doc`. Doc kinds are the generic platform default set; a tenant
 * can inject its own cue list.
 */
describe('detectMemberDocReference (default generic cue set)', () => {
  it('detects a plan reference (possessive cue)', () => {
    expect(detectMemberDocReference('what is my plan right now')).toBe('plan');
    expect(detectMemberDocReference('refer to the plan we made')).toBe('plan');
  });

  it('detects reflections + journal phrasings', () => {
    expect(detectMemberDocReference('read my reflection from yesterday')).toBe('reflection');
    expect(detectMemberDocReference('pull my journal entry')).toBe('reflection');
  });

  it('detects member notes', () => {
    expect(detectMemberDocReference('what was in my notes')).toBe('member_note');
    expect(detectMemberDocReference('check my saved notes')).toBe('member_note');
  });

  it('is case-insensitive', () => {
    expect(detectMemberDocReference('My Plan, please')).toBe('plan');
  });

  it('honours most-specific-first ordering (plan before note)', () => {
    // both "my plan" and "the notes" appear — plan wins (earlier cue).
    expect(detectMemberDocReference('compare my plan to the notes')).toBe('plan');
  });

  it('returns null when no own-doc is referenced (no false positives)', () => {
    expect(detectMemberDocReference('I feel overwhelmed today')).toBeNull();
    // generic mentions without the possessive/article cue do NOT trigger.
    expect(detectMemberDocReference('planning is an interesting concept')).toBeNull();
    // "a plan" has no possessive/article-own cue → no trigger.
    expect(detectMemberDocReference('do you have a plan for the weekend?')).toBeNull();
    expect(detectMemberDocReference('')).toBeNull();
  });

  it('accepts an injected tenant-specific cue set (opaque doc kinds)', () => {
    const cues: MemberDocCue[] = [
      { kind: 'vision_board', re: /(?:my|your|the)\s+vision\s+board/i },
    ];
    expect(detectMemberDocReference('open my vision board', cues)).toBe('vision_board');
    expect(detectMemberDocReference('what is my plan', cues)).toBeNull(); // default cues not consulted
  });
});
