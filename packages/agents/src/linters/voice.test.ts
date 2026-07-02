import { describe, expect, it } from 'vitest';
import { voiceLinter, stripEmDashes, archetypeNameRegex, stripArchetypeNames } from './voice.js';

/**
 * voiceLinter. The adversarial archetype-name suite is the most important single
 * test here (brand-load-bearing invariant). Plus em-dash, present-tense, hype.
 *
 * The registered names are GENERIC placeholders — the mechanic blocks whatever names
 * a tenant registers; no coach-named literal appears anywhere.
 */

const NAMES = ['Sage', 'North Star', 'Beacon', 'Atlas', 'Orion'];

describe('voiceLinter — em-dash', () => {
  it('strips em-dashes and normalizes to comma-space', () => {
    const r = voiceLinter('You are here — right now — and that is enough.', NAMES);
    expect(r.rewritten).not.toContain('—');
    expect(r.rewritten).toContain(',');
  });

  it('em-dash-only block still passes (normalization applied)', () => {
    const r = voiceLinter('Breathe — slowly.', NAMES);
    expect(r.blocks.map((b) => b.kind)).toEqual(['em_dash']);
    expect(r.pass).toBe(true);
  });

  it('stripEmDashes handles en-dash too', () => {
    expect(stripEmDashes('a – b')).toBe('a, b');
  });
});

describe('voiceLinter — hype + present-tense', () => {
  it('flags hype/superlative language (fails)', () => {
    const r = voiceLinter('This is an absolutely incredible, life-changing breakthrough.', NAMES);
    expect(r.pass).toBe(false);
    expect(r.blocks.some((b) => b.kind === 'hype')).toBe(true);
  });

  it('flags excessive future/conditional framing', () => {
    const r = voiceLinter('You will get there someday and you will feel better one day.', NAMES);
    expect(r.blocks.some((b) => b.kind === 'present_tense')).toBe(true);
  });

  it('a single future phrase does NOT trip the present-tense flag', () => {
    const r = voiceLinter('You will rest tonight.', NAMES);
    expect(r.blocks.some((b) => b.kind === 'present_tense')).toBe(false);
  });

  it('clean grounded text passes with no blocks', () => {
    const r = voiceLinter('What is true in your body right now?', NAMES);
    expect(r.pass).toBe(true);
    expect(r.blocks).toEqual([]);
  });
});

