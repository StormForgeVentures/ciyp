/**
 * Eval harness types (PRD-002d §4.2). Key-free posture is structural: a spec declares
 * whether it needs a model / embed key; the runner SKIPS it cleanly when the key is
 * absent (never a false pass). A spec may also self-skip by returning `null`.
 */
import type { CiypScope } from '../lib/sport/scope-resolver.js';

export type MetricStatus = 'ok' | 'alert' | 'blocked' | 'skipped';

export interface EvalContext {
  scope: CiypScope;
  /** Present only when the corresponding key is set (the runner gates on it). */
  hasModelKey: boolean;
  hasEmbedKey: boolean;
  runId: string;
}

export interface EvalOutcome {
  /** The measured value in [0,1], or null when the spec self-skips. */
  value: number | null;
  sampleSize: number;
  /** Set when the metric could not be measured for an environmental reason (e.g. Voyage 429). */
  blockReason?: string;
  /** Extra structured detail persisted on the snapshot row. */
  data?: Record<string, unknown>;
}

export interface EvalSpec {
  metric: string;
  feature?: string;
  /** Alert/target thresholds (002d §4.2). value < alert ⇒ status `alert`. */
  target: number;
  alert: number;
  needsModelKey: boolean;
  needsEmbedKey: boolean;
  goldenSetVersion: string;
  run(ctx: EvalContext): Promise<EvalOutcome | null>;
}

export interface EvalResult {
  metric: string;
  feature?: string;
  status: MetricStatus;
  value: number | null;
  target: number;
  alert: number;
  sampleSize: number;
  blockReason?: string;
  goldenSetVersion: string;
  data?: Record<string, unknown>;
}

/** Detect a Voyage/provider rate-limit so a blocked run never reports a pass (AC-6). */
export function isRateLimit(err: unknown): boolean {
  const msg = (err as Error)?.message ?? String(err);
  return /\b429\b|rate.?limit|too many requests/i.test(msg);
}
