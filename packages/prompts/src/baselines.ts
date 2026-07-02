/**
 * Prompt-version baselines — the single registry of every VERSIONED prompt block.
 *
 * Why a registry + injection: `recordPromptVersion()` lives in the runtime and needs DB +
 * service role + `changedByAdminId`. `@ciyp/prompts` is a pure library and must not import
 * the runtime. So this package DECLARES the baselines here; the runtime calls
 * `registerPromptBaselines(recordPromptVersion, { changedByAdminId })` at boot to write the
 * rows. Tests inject a mock `recordPromptVersion` and assert it is invoked once per
 * versioned block.
 *
 * VERSIONED: platform (Layer 1), tenant (Layer 2), coach personas (Layer 3), coach default
 * prompts, routing classifier prompt. NOT versioned (live in git): the runtime Layer-4
 * fragments (state fragments, question/quote samples) and the instruction-hierarchy scaffold.
 */

import { CLASSIFIER_PROMPT_BASELINE } from './classifier.js';
import { LANGUAGE_SIGNAL_PROMPT_BASELINE } from './language-signal.js';
import { NO_SHAME_JUDGE_PROMPT_BASELINE } from './no-shame-prompt.js';
import {
  DOC_DISTILL_ESSENCE_BLOCK_ID,
  DOC_DISTILL_ESSENCE_PROMPT_BASELINE,
  DOC_DISTILL_INSIGHTS_BLOCK_ID,
  DOC_DISTILL_INSIGHTS_PROMPT_BASELINE,
  DOC_DISTILL_LAYER,
} from './doc-distill-prompt.js';
import { VOICE_RULES_BLOCK } from './voice-rules.js';
import { RETENTION_BLOCK } from './retention.js';
import { ORCHESTRATOR_PERSONA_BLOCK } from './orchestrator.js';

export type PromptCascadeLayer = 'platform' | 'tenant' | 'coach' | 'routing';

export interface PromptBaseline {
  layer: PromptCascadeLayer;
  agentKind?: string;
  blockId: string;
  content: string;
  changeRationale: string;
}

/** Every versioned prompt block this package ships, with its baseline metadata. */
export const PROMPT_BASELINES: readonly PromptBaseline[] = [
  {
    layer: 'routing',
    blockId: 'routing-classifier',
    content: CLASSIFIER_PROMPT_BASELINE,
    changeRationale:
      'v1 baseline — the platform routing-classifier prompt: "respond" is the strong default; process/utility/review/library offers gate on member INTENT + acuity, not detected_state membership alone. Targets and archetype leans are opaque tenant keys (de-enum). No model name, no TS routing logic.',
  },
  {
    layer: 'routing',
    blockId: 'language-signal-scan',
    content: LANGUAGE_SIGNAL_PROMPT_BASELINE,
    changeRationale: 'v1 baseline — the continuous 9-state language-signal scan prompt.',
  },
  {
    layer: 'platform',
    blockId: 'no-shame-judge',
    content: NO_SHAME_JUDGE_PROMPT_BASELINE,
    changeRationale:
      'v1 baseline — the no-shame judge. SCORE-ONLY output ({ "score" }) so the JSON cannot self-truncate under the maxTokens cap; the linter consumes only `score`.',
  },
  {
    layer: 'platform',
    blockId: 'voice-rules',
    content: VOICE_RULES_BLOCK,
    changeRationale: 'v1 baseline — the Layer-1 voice rules block.',
  },
  {
    layer: 'platform',
    blockId: 'retention-pillars',
    content: RETENTION_BLOCK,
    changeRationale: 'v1 baseline — the three retention pillars.',
  },
  {
    layer: 'coach',
    agentKind: 'orchestrator',
    blockId: 'orchestrator-persona',
    content: ORCHESTRATOR_PERSONA_BLOCK,
    changeRationale: 'v1 baseline — the platform Layer-3 orchestrator persona placeholder (tenant persona composed around it).',
  },
  {
    layer: DOC_DISTILL_LAYER,
    blockId: DOC_DISTILL_ESSENCE_BLOCK_ID,
    content: DOC_DISTILL_ESSENCE_PROMPT_BASELINE,
    changeRationale:
      'v1 baseline — the fast-slot identity-document core-pin essence extractor. The faithfulness eval over this prompt is a downstream obligation (no eval, no ship).',
  },
  {
    layer: DOC_DISTILL_LAYER,
    blockId: DOC_DISTILL_INSIGHTS_BLOCK_ID,
    content: DOC_DISTILL_INSIGHTS_PROMPT_BASELINE,
    changeRationale:
      'v1 baseline — the fast-slot process-output insight distiller (≤2 facts). The faithfulness eval over this prompt is a downstream obligation (no eval, no ship).',
  },
];

/** The minimal `recordPromptVersion` signature the runtime injects. */
export type RecordPromptVersion = (opts: {
  layer: PromptCascadeLayer;
  agentKind?: string;
  blockId: string;
  content: string;
  changeRationale: string;
  changedByAdminId: string;
}) => Promise<string>;

/**
 * Write a baseline `prompt_versions` row for every versioned block. Called by the runtime
 * at boot (it owns DB access + the system-admin id). Idempotency / already-baselined
 * detection is the runtime's concern; this package supplies the content.
 */
export async function registerPromptBaselines(
  recordPromptVersion: RecordPromptVersion,
  opts: { changedByAdminId: string },
): Promise<string[]> {
  const ids: string[] = [];
  for (const baseline of PROMPT_BASELINES) {
    const id = await recordPromptVersion({
      layer: baseline.layer,
      agentKind: baseline.agentKind,
      blockId: baseline.blockId,
      content: baseline.content,
      changeRationale: baseline.changeRationale,
      changedByAdminId: opts.changedByAdminId,
    });
    ids.push(id);
  }
  return ids;
}
