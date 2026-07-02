/**
 * voiceLinter — Layer-1 brand-voice enforcement. SYNCHRONOUS, no LLM call.
 *
 * Performs:
 *   - em-dash strip / normalization (em-dash and en-dash → ", ")
 *   - present-tense check (flags excessive future/conditional framing)
 *   - hype detection (flags superlative / hype language)
 *   - archetype-name-leak block — the HARD invariant: no archetype name ever reaches
 *     user-facing output. Word-boundary, case-insensitive, against the single
 *     registered-name source (`@ciyp/prompts` `archetypeNames()`, which is empty
 *     until a tenant registers archetypes), supplied via `registeredNames`.
 *
 * Trace contract: voiceLinter RETURNS the block; the caller emits the
 * `voice_linter_block` trace event. `traceData` is a PII-safe descriptor (block kind
 * + position), NOT the full member text.
 *
 * The archetype-name-leak MECHANIC is fully generic: the blocked names are whatever
 * the tenant registered (injected). No coach-named literal appears here.
 */

import type { LinterResult, LinterBlock } from './types.js';

/** Em/en dashes and the surrounding-spaces variants we normalize. */
const EM_DASH_RE = /\s*[—–]\s*/g;

/**
 * Hype / superlative language. Word-boundary, case-insensitive. Deliberately
 * conservative — flags clear hype, not ordinary emphasis.
 */
const HYPE_RE =
  /\b(amazing|incredible|unbelievable|revolutionary|game[- ]?changer|life[- ]?changing|world[- ]?class|cutting[- ]?edge|next[- ]?level|absolutely|literally the best|10x|supercharge|unlock your full potential)\b/gi;

/**
 * Excessive future / conditional framing — present-tense rule. Flags when the text
 * leans on "you will / you'll / you would / someday / one day" framing rather than
 * present-tense, in-the-body language.
 */
const FUTURE_RE = /\b(you will|you'll|you would|you'd|someday|one day|in the future|eventually you)\b/gi;
const FUTURE_THRESHOLD = 2; // 0–1 is fine; 2+ leans too far into the future.

/** Strip/normalize em + en dashes to a comma-space form. */
export function stripEmDashes(text: string): string {
  return text.replace(EM_DASH_RE, ', ');
}

function pos(text: string, re: RegExp): number {
  re.lastIndex = 0;
  const m = re.exec(text);
  return m ? m.index : -1;
}

/**
 * Run the voice linter over assistant text. `registeredNames` is the archetype name
 * list from `@ciyp/prompts` `archetypeNames()` (per-tenant; may be empty).
 */
export function voiceLinter(text: string, registeredNames: string[] = []): LinterResult {
  const blocks: LinterBlock[] = [];

  // 1. Em-dash strip / normalize (a rewrite, not a hard block).
  const rewritten = stripEmDashes(text);
  if (rewritten !== text) {
    blocks.push({
      kind: 'em_dash',
      linter: 'voice',
      hard: false,
      traceData: { kind: 'em_dash', position: pos(text, EM_DASH_RE) },
    });
  }

  // 2. Hype detection (soft — flag for re-prompt).
  const hypePos = pos(rewritten, HYPE_RE);
  if (hypePos !== -1) {
    blocks.push({
      kind: 'hype',
      linter: 'voice',
      hard: false,
      repromptInstruction:
        'Your last reply used hype / superlative language. Rewrite in grounded, plain language without superlatives.',
      traceData: { kind: 'hype', position: hypePos },
    });
  }

  // 3. Present-tense check — excessive future/conditional framing (soft).
  const futureMatches = rewritten.match(FUTURE_RE);
  if (futureMatches && futureMatches.length >= FUTURE_THRESHOLD) {
    blocks.push({
      kind: 'present_tense',
      linter: 'voice',
      hard: false,
      repromptInstruction:
        'Your last reply leaned on future/conditional framing. Rewrite in the present tense, anchored in what is true right now.',
      traceData: { kind: 'present_tense', count: futureMatches.length },
    });
  }

  // 4. Archetype-name-leak — the HARD invariant. Word-boundary, case-insensitive,
  //    against the registered-name source. Multi-word names (e.g. "North Star")
  //    matched with internal whitespace flexibility; possessives ("Sage's") caught;
  //    embedded substrings ("presage") NOT false-positived.
  for (const name of registeredNames) {
    const re = archetypeNameRegex(name);
    const leakPos = pos(rewritten, re);
    if (leakPos !== -1) {
      blocks.push({
        kind: 'archetype_name_leak',
        linter: 'voice',
        hard: true,
        repromptInstruction:
          'Your last reply named an internal archetype. Archetype names must NEVER appear in your output. Rewrite, keeping the tone but removing the name entirely.',
        traceData: { kind: 'archetype_name_leak', position: leakPos },
      });
    }
  }

  // Em-dash normalization is applied in-place (carried in `rewritten`), so an
  // em-dash-only result still PASSES. Any other block (hype, present-tense, or the
  // hard archetype-name leak) fails and triggers the chain's re-prompt loop.
  const pass = blocks.every((b) => b.kind === 'em_dash');

  return { pass, blocks, rewritten };
}

/**
 * Build a word-boundary, case-insensitive matcher for an archetype name. Handles
 * multi-word names ("North Star") and possessives ("Sage's") while NOT matching
 * embedded substrings ("presage" must not match "Sage").
 */
export function archetypeNameRegex(name: string): RegExp {
  // Escape regex metacharacters, then allow flexible internal whitespace.
  const escaped = name
    .trim()
    .split(/\s+/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s+');
  // \b before; after, allow an optional possessive ('s) then a boundary. \b on both
  // ends is what prevents "presage" / "sagelike" false positives.
  return new RegExp(`\\b${escaped}(?:'s)?\\b`, 'i');
}

/**
 * DETERMINISTIC LAST-RESORT FLOOR for the archetype-name invariant: GUARANTEE that no
 * registered archetype name survives in user-facing text, even if the model defied
 * the re-prompt. Removes every registered name (and its possessive form) using the
 * same `archetypeNameRegex` matcher the leak detector uses — so it has the SAME
 * false-positive safety ("presage" / "sagelike" are left untouched) — then tidies the
 * residue so the result isn't visibly broken:
 *   - collapse the doubled whitespace a removal leaves behind
 *   - heal an orphaned " ," / " ." / " 's"
 *   - drop a leading comma/space the removal can strip a sentence down to
 *
 * Unlike `voiceLinter` (which DETECTS + reports a block), this MUTATES the text and is
 * the floor the caller applies only when a hard `archetype_name_leak` block persists.
 */
export function stripArchetypeNames(text: string, registeredNames: string[] = []): string {
  let out = text;
  for (const name of registeredNames) {
    if (!name.trim()) continue;
    // Global, case-insensitive variant of the same matcher — removes EVERY occurrence.
    const re = new RegExp(archetypeNameRegex(name).source, 'gi');
    out = out.replace(re, '');
  }
  return tidyResidue(out);
}

/** Tidy the residue a name removal leaves behind so the text reads cleanly. */
function tidyResidue(text: string): string {
  return text
    // An orphaned possessive left by a removed name ("'s point" → " point").
    .replace(/\s*'s\b/g, '')
    // Whitespace before sentence/clause punctuation ("name , point" → ", point").
    .replace(/\s+([,.;:!?])/g, '$1')
    // Collapse any doubled whitespace a removal opened up.
    .replace(/[ \t]{2,}/g, ' ')
    // Drop a leading comma / punctuation / space the removal stranded.
    .replace(/^[\s,;:]+/, '')
    .trim();
}
