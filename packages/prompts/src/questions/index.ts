/**
 * The coaching-question bank loader — MACHINERY ONLY.
 *
 * The loader reads whatever is in `QUESTION_BANK`; this is a content corpus, NOT engine
 * logic — extending it requires zero code change. It SHIPS EMPTY: the tenant's question
 * corpus is per-tenant content (the seed / provisioning backfills it). No coach content
 * ships in this package.
 *
 * v1 usage: verbatim system-prompt inclusion (a sampled subset). RAG when the corpus grows.
 */

export interface CoachingQuestion {
  id: string;
  text: string;
  /** Loose tags so the orchestrator can sample by theme. */
  tags: string[];
  /**
   * Optional soft-bias lens key(s) — an OPAQUE tenant string, never a hard filter and
   * NEVER named to the member. Absent = lens-neutral. The daily selector prefers matching
   * entries but never EXCLUDES neutral ones.
   */
  frame?: string[];
  placeholder: boolean;
}

/**
 * The coaching-question corpus. SHIPS EMPTY — the tenant's questions land here via the seed
 * / provisioning (backfillable content, classifier-gated + linter-checked at runtime).
 */
export const QUESTION_BANK: readonly CoachingQuestion[] = [];

/** Sample up to `n` questions (optionally filtered by tag). Verbatim inclusion. */
export function sampleQuestions(n: number, tag?: string): CoachingQuestion[] {
  const pool = tag ? QUESTION_BANK.filter((q) => q.tags.includes(tag)) : QUESTION_BANK;
  return pool.slice(0, Math.max(0, n));
}

/** True while every entry is still a placeholder (no tenant corpus backfilled yet). */
export function questionsArePlaceholder(): boolean {
  return QUESTION_BANK.every((q) => q.placeholder);
}
