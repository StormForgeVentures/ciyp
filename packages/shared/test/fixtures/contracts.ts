/**
 * Contract fixtures — one valid + one invalid per contract (prd-001a FR-7).
 * Kept as plain data (not .json files) so tsc validates fixture typos too; the test suite
 * parses each against its schema. Invalid fixtures each violate exactly one field.
 */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// ── 01 Instance Config ────────────────────────────────────────────────────────
export const validInstanceConfig = {
  tenantId: uuid(1),
  configVersion: 14,
  promptSetVersion: 'ps-v14',
  engineBaseUrl: 'https://engine.ciyp.example.com',
  branding: {
    coachDisplayName: 'Luminify Coaching',
    productName: 'Luminify in Your Pocket',
    logoUrl: 'https://cdn.ciyp.example.com/luminify/logo.png',
    themeTokens: { 'color.accent': '#6d28d9' },
  },
  archetypes: [
    {
      id: uuid(10),
      key: 'operator',
      label: 'Operator',
      description: 'Systems-first builder.',
      sort: 1,
    },
  ],
  tiers: [
    { id: uuid(20), key: 'core', label: 'Core', description: 'Full program access.', sort: 1 },
  ],
  journeys: [
    { id: uuid(30), key: 'daily_checkin', label: 'Daily Check-in', modality: 'text', sort: 1 },
  ],
  ui: { voiceEnabled: true, voiceLabel: 'Coach voice', sttEnabled: true },
};

/** Invalid: engineBaseUrl is not a URL (the ADR-001 promotion seam must always parse). */
export const invalidInstanceConfig = {
  ...validInstanceConfig,
  engineBaseUrl: 'not-a-url',
};

// ── 02 Coaching API ───────────────────────────────────────────────────────────
export const validChatTurnRequest = {
  threadId: null,
  input: [{ type: 'text', text: 'How do I price my group program?' }],
  interactionMode: 'free',
  clientMsgId: uuid(40),
};

/** Invalid: clientMsgId (turn idempotency) is not a uuid. */
export const invalidChatTurnRequest = {
  ...validChatTurnRequest,
  clientMsgId: 'not-a-uuid',
};

export const validMessageParts = [
  { type: 'text', text: 'Here is the short answer…' },
  {
    type: 'audio',
    url: 'https://engine.ciyp.example.com/audio/reply-1.mp3',
    durationMs: 5400,
    transcript: 'Here is the short answer…',
  },
  {
    type: 'library_citation',
    resourceId: uuid(50),
    title: 'Pricing Workbook',
    snippet: 'Anchor the offer to the outcome…',
    locator: 'p.12',
  },
  { type: 'process_offer', processKey: 'weekly_review', label: 'Weekly Review', modality: 'guided' },
  { type: 'voice_input_ref', voiceInputId: uuid(60), transcript: 'What about pricing?' },
];

/** Invalid: unknown part kind — the union is CLOSED at v1 (prd-001a AC-5). */
export const unknownKindPart = { type: 'sparkline', points: [1, 2, 3] };

export const validVoiceSessionStartResponse = {
  sessionId: uuid(70),
  transportUrl: 'wss://voice.ciyp.example.com/ws',
  transportToken: 'tok_short_lived_abc123',
};

/** One frame per ChatTurnEvent variant — the SSE wire union (contract 02 §1). */
export const validChatTurnEvents = [
  { event: 'thread', threadId: uuid(41) },
  { event: 'part_delta', partIndex: 0, delta: 'Here is ' },
  {
    event: 'part',
    part: {
      type: 'library_citation',
      resourceId: uuid(50),
      title: 'Pricing Workbook',
      snippet: 'Anchor the offer…',
      locator: 'p.12',
    },
  },
  {
    event: 'message_done',
    messageId: uuid(42),
    parts: [
      { type: 'text', text: 'Here is the short answer…' },
      {
        type: 'process_offer',
        processKey: 'weekly_review',
        label: 'Weekly Review',
        modality: 'guided',
      },
    ],
  },
  { event: 'error', code: 'provider_error', message: 'upstream timeout' },
  { event: 'spend_denied', remainingCredits: 3 },
] as const;

/** Invalid: unknown SSE event kind — the event union is closed at v1 (QA SF-2). */
export const unknownChatTurnEvent = { event: 'typing_indicator', active: true };

// ── 03 Usage Event ────────────────────────────────────────────────────────────
export const validUsageEvent = {
  idempotencyKey: `trace:${uuid(80)}`,
  tenantId: uuid(1),
  memberId: uuid(2),
  traceId: uuid(80),
  feature: 'chat',
  provider: 'openrouter',
  model: 'claude-sonnet-4.6',
  promptTokens: 1200,
  completionTokens: 340,
  units: 0,
  costMicros: 8400,
  occurredAt: '2026-07-02T17:30:00Z',
  spendClass: 'cheap',
};

/** Invalid: negative costMicros (raw cost is nonnegative; honest-zero is legal, negative is not). */
export const invalidUsageEvent = {
  ...validUsageEvent,
  costMicros: -1,
};

// ── 04 Spend Authorization ────────────────────────────────────────────────────
export const validAuthorizeRequest = {
  tenantId: uuid(1),
  feature: 'voice',
  spendClass: 'heavy',
  estimatedCostMicros: 250_000,
};

/** Invalid: unknown spendClass (cheap|heavy routes enforcement — closed enum). */
export const invalidAuthorizeRequest = {
  ...validAuthorizeRequest,
  spendClass: 'medium',
};

export const validAuthorizeResponse = {
  allow: false,
  remainingCredits: 12,
  reason: 'insufficient_balance',
  authToken: null,
};

// ── 05 Entitlement ────────────────────────────────────────────────────────────
export const validEntitlement = {
  memberId: uuid(2),
  tenantId: uuid(1),
  tierKey: 'core',
  status: 'active',
  features: ['voice', 'uploads'],
  currentPeriodEnd: '2026-08-01T00:00:00Z',
  trialEnd: null,
  source: 'stripe',
};

/** Invalid: source must be the literal 'stripe' at v1 ('api' widens additively with 008a FR-9). */
export const invalidEntitlement = {
  ...validEntitlement,
  source: 'paypal',
};
