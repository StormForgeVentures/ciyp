// Program-access store seed data (PRD-008a §1.1/§1.3). Turns the demo members into the
// Stripe-mirrored subscription projection contract-05 reads, so the member-facing
// entitlement surface runs on real seed rows (not an empty screen).
//
// The tenant's coach-Stripe CONNECTOR is seeded as a metadata row only (status 'pending',
// NO vaulted key): live restricted keys arrive at provisioning (008b) on the coach's real
// account, so checkout correctly reports 503 (unconnected) on the seed until then. The
// fully-connected connector (vaulted key + webhook secret) is exercised by the apps/api
// integration tests, which own the interim vault key.
import { MEMBER_SPECS, type MemberSpec } from "./members.js";

/** Non-secret connector config (mirrors StripeConnectorConfig in apps/api). */
export const STRIPE_CONNECTOR_SEED = {
  stripeAccountRef: "acct_seed_luminify",
  priceId: "price_seed_program_access",
  tierKey: "spark", // the tier the single program-access SKU grants by default
  webhookEndpointToken: "whep_seed_luminify",
  webhookEndpointId: "we_seed_luminify",
} as const;

export interface SubscriptionSeed {
  memberKey: string;
  tierKey: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  stripeStatus: string; // Stripe status verbatim
  currentPeriodEndDays: number | null; // relative to now; negative = lapsed
}

/** Derive one program-access subscription per member from its primary Stripe entitlement. */
export function subscriptionSeeds(): SubscriptionSeed[] {
  return MEMBER_SPECS.map((m: MemberSpec) => {
    const primary =
      m.entitlements.find((e) => e.source === "stripe_checkout") ??
      m.entitlements[0];
    const stripeStatus = primary?.status === "revoked" ? "canceled" : "active";
    return {
      memberKey: m.key,
      tierKey: m.tierKey,
      stripeCustomerId: `cus_seed_${m.key}`,
      stripeSubscriptionId: `sub_seed_${m.key}`,
      stripeStatus,
      // active entitlement → future period end; expired (expiresInDays < 0) → lapsed →
      // the projection computes contract-05 status 'expired' (AC-5/AC-6/AC-7 shape).
      currentPeriodEndDays: primary?.expiresInDays ?? null,
    };
  });
}
