// Demo members carrying deliberate EDGE SHAPES (PRD-001c FR-6). Content is generic
// Luminify-domain (AI-adoption coaching); no donor-coach identifiers. Each spec is
// pure data — seed/index.ts turns it into rows (members, facts, L1, chat, check-ins,
// uploads, plans, entitlements) + the wallet/usage/trace trail.

export type FactSource = 'agent_tool' | 'auto_extraction' | 'coaching_output' | 'explicit';

export interface FactSpec {
  fact: string;
  tier: 'core' | 'standard';
  source: FactSource;
}

export interface CheckInSpec {
  daysAgo: number;
  energy: number;
  clarity: number;
  execution: number;
  emotionalTag?: 'calm' | 'stressed' | 'overwhelmed' | 'clear' | 'flat' | 'excited';
  freeText?: string;
}

export interface MessageSpec {
  role: 'user' | 'assistant' | 'system';
  parts: unknown[]; // frozen parts union (coaching-api contract §0)
}

export interface ThreadSpec {
  agentKind: string;
  title: string;
  state: 'active' | 'completed' | 'abandoned';
  messages: MessageSpec[];
}

export interface UploadSpec {
  kind: 'journal_text' | 'journal_image' | 'voice_note' | 'attachment';
  storagePath: string;
  transcript?: string;
  transcriptStatus?: 'pending' | 'complete' | 'failed';
}

export interface EntitlementSpec {
  sku: string;
  status: 'active' | 'expired' | 'revoked';
  source: 'stripe_checkout' | 'manual';
  expiresInDays: number | null;
}

export interface PlanSpec {
  stageFocus: string;
  outcomes: string[];
  dailyCommitments: string[];
  signatureQuestions: string[];
  source: 'admin_imported' | 'ai_coauthored' | 'member_authored';
}

export interface MemberSpec {
  key: string;
  email: string;
  displayName: string;
  archetypeKey: string;
  tierKey: string;
  enrollmentStatus: 'active' | 'lapsed';
  edge: string; // which edge shape this member proves
  facts: FactSpec[];
  recentState: string | null; // null → no L1 row (brand-new member)
  checkIns: CheckInSpec[];
  threads: ThreadSpec[];
  uploads: UploadSpec[];
  plan: PlanSpec | null;
  entitlements: EntitlementSpec[];
  usageEvents: number; // metered AI events this member generated
}

const text = (t: string) => [{ type: 'text', text: t }];

// A long transcript to exercise long-string fields (edge shape e).
const LONG_TRANSCRIPT = Array.from(
  { length: 40 },
  (_, i) =>
    `Segment ${i + 1}: I keep circling the same question about whether to automate my onboarding or keep it manual. ` +
    `On one hand the manual version is warmer and I can feel the member; on the other it is eating the hours I wanted AI to give me back. ` +
    `I think the answer is to automate the capture but keep the first human welcome, but I want to talk it through before I commit.`,
).join(' ');

