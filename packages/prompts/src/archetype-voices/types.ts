/**
 * Shared shape for an archetype voice fragment. Each tenant-registered archetype is one of
 * these. The `name` field is the single canonical name string the voice linter blocks from
 * user-facing output (`@ciyp/agents` `voiceLinter`).
 */
export interface ArchetypeVoice {
  /** Machine id matching the classifier `archetype_lean` key (opaque tenant string). */
  id: string;
  /** The canonical display name — the string the voice linter blocks. */
  name: string;
  /** One-line voice character. */
  voiceCharacter: string;
  /** When the classifier leans here. */
  leanWhen: string;
  /** The blendable style fragment woven into the persona layer at assembly time. */
  fragment: string;
}