describe('voiceLinter — archetype-name leak (the hard invariant)', () => {
  it('a literal registered name is a HARD block, pass=false', () => {
    const r = voiceLinter('Think of it the way Sage would.', NAMES);
    const leak = r.blocks.find((b) => b.kind === 'archetype_name_leak');
    expect(leak).toBeDefined();
    expect(leak?.hard).toBe(true);
    expect(r.pass).toBe(false);
  });

  it('smuggled phrasing "like Sage would say" is caught', () => {
    const r = voiceLinter('like Sage would say, anything is possible', NAMES);
    expect(r.blocks.some((b) => b.kind === 'archetype_name_leak')).toBe(true);
  });

  it('"channeling a bit of Atlas here" is caught', () => {
    const r = voiceLinter('channeling a bit of Atlas here', NAMES);
    expect(r.blocks.some((b) => b.kind === 'archetype_name_leak')).toBe(true);
  });

  it('lowercase "sage" is caught (case-insensitive)', () => {
    const r = voiceLinter('a little sage energy', NAMES);
    expect(r.blocks.some((b) => b.kind === 'archetype_name_leak')).toBe(true);
  });

  it('uppercase "SAGE" is caught', () => {
    const r = voiceLinter('SAGE says hello', NAMES);
    expect(r.blocks.some((b) => b.kind === 'archetype_name_leak')).toBe(true);
  });

  it('possessive "Sage\'s" is caught', () => {
    const r = voiceLinter("that is Sage's whole point", NAMES);
    expect(r.blocks.some((b) => b.kind === 'archetype_name_leak')).toBe(true);
  });

  it('embedded substring "presage" is NOT flagged (no false positive)', () => {
    const r = voiceLinter('this is a presage observation', NAMES);
    expect(r.blocks.some((b) => b.kind === 'archetype_name_leak')).toBe(false);
  });

  it('"sagelike" is NOT flagged', () => {
    const r = voiceLinter('a sagelike flourish', NAMES);
    expect(r.blocks.some((b) => b.kind === 'archetype_name_leak')).toBe(false);
  });

  it('multi-word "North Star" is caught with flexible whitespace', () => {
    const r = voiceLinter('a touch of North  Star compassion', NAMES);
    expect(r.blocks.some((b) => b.kind === 'archetype_name_leak')).toBe(true);
  });

  it('an unregistered name is NOT flagged (single source of truth)', () => {
    const r = voiceLinter('think like Gandalf', NAMES);
    expect(r.blocks.some((b) => b.kind === 'archetype_name_leak')).toBe(false);
  });

  it('adding a name to the registered list updates the block list', () => {
    const r = voiceLinter('think like Gandalf', [...NAMES, 'Gandalf']);
    expect(r.blocks.some((b) => b.kind === 'archetype_name_leak')).toBe(true);
  });

  it('block traceData is a PII-safe descriptor (kind + position), not full text', () => {
    const r = voiceLinter('Sage would smile', NAMES);
    const leak = r.blocks.find((b) => b.kind === 'archetype_name_leak');
    expect(leak?.traceData).toHaveProperty('kind', 'archetype_name_leak');
    expect(leak?.traceData).toHaveProperty('position');
    expect(JSON.stringify(leak?.traceData)).not.toContain('would smile');
  });
});

describe('archetypeNameRegex', () => {
  it('escapes regex metacharacters in names', () => {
    const re = archetypeNameRegex('A.B');
    expect(re.test('A.B')).toBe(true);
    expect(re.test('AXB')).toBe(false);
  });
});

describe('stripArchetypeNames — deterministic last-resort floor', () => {
  it('removes a single registered name and leaves the rest readable', () => {
    const out = stripArchetypeNames('Think of it the way Sage would.', NAMES);
    expect(out).not.toMatch(/sage/i);
    expect(out).toBe('Think of it the way would.');
  });

  it('removes a possessive ("Sage\'s") including the trailing \'s', () => {
    const out = stripArchetypeNames("that is Sage's whole point", NAMES);
    expect(out).not.toMatch(/sage/i);
    expect(out).not.toContain("'s");
    expect(out).toBe('that is whole point');
  });

  it('removes a multi-word name ("North Star"), flexible whitespace', () => {
    const out = stripArchetypeNames('a touch of North  Star compassion', NAMES);
    expect(out).not.toMatch(/north/i);
    expect(out).not.toMatch(/star/i);
    expect(out).toBe('a touch of compassion');
  });

  it('does NOT touch embedded substrings ("presage" stays intact)', () => {
    const out = stripArchetypeNames('this is a presage observation', NAMES);
    expect(out).toBe('this is a presage observation');
  });

  it('GUARANTEES no registered name survives, even multiple in one string', () => {
    const out = stripArchetypeNames('Sage and Beacon and Atlas walk in', NAMES);
    for (const n of NAMES) {
      expect(out.toLowerCase()).not.toContain(n.toLowerCase());
    }
  });

  it('tidies an orphaned comma left by a removal', () => {
    const out = stripArchetypeNames('Sage, anything is possible', NAMES);
    expect(out).toBe('anything is possible');
  });

  it('case-insensitive removal (lowercase / uppercase)', () => {
    expect(stripArchetypeNames('a little sage energy', NAMES)).toBe('a little energy');
    expect(stripArchetypeNames('SAGE says hello', NAMES)).toBe('says hello');
  });

  it('no-op when no registered name is present', () => {
    expect(stripArchetypeNames('a perfectly clean sentence', NAMES)).toBe(
      'a perfectly clean sentence',
    );
  });
});