// The mid-journey member's accumulated facts (≥10 required; 24 here to exercise
// recall + give the HNSW index meaningful volume).
const MID_FACTS: FactSpec[] = [
  { fact: 'Runs a solo consulting practice helping mid-market firms adopt AI, roughly $220k annual revenue.', tier: 'core', source: 'explicit' },
  { fact: 'Primary goal this quarter is to break the link between revenue and billable hours.', tier: 'core', source: 'coaching_output' },
  { fact: 'Ships a weekly newsletter to about 4,000 subscribers; considers it the main audience asset.', tier: 'standard', source: 'auto_extraction' },
  { fact: 'Committed to capturing one framework from their method every week.', tier: 'standard', source: 'coaching_output' },
  { fact: 'Recurring blocker: perfectionism stalls them from publishing the library content they capture.', tier: 'core', source: 'auto_extraction' },
  { fact: 'Uses meeting-recording on every client call and has ~60 transcripts uncurated.', tier: 'standard', source: 'explicit' },
  { fact: 'Named their signature framework "the Traction Ladder" during a session.', tier: 'standard', source: 'coaching_output' },
  { fact: 'Prefers voice reflection while walking in the morning over typing.', tier: 'standard', source: 'auto_extraction' },
  { fact: 'Anxious about clients noticing AI-assisted work in their deliverables.', tier: 'standard', source: 'auto_extraction' },
  { fact: 'Set a target of two automated surfaces live by end of quarter: daily reflection and library Q&A.', tier: 'core', source: 'coaching_output' },
  { fact: 'Had a strong week after shipping the first library answer surface; energy visibly higher.', tier: 'standard', source: 'auto_extraction' },
  { fact: 'Struggles to protect the weekly review slot; it is the first thing dropped under deadline pressure.', tier: 'standard', source: 'auto_extraction' },
  { fact: 'Wants to eventually bring on one team member and needs the method documented first.', tier: 'standard', source: 'explicit' },
  { fact: 'Charges $6k for a two-month engagement and suspects it is underpriced.', tier: 'standard', source: 'explicit' },
  { fact: 'Reported the same "no time to curate transcripts" blocker two weeks running.', tier: 'core', source: 'auto_extraction' },
  { fact: 'Responds well to being shown their own past reflections; it reliably unsticks them.', tier: 'standard', source: 'coaching_output' },
  { fact: 'Chose the Build tier for voice sessions and member memory.', tier: 'standard', source: 'explicit' },
  { fact: 'Identifies most with the Reflective Practitioner archetype; thinks by writing.', tier: 'core', source: 'coaching_output' },
  { fact: 'Fears that automating too much will make the coaching feel impersonal to clients.', tier: 'standard', source: 'auto_extraction' },
  { fact: 'Runs a Monday planning ritual and a Friday review, when they hold to it.', tier: 'standard', source: 'auto_extraction' },
  { fact: 'Experimented with routing classification to a cheaper model and was surprised it held quality.', tier: 'standard', source: 'coaching_output' },
  { fact: 'Wants pricing help but keeps deprioritizing it in favor of building.', tier: 'standard', source: 'auto_extraction' },
  { fact: 'Celebrated hitting 4,000 newsletter subscribers as a milestone.', tier: 'standard', source: 'explicit' },
  { fact: 'Believes their real edge is trust with their audience, not their tooling.', tier: 'core', source: 'coaching_output' },
];

