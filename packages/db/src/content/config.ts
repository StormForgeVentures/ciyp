// Luminify default-tenant config rows (ADR-002: coach-variable surface = data, not
// code). Values are REAL in shape; archetype/tier COPY is provisional placeholder
// (OQ-2 — Tim authors final content at provision time). The model_routing slot map
// covers every ai-architecture §2 slot key.

export const LUMINIFY = {
  slug: 'luminify',
  displayName: 'Luminify',
} as const;

// ai-architecture §2 slot map. LLM slots route via OpenRouter; embed/rerank = Voyage;
// stt = Deepgram; tts = Fish-audio (voice_id is per-coach config — provisional here).
export const MODEL_ROUTING = {
  default: { provider: 'openrouter', model: 'anthropic/claude-sonnet-4.6' },
  fast: { provider: 'openrouter', model: 'anthropic/claude-haiku-4.5' },
  classify: { provider: 'openrouter', model: 'anthropic/claude-haiku-4.5' },
  deep: { provider: 'openrouter', model: 'anthropic/claude-opus-4.1' },
  worker: { provider: 'openrouter', model: 'anthropic/claude-haiku-4.5' },
  synthesis: { provider: 'openrouter', model: 'anthropic/claude-sonnet-4.6' },
  vision: { provider: 'openrouter', model: 'anthropic/claude-sonnet-4.6' },
  // embed model matches the vectors actually written to member_facts/library_chunks
  // (voyage-3-large @ 1024-dim, operator-verified). input_type is set per call.
  embed: { provider: 'voyage', model: 'voyage-3-large', output_dimension: 1024 },
  rerank: { provider: 'voyage', model: 'rerank-2.5' },
  stt: { provider: 'deepgram', model: 'nova-3' },
  // voice_id is the per-coach Fish-audio persona (ADR-002). Provisional slot value —
  // the coach's actual clone id is written at provisioning (OQ-2).
  tts: { provider: 'fish-audio', voice_id: 'fish-en-default-warm-01', model: 'speech-1.6' },
} as const;

export const BRANDING = {
  primary_color: '#4C6EF5',
  accent_color: '#12B886',
  wordmark: 'Luminify',
  tagline: 'Helping coaches become AI-enabled software companies.',
} as const;

// 4 archetypes (non-empty prompt_fragment each). Generic operator/builder/connector
// + a reflective-practitioner archetype that exercises the journaling/memory path
// (decision #18). Provisional copy (OQ-2).
export interface ArchetypeSeed {
  key: string;
  label: string;
  description: string;
  prompt_fragment: string;
  sort: number;
}

export const ARCHETYPES: ArchetypeSeed[] = [
  {
    key: 'operator',
    label: 'The Operator',
    description:
      'Runs a going concern. Wants AI to remove operational drag without breaking what already works.',
    prompt_fragment:
      'This member is an Operator: they run a real business with real revenue and little slack. ' +
      'Anchor advice in their existing workflows; prefer small reversible automations over rebuilds. ' +
      'Lead with the operational cost of the status quo, then the smallest AI change that removes it.',
    sort: 0,
  },
  {
    key: 'builder',
    label: 'The Builder',
    description:
      'Ships product. Comfortable in tools, wants leverage on velocity and quality, not hand-holding.',
    prompt_fragment:
      'This member is a Builder: technically fluent and shipping. Skip the basics. ' +
      'Push on architecture, evaluation, and where AI-assisted code earns or loses trust. ' +
      'Challenge them to measure velocity and defect rate, not just vibes.',
    sort: 1,
  },
  {
    key: 'connector',
    label: 'The Connector',
    description:
      'Grows through relationships and audience. Wants AI to scale their voice, not replace it.',
    prompt_fragment:
      'This member is a Connector: their edge is trust and audience. ' +
      'Frame AI as leverage on their voice — drafting, repurposing, research — never as a ghostwriter that flattens it. ' +
      'Protect authenticity; every automation must survive their audience noticing it.',
    sort: 2,
  },
  {
    key: 'reflective_practitioner',
    label: 'The Reflective Practitioner',
    description:
      'Grows through deliberate reflection. Uses journaling and review to compound judgment over time.',
    prompt_fragment:
      'This member is a Reflective Practitioner: they think by writing and reviewing. ' +
      'Draw the thread between what they logged before and what they face now; cite their own past reflections back to them. ' +
      'Favor questions that surface a pattern over answers that close it.',
    sort: 3,
  },
];

