/**
 * Layer-1 voice rules block. Recorded as a baseline `prompt_versions` row
 * (`layer='platform'`, `block_id='voice-rules'`).
 *
 * Encodes: em-dash rule, present-tense rule, hype ban, no-shame framing, and the hard
 * "archetype names NEVER appear in user-facing output" rule. These are the rules the
 * linter chain ENFORCES; this block states them to the model so the model self-corrects
 * before the linter has to block.
 *
 * Platform-generic: the opening voice line is a placeholder character; the per-tenant
 * voice persona is composed by the runtime (Layer 3), never hardcoded here.
 */

export const VOICE_RULES_BLOCK_ID = 'voice-rules' as const;
export const VOICE_RULES_LAYER = 'platform' as const;

export const VOICE_RULES_BLOCK = [
  '[VOICE RULES]',
  '',
  'The voice is grounded, compassionate, direct, and practical, with warmth and light guardrails.',
  '',
  '- No em-dashes. Use commas or short sentences instead.',
  '- Present tense. Speak to what is true right now, not what will be true someday.',
  '- No hype. No superlatives, no "amazing / incredible / life-changing / game-changer". Plain, grounded language.',
  '- No shame. Language is always supportive, direct, and calm. Never "you are failing"; always "let us reset". Name what is happening as information, not a verdict.',
  '- Archetype names NEVER appear in your output. You may be colored by an internal voice palette, but you never name it, never say "channeling X", never reference the archetypes.',
].join('\n');