export const MEMBER_SPECS: MemberSpec[] = [
  {
    key: 'new',
    email: 'ada.new@example.com',
    displayName: 'Ada Okonkwo',
    archetypeKey: 'operator',
    tierKey: 'spark',
    enrollmentStatus: 'active',
    edge: 'brand-new: zero member_facts, no L1 recent state, no history',
    facts: [],
    recentState: null,
    checkIns: [],
    threads: [],
    uploads: [],
    plan: null,
    entitlements: [{ sku: 'coaching_chat', status: 'active', source: 'stripe_checkout', expiresInDays: 365 }],
    usageEvents: 1,
  },
  {
    key: 'mid',
    email: 'ben.mid@example.com',
    displayName: 'Ben Halvorsen',
    archetypeKey: 'reflective_practitioner',
    tierKey: 'build',
    enrollmentStatus: 'active',
    edge: 'mid-journey: rich member_facts (24), populated L1, active threads + check-ins + plan',
    facts: MID_FACTS,
    recentState:
      'Ben is deep into building his AI-enabled consulting practice. This week he shipped his first library ' +
      'answer surface and his energy is up, but he is stuck curating ~60 client transcripts and keeps citing ' +
      '"no time" — the same blocker as last week. He responds well when shown his own past reflections. Next ' +
      'commitment on the table: protect the Friday review slot and get the daily reflection surface live.',
    checkIns: [
      { daysAgo: 6, energy: 5, clarity: 4, execution: 5, emotionalTag: 'stressed', freeText: 'Behind on transcript curation again. Frustrated with myself.' },
      { daysAgo: 4, energy: 7, clarity: 7, execution: 6, emotionalTag: 'clear', freeText: 'Shipped the library Q&A surface. Felt real momentum.' },
      { daysAgo: 2, energy: 6, clarity: 6, execution: 5, emotionalTag: 'calm', freeText: 'Good client call, recorded it. Now it is just another transcript I will not curate.' },
      { daysAgo: 1, energy: 6, clarity: 7, execution: 6, emotionalTag: 'excited', freeText: 'Realized my edge is audience trust, not tooling. That reframed a lot.' },
    ],
    threads: [
      {
        agentKind: 'daily_reflection',
        title: 'Daily reflection — momentum after shipping',
        state: 'completed',
        messages: [
          { role: 'assistant', parts: text('Yesterday you said shipping the library surface gave you real momentum. What moved forward today?') },
          { role: 'user', parts: text('Recorded a good client call but I know I will not curate the transcript. Same story.') },
          { role: 'assistant', parts: text('That is the "no time to curate" blocker for the second week running. What is the one AI-leverage experiment you will run tomorrow?') },
          { role: 'user', parts: text('I will try distilling one transcript with AI assistance instead of doing it all by hand.') },
        ],
      },
      {
        agentKind: 'weekly_review',
        title: 'Weekly review — the curation blocker',
        state: 'active',
        messages: [
          { role: 'assistant', parts: text('Looking at your week: momentum from shipping, but the transcript-curation blocker appeared twice. Want to make that the focus?') },
          { role: 'user', parts: text('Yes. I think perfectionism is the real thing under it.') },
        ],
      },
    ],
    uploads: [
      { kind: 'voice_note', storagePath: 'mid/voice/2026-06-28-morning-walk.m4a', transcript: 'Morning reflection: my edge is trust with the audience, not the tools. I should stop hiding the AI and start showing my thinking.', transcriptStatus: 'complete' },
    ],
    plan: {
      stageFocus: 'Break the revenue-hours link',
      outcomes: ['Two automated surfaces live', 'Method documented enough to hand off one piece', 'Raise engagement price by 25%'],
      dailyCommitments: ['One transcript distilled', 'Morning voice reflection'],
      signatureQuestions: ['Where did I trade my scarce human hours for something software could carry?'],
      source: 'ai_coauthored',
    },
    entitlements: [
      { sku: 'coaching_chat', status: 'active', source: 'stripe_checkout', expiresInDays: 365 },
      { sku: 'voice', status: 'active', source: 'stripe_checkout', expiresInDays: 365 },
      { sku: 'member_memory', status: 'active', source: 'manual', expiresInDays: null },
    ],
    usageEvents: 12,
  },
  {
    key: 'expired',
    email: 'cleo.expired@example.com',
    displayName: 'Cleo Márquez',
    archetypeKey: 'connector',
    tierKey: 'spark',
    enrollmentStatus: 'lapsed',
    edge: 'expired entitlement: entitlement status=expired, enrollment lapsed',
    facts: [
      { fact: 'Audience-first coach who lapsed after a busy launch season.', tier: 'standard', source: 'explicit' },
      { fact: 'Wanted AI to help repurpose content but never got past the Assisted stage.', tier: 'standard', source: 'auto_extraction' },
    ],
    recentState: 'Cleo lapsed three weeks ago after a launch. Last active reflection expressed guilt about falling off. Re-engagement opportunity.',
    checkIns: [{ daysAgo: 24, energy: 4, clarity: 3, execution: 3, emotionalTag: 'overwhelmed', freeText: 'Drowning in launch. Will come back to this after.' }],
    threads: [],
    uploads: [],
    plan: null,
    entitlements: [{ sku: 'coaching_chat', status: 'expired', source: 'stripe_checkout', expiresInDays: -21 }],
    usageEvents: 2,
  },
  {
    key: 'heavy',
    email: 'dev.heavy@example.com',
    displayName: 'Dev Ramaswamy',
    archetypeKey: 'builder',
    tierKey: 'scale',
    enrollmentStatus: 'active',
    edge: 'near-zero wallet driver: heavy metered usage draws the tenant wallet below its low-balance threshold',
    facts: [
      { fact: 'Technical builder shipping an AI product; power-user of every surface.', tier: 'core', source: 'explicit' },
      { fact: 'Runs many deep-synthesis sessions, which drive most of the tenant AI spend.', tier: 'standard', source: 'auto_extraction' },
      { fact: 'Measures velocity and defect rate on AI-assisted code rather than trusting vibes.', tier: 'standard', source: 'coaching_output' },
    ],
    recentState: 'Dev is a heavy user running frequent deep sessions. Their usage is the primary driver of the tenant wallet drawdown; spend-authorization denial paths are exercised against this member.',
    checkIns: [
      { daysAgo: 3, energy: 8, clarity: 8, execution: 8, emotionalTag: 'excited', freeText: 'Ran a dozen synthesis passes distilling my whole method. Expensive but worth it.' },
      { daysAgo: 1, energy: 7, clarity: 7, execution: 7, emotionalTag: 'clear', freeText: 'Hit a spend-denied message mid-session. Need to top up.' },
    ],
    threads: [
      {
        agentKind: 'weekly_review',
        title: 'Heavy synthesis week',
        state: 'active',
        messages: [
          { role: 'assistant', parts: text('You ran a lot of deep sessions this week. What did the synthesis surface that a lighter pass would have missed?') },
          { role: 'user', parts: text('The through-line across my frameworks. Worth the spend, but the wallet is nearly empty now.') },
        ],
      },
    ],
    uploads: [],
    plan: {
      stageFocus: 'Systematize the method',
      outcomes: ['Full method distilled', 'Eval harness on the coaching agent'],
      dailyCommitments: ['One eval added'],
      signatureQuestions: ['Did I measure it, or just feel it?'],
      source: 'member_authored',
    },
    entitlements: [
      { sku: 'coaching_chat', status: 'active', source: 'stripe_checkout', expiresInDays: 365 },
      { sku: 'voice', status: 'active', source: 'stripe_checkout', expiresInDays: 365 },
      { sku: 'connectors', status: 'active', source: 'manual', expiresInDays: null },
    ],
    usageEvents: 40,
  },
  {
    key: 'longfields',
    email: 'edith.long@example.com',
    displayName: 'Edith Nakamura',
    archetypeKey: 'operator',
    tierKey: 'build',
    enrollmentStatus: 'active',
    edge: 'long uploads / long-string fields: very long upload transcript + long check-in free_text',
    facts: [
      { fact: 'Operator who processes decisions by talking them out at length.', tier: 'standard', source: 'explicit' },
      { fact: 'Uploaded a 40-segment voice memo debating whether to automate onboarding.', tier: 'standard', source: 'auto_extraction' },
    ],
    recentState: 'Edith is wrestling with whether to automate her onboarding. She thinks out loud in long voice memos; the system must handle long transcripts and long free-text without truncation.',
    checkIns: [
      {
        daysAgo: 2,
        energy: 6,
        clarity: 5,
        execution: 5,
        emotionalTag: 'calm',
        freeText:
          'Long one today. ' +
          Array.from({ length: 20 }, (_, i) => `Thought ${i + 1}: I want the warmth of manual onboarding but the leverage of automation, and I cannot tell if that is a real tension or a false one I am using to avoid deciding.`).join(' '),
      },
    ],
    threads: [],
    uploads: [
      { kind: 'voice_note', storagePath: 'longfields/voice/onboarding-debate.m4a', transcript: LONG_TRANSCRIPT, transcriptStatus: 'complete' },
    ],
    plan: null,
    entitlements: [{ sku: 'coaching_chat', status: 'active', source: 'stripe_checkout', expiresInDays: 365 }],
    usageEvents: 3,
  },
];

// Markup default = 1.1x (decision #13; supersedes the stale 1.5x note in task 4.3).
export const MARKUP_RATE = 1.1;
export const LOW_BALANCE_THRESHOLD_CREDITS = 100_000;
export const TARGET_RESIDUAL_BALANCE_CREDITS = 40_000; // below threshold → near-zero scenario
