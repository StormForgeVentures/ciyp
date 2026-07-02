/**
 * The generic bounded-cadence directive builder.
 *
 * A cadence thread (daily / weekly / monthly_review) is a BOUNDED CONVERSATIONAL
 * THREAD, not a form. This module assembles the bounded directive from INJECTED config
 * (role label, framing intro, ordered beats, optional signature-question weave, closing
 * line). It carries ZERO coach content — the real role/intro/beats come from the seed
 * or tenant config (PRD-001). Pure string assembly, no I/O.
 */

/** The platform-recognized cadence cycle keys (generic scheduling, not coach IP). */
export const CADENCE_KINDS = ['daily', 'weekly', 'monthly_review'] as const;
export type CadenceKind = (typeof CADENCE_KINDS)[number];

/** One beat the cadence walks: an opaque key + a member-facing description. */
export interface CadenceBeatSpec {
  /** Opaque beat key (config-defined). */
  key: string;
  /** The one-line intent the directive expands (NOT a verbatim line). */
  description: string;
  /** True if this beat is one the "quick mode" (minimal) variant skips. */
  skippable?: boolean;
}

/** A per-user signature question, optionally pinned to a beat. */
export interface SignatureQuestion {
  id: string;
  text: string;
  /** Optional beat key the question is pinned to. */
  beat?: string | null;
}

export interface BuildCadenceDirectiveInput {
  /** A generic role label (e.g. "a coaching companion") — INJECTED, never coach IP. */
  role: string;
  /** The framing intro line(s) — INJECTED (seed/tenant content). */
  intro: string;
  /** The ordered beats. */
  beats: CadenceBeatSpec[];
  /** The member's first name, for warmth (optional). */
  displayName?: string | null;
  /** The active plan's signature questions (empty when none). */
  signatureQuestions?: SignatureQuestion[];
  /** Which beat unpinned/unknown-beat questions fold into (default: the last beat). */
  defaultWeaveBeat?: string;
  /** Quick mode strips `skippable` beats. Default false. */
  quickMode?: boolean;
  /** The closing instruction (optional; a generic default is used when absent). */
  closing?: string;
}

/**
 * Weave signature questions into a per-beat map. Recognized-beat questions pin to their
 * beat; unpinned / unknown-beat questions fold into `defaultBeat`.
 */
export function weaveSignatureQuestions(
  beats: CadenceBeatSpec[],
  questions: SignatureQuestion[] | undefined,
  defaultBeat: string,
): Record<string, string[]> {
  const keys = new Set(beats.map((b) => b.key));
  const map: Record<string, string[]> = {};
  for (const b of beats) map[b.key] = [];
  if (!map[defaultBeat]) map[defaultBeat] = [];
  if (!questions) return map;
  for (const q of questions) {
    const beat = q.beat && keys.has(q.beat) ? q.beat : defaultBeat;
    (map[beat] ??= []).push(q.text);
  }
  return map;
}

/**
 * Build the bounded cadence directive. Always produces a valid directive — a member with
 * NO signature questions simply gets the default beats. Pure string assembly.
 */
export function buildCadenceDirective(input: BuildCadenceDirectiveInput): string {
  const activeBeats = input.quickMode ? input.beats.filter((b) => !b.skippable) : input.beats;
  const defaultBeat =
    input.defaultWeaveBeat ?? activeBeats[activeBeats.length - 1]?.key ?? '';
  const woven = weaveSignatureQuestions(activeBeats, input.signatureQuestions, defaultBeat);

  const name = input.displayName?.trim();
  const greeting = name ? `The member's name is ${name}. ` : '';

  const beatLines = activeBeats
    .map((beat) => {
      const extras = woven[beat.key] ?? [];
      const weaveNote =
        extras.length > 0
          ? ` Weave in, naturally: ${extras.map((t) => `"${t}"`).join('; ')}.`
          : '';
      return `- ${beat.description}${weaveNote}`;
    })
    .join('\n');

  const closing =
    input.closing ??
    'Never shame a low score or a hard moment; reflect it back warmly. When all beats are captured, close with one short reflection line and finalize.';

  return [
    `You are ${input.role} running a bounded check-in — a short, warm conversation, not a form. ${greeting}`,
    input.intro.trim(),
    '',
    'Walk these beats in order, one light question at a time. Acknowledge each answer before moving on:',
    beatLines,
    '',
    closing,
  ].join('\n');
}

/** Where the member sits in their plan window (thirds of the period). */
export type JourneyPhase = 'early' | 'mid' | 'late';

/**
 * Compute the journey phase from the plan window. `dayN = localDate − periodStartDate + 1`;
 * the window is split into thirds → early / mid / late. Pure date math. Degrades
 * gracefully: a missing/invalid start date → `early`; a `dayN` past the window clamps to
 * `late`.
 *
 * @param periodStartDate member-local plan start, ISO `YYYY-MM-DD` (or null)
 * @param periodDays plan window length (default 90)
 * @param localDate the member's local date today, ISO `YYYY-MM-DD`
 */
export function computeJourneyPhase(
  periodStartDate: string | null | undefined,
  periodDays: number | null | undefined,
  localDate: string,
): JourneyPhase {
  const total = typeof periodDays === 'number' && periodDays > 0 ? periodDays : 90;
  if (!periodStartDate) return 'early';

  const startMs = Date.parse(`${periodStartDate}T00:00:00Z`);
  const todayMs = Date.parse(`${localDate}T00:00:00Z`);
  if (Number.isNaN(startMs) || Number.isNaN(todayMs)) return 'early';

  const dayN = Math.max(1, Math.floor((todayMs - startMs) / 86_400_000) + 1);
  const third = total / 3;
  if (dayN <= third) return 'early';
  if (dayN <= 2 * third) return 'mid';
  return 'late';
}
