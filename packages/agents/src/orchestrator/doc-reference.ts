/**
 * The DETERMINISTIC member-doc-reference cue detector — the "grant path" for
 * `read_member_doc`. A pure, member-message-only function that decides WHEN the
 * orchestrator pulls a member's own doc on demand, and WHICH kind.
 *
 * DETERMINISTIC BY DESIGN (not classifier-driven): the classifier action set is
 * closed; a doc-read is a cheap, member-scoped, no-fabrication fetch, so a
 * deterministic cue keeps the LLM surface lean and the behavior exact-match testable
 * — and adds NO behavior when no cue is present (the no-block-when-not-invoked
 * parity). The possessive/article guard (`my` / `the` / `your`) keeps generic
 * mentions ("a plan for the weekend") from triggering a read.
 *
 * DE-ENUM: the doc kinds are OPAQUE strings. A generic platform default cue set
 * (plan / reflection / member_note) ships; a tenant with a richer document taxonomy
 * injects its own cue list (kind + regex). No coach-specific doc type is hardcoded.
 */

import type { ReadMemberDocKind } from './tools.js';

/** A possessive/article cue that marks "the member's OWN <doc>" (vs a generic mention). */
const OWN = String.raw`(?:my|your|the|that)\s+(?:own\s+)?`;

/** One cue: an opaque doc-kind + the regex that fires it. */
export interface MemberDocCue {
  kind: ReadMemberDocKind;
  re: RegExp;
}

/**
 * The generic platform-default cue set — MOST SPECIFIC FIRST (the first match wins).
 * Each requires the possessive/article guard so an incidental noun doesn't trigger a
 * read. A tenant with additional doc kinds supplies its own list to
 * `detectMemberDocReference`.
 */
export const DEFAULT_MEMBER_DOC_CUES: ReadonlyArray<MemberDocCue> = [
  { kind: 'plan', re: new RegExp(`${OWN}plan`, 'i') },
  {
    kind: 'reflection',
    re: new RegExp(`${OWN}(?:reflections?|journal(?:\\s+entr(?:y|ies))?)`, 'i'),
  },
  { kind: 'member_note', re: new RegExp(`${OWN}(?:notes?|saved\\s+notes?)`, 'i') },
];

/**
 * Detect whether the member's message references one of their own readable docs and,
 * if so, which kind to read. Returns the FIRST matching kind (most-specific cue
 * first), or `null` when no doc is referenced (⇒ no `read_member_doc` dispatch, no
 * grounding block — the byte-unchanged default). Pure + deterministic.
 *
 * @param cues optional tenant-specific cue set (defaults to the platform generic set)
 */
export function detectMemberDocReference(
  userMessage: string,
  cues: ReadonlyArray<MemberDocCue> = DEFAULT_MEMBER_DOC_CUES,
): ReadMemberDocKind | null {
  const text = (userMessage ?? '').trim();
  if (!text) return null;
  for (const cue of cues) {
    if (cue.re.test(text)) return cue.kind;
  }
  return null;
}
