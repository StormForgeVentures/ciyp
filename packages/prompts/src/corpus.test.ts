import { describe, expect, it, vi } from 'vitest';
import {
  ALL_ARCHETYPE_VOICES,
  archetypeNames,
  archetypeVoiceById,
  archetypesArePlaceholder,
  STATE_FRAGMENTS,
  DETECTED_STATES,
  stateFragment,
  QUESTION_BANK,
  sampleQuestions,
  questionsArePlaceholder,
  QUOTE_CORPUS,
  sampleQuotes,
  quotesArePlaceholder,
  VOICE_RULES_BLOCK,
  RETENTION_BLOCK,
  ORCHESTRATOR_PERSONA_BLOCK,
  CLASSIFIER_PROMPT_BASELINE,
  buildClassifierPrompt,
  DEFER_TO_SELF_TARGET_RATE,
  PROMPT_BASELINES,
  registerPromptBaselines,
  type RecordPromptVersion,
} from './index.js';

/**
 * The prompt corpus MACHINERY. Content surfaces ship EMPTY / placeholder (seed backfills);
 * platform blocks are generic (zero coach IP). Baseline recordPromptVersion invoked per
 * versioned block (mocked).
 */

describe('archetype voices (machinery ships empty)', () => {
  it('the registry ships empty — the seed backfills tenant archetypes', () => {
    expect(ALL_ARCHETYPE_VOICES).toHaveLength(0);
    expect(archetypesArePlaceholder()).toBe(true);
  });

  it('archetypeNames() is the single registered-name source — empty until a tenant registers', () => {
    expect(archetypeNames()).toEqual([]);
  });

  it('archetypeVoiceById resolves nothing on the empty registry', () => {
    expect(archetypeVoiceById('anything')).toBeUndefined();
  });
});

describe('state fragments (platform taxonomy)', () => {
  it('one fragment per the 9 signal_kind states', () => {
    expect(DETECTED_STATES).toHaveLength(9);
    for (const s of DETECTED_STATES) {
      expect(STATE_FRAGMENTS[s].length).toBeGreaterThan(0);
      expect(stateFragment(s).length).toBeGreaterThan(0);
    }
  });
});

describe('questions + quotes loaders (ship empty / placeholder)', () => {
  it('question bank ships empty and reports placeholder', () => {
    expect(QUESTION_BANK).toHaveLength(0);
    expect(questionsArePlaceholder()).toBe(true);
    expect(sampleQuestions(2)).toEqual([]);
  });

  it('quote corpus ships empty and reports placeholder', () => {
    expect(QUOTE_CORPUS).toHaveLength(0);
    expect(quotesArePlaceholder()).toBe(true);
    expect(sampleQuotes(2)).toEqual([]);
  });
});

describe('cascade blocks (platform-generic, zero coach IP)', () => {
  it('voice-rules encodes em-dash / present-tense / hype / no-shame / archetype-names-never', () => {
    expect(VOICE_RULES_BLOCK).toContain('em-dash');
    expect(VOICE_RULES_BLOCK).toContain('Present tense');
    expect(VOICE_RULES_BLOCK).toContain('No hype');
    expect(VOICE_RULES_BLOCK).toContain('No shame');
    expect(VOICE_RULES_BLOCK).toContain('Archetype names NEVER appear');
  });

  it('retention encodes the three pillars', () => {
    expect(RETENTION_BLOCK).toContain('Normalize the wall');
    expect(RETENTION_BLOCK).toContain('stay in the game');
    expect(RETENTION_BLOCK).toContain('behavior into identity');
  });

  it('orchestrator persona encodes capabilities + refusals generically (no coach name)', () => {
    expect(ORCHESTRATOR_PERSONA_BLOCK).toContain('coaching companion');
    expect(ORCHESTRATOR_PERSONA_BLOCK).toContain('Never name an internal archetype');
  });

  it('classifier prompt encodes routing rules and hardcodes no model name', () => {
    expect(CLASSIFIER_PROMPT_BASELINE).toContain('respond_and_offer_process');
    expect(CLASSIFIER_PROMPT_BASELINE).toContain('respond_and_defer_to_self');
    expect(CLASSIFIER_PROMPT_BASELINE).toContain('respond_and_flag_review');
    expect(CLASSIFIER_PROMPT_BASELINE.toLowerCase()).not.toContain('claude');
    expect(CLASSIFIER_PROMPT_BASELINE.toLowerCase()).not.toContain('haiku');
  });

  it('defer-to-self rate is a config constant interpolated into the prompt', () => {
    expect(DEFER_TO_SELF_TARGET_RATE).toBeCloseTo(0.1);
    const custom = buildClassifierPrompt({ deferToSelfRate: 0.2 });
    expect(custom).toContain('20%');
  });

  it('classifier prompt interpolates tenant-provided process/utility keys when supplied', () => {
    const custom = buildClassifierPrompt({ processKeys: ['alpha_proc'], utilityKeys: ['beta_util'] });
    expect(custom).toContain('alpha_proc');
    expect(custom).toContain('beta_util');
  });
});

describe('prompt-version baselines', () => {
  it('registry has every versioned block with a non-empty rationale', () => {
    const blockIds = PROMPT_BASELINES.map((b) => b.blockId).sort();
    expect(blockIds).toEqual(
      [
        'doc-distill-essence',
        'doc-distill-insights',
        'language-signal-scan',
        'no-shame-judge',
        'orchestrator-persona',
        'retention-pillars',
        'routing-classifier',
        'voice-rules',
      ].sort(),
    );
    for (const b of PROMPT_BASELINES) {
      expect(b.changeRationale.length).toBeGreaterThan(0);
      expect(b.content.length).toBeGreaterThan(0);
    }
  });

  it('registerPromptBaselines invokes recordPromptVersion once per versioned block', async () => {
    const recordPromptVersion = vi.fn(async (_opts: Parameters<RecordPromptVersion>[0]) => 'uuid');
    const ids = await registerPromptBaselines(recordPromptVersion, {
      changedByAdminId: 'system',
    });
    expect(recordPromptVersion).toHaveBeenCalledTimes(PROMPT_BASELINES.length);
    expect(ids).toHaveLength(PROMPT_BASELINES.length);
    const calls = recordPromptVersion.mock.calls.map((c) => c[0]);
    expect(calls).toContainEqual(
      expect.objectContaining({ layer: 'routing', blockId: 'routing-classifier' }),
    );
    expect(calls).toContainEqual(
      expect.objectContaining({ layer: 'platform', blockId: 'no-shame-judge' }),
    );
  });
});
