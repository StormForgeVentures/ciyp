import { describe, expect, it } from 'vitest';
import {
  renderPlanMarkdown,
  renderStructuredSections,
  planDocumentTitle,
  checkPlanDocumentFidelity,
  type PlanDocumentData,
} from './render.js';
import { PLAN_DOCUMENT_FALLBACK_NARRATIVE } from './directive.js';

/**
 * The pure renderer is DETERMINISTIC and FIDELITY-COMPLETE: every member datum from the
 * data appears verbatim and nothing is fabricated. Tests are written adversarially against
 * the renderer's claimed behavior (plant a missing/altered datum → the fidelity gate must
 * drop to 0). Uses a generic plan shape + an opaque focus label (no coach IP).
 */

const PLAN: PlanDocumentData = {
  summary: 'Anchor the next stretch in steadiness, not striving.',
  outcomes: [
    { text: 'Lead the Q3 launch without carrying the whole load', done: false },
    { text: 'Reclaim two evenings a week for family', done: true },
  ],
  daily_commitments: [
    { text: 'Ten minutes of stillness before the first message', cadence: 'daily', done: false },
    { text: 'Name one thing I trust myself with', cadence: 'weekdays', done: false },
  ],
  check_in_questions: [
    'Where did I lead from steadiness today?',
    'What did I trust myself with?',
  ],
  focus_label: 'Steadiness',
  day: 12,
  period_days: 90,
};

const NARRATIVE = { intro: 'A grounded intro span.', closing: 'A grounded closing span.' };

describe('renderPlanMarkdown — fidelity', () => {
  it('contains every member datum verbatim', () => {
    const { markdown } = renderPlanMarkdown(PLAN, NARRATIVE);
    expect(markdown).toContain(PLAN.summary);
    expect(markdown).toContain('Steadiness');
    expect(markdown).toContain('90');
    for (const o of PLAN.outcomes) expect(markdown).toContain(o.text);
    for (const c of PLAN.daily_commitments) expect(markdown).toContain(c.text);
    for (const q of PLAN.check_in_questions) expect(markdown).toContain(q);
    expect(markdown).toContain('(daily)');
    expect(markdown).toContain('✓'); // the done outcome
  });

  it('embeds the narrative above and below the structured block', () => {
    const { markdown } = renderPlanMarkdown(PLAN, NARRATIVE);
    const introAt = markdown.indexOf('A grounded intro span.');
    const bodyAt = markdown.indexOf(renderStructuredSections(PLAN));
    const closeAt = markdown.indexOf('A grounded closing span.');
    expect(introAt).toBeGreaterThanOrEqual(0);
    expect(bodyAt).toBeGreaterThan(introAt);
    expect(closeAt).toBeGreaterThan(bodyAt);
  });

  it('is deterministic (same input → byte-identical output)', () => {
    const a = renderPlanMarkdown(PLAN, NARRATIVE).markdown;
    const b = renderPlanMarkdown(PLAN, NARRATIVE).markdown;
    expect(a).toBe(b);
  });

  it('reviewText equals the full markdown (the egress guard grades the text, never bytes)', () => {
    const out = renderPlanMarkdown(PLAN, NARRATIVE);
    expect(out.reviewText).toBe(out.markdown);
  });

  it('title carries the focus label when present, plain otherwise', () => {
    expect(planDocumentTitle(PLAN)).toBe('Your Plan — Focus: Steadiness');
    const noFocus: PlanDocumentData = { ...PLAN, focus_label: undefined };
    expect(planDocumentTitle(noFocus)).toBe('Your Plan');
  });
});

describe('checkPlanDocumentFidelity — the deterministic 1.0 gate', () => {
  it('scores 1.0 for a faithful render', () => {
    const { markdown } = renderPlanMarkdown(PLAN, NARRATIVE);
    const r = checkPlanDocumentFidelity(PLAN, markdown);
    expect(r.score).toBe(1);
    expect(r.missing).toEqual([]);
    expect(r.structuredBlockMismatch).toBe(false);
  });

  it('drops to 0 and reports the datum when a commitment is dropped from the markdown', () => {
    const { markdown } = renderPlanMarkdown(PLAN, NARRATIVE);
    const dropped = PLAN.daily_commitments[1]!.text;
    const tampered = markdown.replace(dropped, ''); // simulate a missing datum
    const r = checkPlanDocumentFidelity(PLAN, tampered);
    expect(r.score).toBe(0);
    expect(r.missing).toContain(dropped);
    expect(r.structuredBlockMismatch).toBe(true);
  });

  it('drops to 0 on a fabricated body item not present in the data', () => {
    const { markdown } = renderPlanMarkdown(PLAN, NARRATIVE);
    const tampered = markdown.replace(
      '## Daily commitments',
      '## Daily commitments\n- Run a marathon every morning',
    );
    const r = checkPlanDocumentFidelity(PLAN, tampered);
    expect(r.score).toBe(0);
    expect(r.structuredBlockMismatch).toBe(true);
  });

  it('the deterministic fallback narrative fabricates no plan data (fidelity stays 1.0)', () => {
    const { markdown } = renderPlanMarkdown(PLAN, PLAN_DOCUMENT_FALLBACK_NARRATIVE);
    expect(checkPlanDocumentFidelity(PLAN, markdown).score).toBe(1);
  });

  it('handles a plan with empty arrays and no focus label', () => {
    const sparse: PlanDocumentData = {
      ...PLAN,
      focus_label: undefined,
      outcomes: [],
      daily_commitments: [],
      check_in_questions: [],
    };
    const { markdown } = renderPlanMarkdown(sparse, NARRATIVE);
    expect(checkPlanDocumentFidelity(sparse, markdown).score).toBe(1);
  });
});
