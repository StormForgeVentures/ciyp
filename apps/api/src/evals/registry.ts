/**
 * Metric set v1 (PRD-002d §4.3), with targets/alerts per feature-classification. Each
 * spec declares its key needs so the runner enforces the key-free posture. Golden sets
 * port from EL-OS where coach-agnostic; Kyle-content fixtures are replaced by
 * Luminify-seed equivalents (this seed's AI-adoption corpus).
 *
 * Key-FREE specs (drift/determinism/plan-fidelity) run and complete with no keys (AC-1);
 * key-gated specs (routing/retrieval/agreement/faithfulness/memory) skip cleanly when the
 * key is absent. The registry always advertises the full target/alert set (AC-2 shape).
 */
import { composeTurnCascade } from '../lib/sport/cascade.js';
import {
  renderPlanMarkdown,
  checkPlanDocumentFidelity,
  type PlanDocumentData,
  type PlanNarrative,
} from '@ciyp/agents';
import type { EvalSpec, EvalOutcome } from './types.js';

const GSV = 'luminify-v1';

/** Deterministic key-free drift check: the cascade composes byte-identically twice. */
const cascadeDeterminism: EvalSpec = {
  metric: 'cascade_determinism',
  feature: 'coaching_chat',
  target: 1.0,
  alert: 1.0,
  needsModelKey: false,
  needsEmbedKey: false,
  goldenSetVersion: GSV,
  async run(): Promise<EvalOutcome> {
    const input = { tenantBrandVoice: 'warm, direct', userContext: 'ctx block' };
    const a = composeTurnCascade(input);
    const b = composeTurnCascade(input);
    const identical = a.composedPromptHash === b.composedPromptHash && a.prompt === b.prompt;
    return { value: identical ? 1 : 0, sampleSize: 1, data: { hash: a.composedPromptHash } };
  },
};

/** Deterministic key-free plan-document fidelity: the renderer reproduces the source data. */
const planDocumentFidelity: EvalSpec = {
  metric: 'plan_document_fidelity',
  feature: 'plan_document',
  target: 1.0,
  alert: 1.0,
  needsModelKey: false,
  needsEmbedKey: false,
  goldenSetVersion: GSV,
  async run(): Promise<EvalOutcome> {
    const data: PlanDocumentData = {
      title: 'AI Adoption Plan',
      summary: 'Adopt AI in your coaching workflow one task at a time.',
      day: 1,
      period_days: 30,
      outcomes: [{ text: 'Automate one repetitive task' }],
      daily_commitments: [{ text: 'Review one AI tool', cadence: 'daily' }],
      check_in_questions: ['What did you automate today?'],
    };
    const narrative: PlanNarrative = { intro: 'Here is your plan.', closing: 'Keep going.' };
    const rendered = renderPlanMarkdown(data, narrative);
    // Deterministic fidelity gate from the pure renderer: 1.0 iff nothing missing/fabricated.
    const fidelity = checkPlanDocumentFidelity(data, rendered.markdown);
    return { value: fidelity.score, sampleSize: 1, data: { missing: fidelity.missing } };
  },
};

/** Key-gated placeholders (real judged evals): they SELF-SKIP without the required key,
 *  so a keyless run reports `skipped` (never a fabricated pass). The judged implementation
 *  is the EL-OS harness port; these carry the v1 targets/alerts so the snapshot shape is
 *  complete and the runner's key-gating is exercised end-to-end. */
function keyGated(
  metric: string,
  feature: string,
  target: number,
  alert: number,
  keys: { model?: boolean; embed?: boolean },
): EvalSpec {
  return {
    metric,
    feature,
    target,
    alert,
    needsModelKey: !!keys.model,
    needsEmbedKey: !!keys.embed,
    goldenSetVersion: GSV,
    async run(ctx): Promise<EvalOutcome | null> {
      // Without the required key the runner won't call run(); this guard is defense in
      // depth (a spec returning null self-skips — the "clean absence" contract).
      if ((keys.model && !ctx.hasModelKey) || (keys.embed && !ctx.hasEmbedKey)) return null;
      // The judged/retrieval implementation lands with the EL-OS harness port; until then
      // it self-skips rather than fabricate a score.
      return null;
    },
  };
}

/** The full v1 metric set (targets/alerts from feature-classification). */
export const EVAL_REGISTRY: readonly EvalSpec[] = [
  cascadeDeterminism,
  planDocumentFidelity,
  keyGated('routing_accuracy', 'coaching_chat', 0.9, 0.85, { model: true }),
  keyGated('retrieval_precision_library', 'library', 0.7, 0.4, { embed: true }),
  keyGated('agreement_rate', 'coaching_chat', 0.5, 0.3, { model: true }),
  keyGated('interaction_mode_correctness', 'coaching_chat', 0.9, 0.8, { model: true }),
  keyGated('member_memory_continuity', 'coaching_chat', 1.0, 1.0, { model: true }),
  keyGated('faithfulness', 'coaching_chat', 0.95, 0.8, { model: true }),
];
