/**
 * Pure markdown renderer for the plan-document deliverable.
 *
 * COACHING LAYER = app config. Fully DETERMINISTIC + I/O-free: given a plan-shaped
 * `PlanDocumentData` + the model-authored `{intro, closing}` narrative, it emits the same
 * markdown byte-for-byte. The structured body (focus, outcomes, daily commitments,
 * check-in questions, period) is rendered VERBATIM from the data so the fidelity check can
 * assert 1:1 presence and zero fabrication. The narrative is the ONLY model span —
 * bounded above (intro) and below (closing) the structured block.
 *
 * DE-ENUM: `PlanDocumentData` is a generic plan shape defined locally (not a coach-named
 * schema). `focus_label` is an optional opaque focus string (was the donor's EMPOWER
 * stage); the title is generic ("Your Plan") and tenant-overridable.
 */

/** A generic plan shape — the member's own plan data (tenant/DB-owned). */
export interface PlanDocumentData {
  summary: string;
  /** Optional opaque focus label (tenant config), rendered in the title + body. */
  focus_label?: string | null;
  day: number;
  period_days: number;
  outcomes: Array<{ text: string; done?: boolean }>;
  daily_commitments: Array<{ text: string; cadence?: string | null; done?: boolean }>;
  check_in_questions: string[];
  /** Optional title override; defaults to "Your Plan". */
  title?: string;
}

export interface PlanNarrative {
  readonly intro: string;
  readonly closing: string;
}

export interface RenderedPlanDocument {
  /** The full markdown deliverable (intro + structured body + closing). */
  readonly markdown: string;
  /**
   * The TEXT projection the egress guard grades. For the plan document this is the full
   * rendered markdown — the guard grades the deliverable text, never a byte stream.
   */
  readonly reviewText: string;
}

/** The member-facing export title (deterministic; carries the focus label when present). */
export function planDocumentTitle(plan: PlanDocumentData): string {
  const base = plan.title ?? 'Your Plan';
  return plan.focus_label ? `${base} — Focus: ${plan.focus_label}` : base;
}

/** Decorate an outcome line (the text is always a verbatim substring — fidelity-safe). */
function outcomeLine(o: PlanDocumentData['outcomes'][number]): string {
  return `- ${o.text}${o.done ? ' ✓' : ''}`;
}

/** Decorate a commitment line (text + optional cadence; text stays a verbatim substring). */
function commitmentLine(c: PlanDocumentData['daily_commitments'][number]): string {
  const cadence = c.cadence ? ` (${c.cadence})` : '';
  return `- ${c.text}${cadence}${c.done ? ' ✓' : ''}`;
}

/**
 * Render ONLY the structured, member-owned sections — verbatim from the data. This exact
 * block is embedded as a contiguous substring of the full markdown, so the deterministic
 * fidelity check is a single exact-substring assertion. The headers are always emitted
 * (deterministic regardless of empty arrays) so render and the fidelity re-render stay
 * byte-identical.
 */
export function renderStructuredSections(plan: PlanDocumentData): string {
  const lines: string[] = [];

  lines.push('## Your Focus');
  lines.push(plan.summary);
  if (plan.focus_label) {
    lines.push('');
    lines.push(`**Focus:** ${plan.focus_label}`);
  }
  lines.push('');
  lines.push(`Day ${plan.day} of ${plan.period_days}.`);

  lines.push('');
  lines.push("## Outcomes you're building toward");
  for (const o of plan.outcomes) lines.push(outcomeLine(o));

  lines.push('');
  lines.push('## Daily commitments');
  for (const c of plan.daily_commitments) lines.push(commitmentLine(c));

  lines.push('');
  lines.push('## Check-in questions');
  for (const q of plan.check_in_questions) lines.push(`- ${q}`);

  return lines.join('\n');
}

/**
 * Render the full plan-document markdown. `narrative.intro` frames the plan above the
 * structured block; `narrative.closing` returns agency below it. Deterministic.
 */
export function renderPlanMarkdown(
  plan: PlanDocumentData,
  narrative: PlanNarrative,
): RenderedPlanDocument {
  const markdown = [
    `# ${planDocumentTitle(plan)}`,
    '',
    narrative.intro.trim(),
    '',
    renderStructuredSections(plan),
    '',
    narrative.closing.trim(),
    '',
  ].join('\n');

  return { markdown, reviewText: markdown };
}

export interface PlanFidelityResult {
  /** 1.0 only when nothing is missing AND nothing is fabricated; else 0. */
  readonly score: number;
  /** Member datums absent from the markdown (diagnostics). */
  readonly missing: string[];
  /**
   * True when the verbatim structured block is NOT a contiguous substring of the markdown
   * — i.e. a datum was altered, reordered, or a non-data item was injected into the body.
   */
  readonly structuredBlockMismatch: boolean;
}

/**
 * DETERMINISTIC fidelity check (the hard gate). The artifact must contain, verbatim, every
 * member datum from the data AND fabricate nothing in the structured body.
 *
 * Strategy: re-render the structured block from the data and assert it is a contiguous
 * substring of the markdown. An exact-block match proves BOTH directions at once — every
 * datum is present (in order) and nothing fabricated lives inside the block. `missing` is
 * computed per-datum for actionable diagnostics.
 */
export function checkPlanDocumentFidelity(
  plan: PlanDocumentData,
  markdown: string,
): PlanFidelityResult {
  const datums: string[] = [
    plan.summary,
    ...(plan.focus_label ? [plan.focus_label] : []),
    // Both the day index and the period are rendered in `Day N of M.` — assert BOTH.
    String(plan.day),
    String(plan.period_days),
    ...plan.outcomes.map((o) => o.text),
    ...plan.daily_commitments.map((c) => c.text),
    // A dropped cadence must register as a missing datum, not silently pass.
    ...plan.daily_commitments.map((c) => c.cadence ?? '').filter((s) => s.length > 0),
    ...plan.check_in_questions,
  ];
  const missing = datums.filter((d) => d.length > 0 && !markdown.includes(d));

  // The exact-block substring check proves the per-item `done` state (the ✓ suffix) and
  // the cadence decoration are present VERBATIM and in order.
  const structuredBlockMismatch = !markdown.includes(renderStructuredSections(plan));

  const score = missing.length === 0 && !structuredBlockMismatch ? 1 : 0;
  return { score, missing, structuredBlockMismatch };
}