// 3 tiers (generic placeholders — NOT the donor coach's tier names). entitlements_jsonb
// carries the stacked-config grants (ADR-008 non-preclusion).
export interface TierSeed {
  key: string;
  label: string;
  description: string;
  entitlements_jsonb: Record<string, unknown>;
  sort: number;
}

export const TIERS: TierSeed[] = [
  {
    key: 'spark',
    label: 'Spark',
    description: 'Entry tier — core coaching chat, library access, daily reflection cadence.',
    entitlements_jsonb: { skus: ['coaching_chat', 'library_read', 'daily_reflection'], voice_minutes: 0 },
    sort: 0,
  },
  {
    key: 'build',
    label: 'Build',
    description: 'Adds voice sessions, weekly review, and member memory.',
    entitlements_jsonb: {
      skus: ['coaching_chat', 'library_read', 'daily_reflection', 'weekly_review', 'voice', 'member_memory'],
      voice_minutes: 120,
    },
    sort: 1,
  },
  {
    key: 'scale',
    label: 'Scale',
    description: 'Full access incl. connectors, uploads ingestion, and human coach messaging.',
    entitlements_jsonb: {
      skus: [
        'coaching_chat',
        'library_read',
        'daily_reflection',
        'weekly_review',
        'voice',
        'member_memory',
        'connectors',
        'uploads_ingest',
        'coach_messaging',
      ],
      voice_minutes: 600,
    },
    sort: 2,
  },
];

// 2 process directives (source='code'-shaped, stored as authored rows). A daily
// reflection check-in (the journaling/memory + cadence stressor, decision #18) and a
// weekly review. Directives, NOT per-line scripts (ADR-002 / EL-OS Decision #25).
export interface ProcessSeed {
  key: string;
  title: string;
  directive: string;
  modality: 'voice' | 'guided' | 'text';
  mode_arc: unknown;
  output_type: 'metric_threshold' | 'doc_approved' | 'ai_verified' | 'none';
  exit_condition: unknown;
}

export const PROCESS_DEFINITIONS: ProcessSeed[] = [
  {
    key: 'daily_reflection',
    title: 'Daily Reflection Check-in',
    directive:
      'Run a short daily reflection. Open by reading back one relevant fact from the member’s recent ' +
      'reflections so they feel remembered. Ask what moved forward since yesterday, what stalled, and ' +
      'what one AI-leverage experiment they will run today. Keep it under ten exchanges. Extract at most ' +
      'three durable facts (commitments, blockers, wins) for memory. Never lecture; mirror and sharpen. ' +
      'Close by naming the single next action in the member’s own words.',
    modality: 'text',
    mode_arc: [{ mode: 'free', purpose: 'reflect' }, { mode: 'call_response', purpose: 'commit' }],
    output_type: 'ai_verified',
    exit_condition: { kind: 'ai_verified', signal: 'next_action_named' },
  },
  {
    key: 'weekly_review',
    title: 'Weekly Review',
    directive:
      'Facilitate a weekly review. Pull the week’s daily reflections and check-ins and summarize the ' +
      'arc: momentum, drift, and the gap between intention and action. Ground every observation in a ' +
      'specific logged moment. Then co-author at most three commitments for the coming week, each with a ' +
      'concrete AI-leverage angle. Escalate to a red flag if the member reports the same blocker three ' +
      'weeks running. Produce a short written recap the member approves before exit.',
    modality: 'guided',
    mode_arc: [
      { mode: 'instruct', purpose: 'summarize' },
      { mode: 'free', purpose: 'interpret' },
      { mode: 'call_response', purpose: 'commit' },
    ],
    output_type: 'doc_approved',
    exit_condition: { kind: 'doc_approved', doc: 'weekly_recap' },
  },
];
