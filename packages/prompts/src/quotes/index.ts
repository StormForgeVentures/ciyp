/**
 * The aphorism loader (the playfulness corpus) — MACHINERY ONLY.
 *
 * The loader reads whatever is in `QUOTE_CORPUS`; this is a content corpus, NOT engine
 * logic — extending it requires zero code change. It SHIPS EMPTY: the tenant's aphorism set
 * is per-tenant content (the seed / provisioning backfills it). No coach content ships here.
 *
 * These deploy ONLY when the playfulness linter permits (eligible state AND under the
 * per-thread frequency cap). NEVER in distress.
 */

export interface Quote {
  id: string;
  text: string;
  /** Optional soft-bias lens key(s) — an OPAQUE tenant string. Absent = lens-neutral. */
  frame?: string[];
  placeholder: boolean;
}

/**
 * The aphorism corpus. SHIPS EMPTY — the tenant's aphorisms land here via the seed /
 * provisioning. The voice linter remains the guardrail.
 */
export const QUOTE_CORPUS: readonly Quote[] = [];

/** Sample up to `n` quotes. Only called when playfulness is permitted. */
export function sampleQuotes(n: number): Quote[] {
  return QUOTE_CORPUS.slice(0, Math.max(0, n));
}

/** True while every entry is still a placeholder. */
export function quotesArePlaceholder(): boolean {
  return QUOTE_CORPUS.every((q) => q.placeholder);
}
