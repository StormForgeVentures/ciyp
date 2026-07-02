/**
 * Shared linter types. Pure data — no store, no SSE, no Postgres. Kept in their own
 * module so the individual linters and the chain runner import them without a
 * circular dependency.
 *
 * The linter chain is brand-load-bearing for BOTH runtimes (text + voice). It is
 * PURE over text: store-backed values (`winkCount`) are injected, and side effects
 * (trace emission, the re-prompt LLM call) are CALLER-OWNED — the chain returns
 * judgments + re-prompt instructions, never performs them.
 */

import type { DetectedState } from '../classifier/schema.js';

export type { DetectedState } from '../classifier/schema.js';

/** The kinds of block a linter can raise. */
export type LinterBlockKind =
  | 'em_dash'
  | 'present_tense'
  | 'hype'
  | 'archetype_name_leak'
  | 'no_shame'
  | 'playfulness'
  | 'retention';

/** Which linter raised a block. */
export type LinterName = 'voice' | 'no_shame' | 'playfulness' | 'retention';

/**
 * A single block. `hard` blocks must never be emitted as text (e.g. an archetype
 * name leak); the chain re-prompts or substitutes. `repromptInstruction` is the
 * stricter-rewrite text the CALLER feeds back to the LLM — the chain itself never
 * calls the LLM to rewrite. `traceData` is a PII-safe descriptor by default (block
 * kind + position, NOT full member text).
 */
export interface LinterBlock {
  kind: LinterBlockKind;
  linter: LinterName;
  hard: boolean;
  repromptInstruction?: string;
  traceData: Record<string, unknown>;
}

/** A single linter's result over a piece of text. */
export interface LinterResult {
  pass: boolean;
  blocks: LinterBlock[];
  /** A normalized rewrite (e.g. em-dashes stripped) the chain may carry forward. */
  rewritten?: string;
}

/** Context the chain (and individual linters) need — all injected, pure. */
export interface LinterContext {
  detectedState: DetectedState;
  /** Opaque archetype-lean keys active this turn (tenant config). Optional. */
  archetypeLean?: string[];
  /** Injected by the runtime (e.g. per-thread wink counter); pure param here. */
  winkCount: number;
  /** From `@ciyp/prompts` `archetypeNames()` — the single registered-name source. */
  registeredArchetypeNames: string[];
  /** Optional 4th-stage toggle (default documented in `runLinterChain`). */
  runRetentionLinter?: boolean;
  /** The cap for lightness frequency (~1 per 10 turns); default 1 wink/window. */
  winkCap?: number;
  /**
   * Opaque archetype-lean keys that WIDEN the lightness cap by 1 (tenant config).
   * Replaces the donor's hardcoded per-archetype lightness widening — which archetype (if
   * any) widens lightness is per-tenant config, never a coach-named literal. Default: none.
   */
  lightnessWideningLeans?: string[];
}

/** The chain's aggregate result. */
export interface LinterChainResult {
  pass: boolean;
  /** Possibly the safe-template substitution or the em-dash-normalized text. */
  finalText: string;
  blocks: LinterBlock[];
}
