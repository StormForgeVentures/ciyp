/**
 * Contract 05 — Entitlement (platform → UI).
 * Derived from Stripe web checkout on the COACH's own Stripe account (ADR-008); the engine
 * checks it at session start only — never per turn. Entitlement (member's access, flow a)
 * and wallet (coach's credits, flow b) are independent: the UI must distinguish
 * entitlement-expired (member renews with their coach) from spend_denied (coach's wallet).
 * Frozen at v1, additive-only. Source: docs/contracts/05-entitlement.md.
 */
import { z } from 'zod';

export const Entitlement = z.object({
  memberId: z.string().uuid(),
  tenantId: z.string().uuid(),
  /** Resolved tenant_tiers.key (ADR-002); null = no active tier. */
  tierKey: z.string().nullable(),
  status: z.enum(['active', 'trialing', 'past_due', 'canceled', 'expired', 'none']),
  /** Capability flags the tier grants (e.g. "voice", "uploads"). */
  features: z.array(z.string()),
  currentPeriodEnd: z.string().datetime().nullable(),
  trialEnd: z.string().datetime().nullable(),
  /** v1: Stripe checkout only. 'api' grants (008a FR-9) are additive — see note below. */
  source: z.literal('stripe'),
});
export type Entitlement = z.infer<typeof Entitlement>;

// ADDITIVE-EVOLUTION NOTE: the external enrollment API (PRD-008a FR-9, decision #14) grants
// entitlements with source 'api'. Widening `source` from the literal to an enum is an
// additive change made in the same wave that ships FR-9, with a contract-change entry in
// handoff/project-state.md per the §13 discipline. The wire literal stays 'stripe' until then.
