/**
 * Entitlement projection (PRD-008a §1.3, contract 05). Computed — never a stored status.
 * Reads the member's latest member_subscriptions row (RLS-fenced to the member) + its
 * tier, and maps to the contract-05 shape:
 *   - tierKey  ← tenant_tiers.key of the subscription's tier
 *   - status   ← Stripe status verbatim, overridden to 'expired' once current_period_end
 *                has passed (a lapsed renewal reads as expired BEFORE the failure webhook
 *                lands — FR-7 / AC-7). past_due retains access until period end (Q-2).
 *   - features ← tier.entitlements_jsonb.skus
 *   - source   ← literal 'stripe' (v1; 'api' grants widen this with §1.5, not in scope)
 *
 * memberId/tenantId ALWAYS come from the caller's verified session (decision #19), never
 * from request input. The resolver is exported so the §1.4 session-start gate (later wave)
 * can reuse the exact same computation.
 */
import type { PoolClient } from "pg";
import { Entitlement } from "@stormforgeventures/ciyp-shared";
import type { MemberSession } from "./member-auth.js";

export type ContractStatus =
  "active" | "trialing" | "past_due" | "canceled" | "expired" | "none";

/** Map a Stripe subscription status + period end to the contract-05 status. */
export function computeStatus(
  stripeStatus: string | null,
  currentPeriodEnd: Date | null,
  now: Date = new Date(),
): ContractStatus {
  if (!stripeStatus) return "none";
  const lapsed =
    currentPeriodEnd != null && currentPeriodEnd.getTime() <= now.getTime();
  switch (stripeStatus) {
    case "trialing":
      return lapsed ? "expired" : "trialing";
    case "active":
      return lapsed ? "expired" : "active";
    case "past_due":
      return lapsed ? "expired" : "past_due"; // Q-2: grace until current_period_end
    case "canceled":
      return "canceled";
    default:
      return "expired"; // unpaid / incomplete / incomplete_expired / unknown → no access
  }
}

interface SubscriptionRow {
  stripe_status: string;
  current_period_end: Date | null;
  trial_end: Date | null;
  tier_key: string | null;
  entitlements_jsonb: { skus?: unknown } | null;
}

export type EntitlementView = ReturnType<typeof buildView>;

function buildView(
  session: MemberSession,
  row: SubscriptionRow | undefined,
  now: Date,
) {
  const status: ContractStatus = row
    ? computeStatus(row.stripe_status, row.current_period_end, now)
    : "none";
  const skus = row?.entitlements_jsonb?.skus;
  const features = Array.isArray(skus)
    ? skus.filter((s): s is string => typeof s === "string")
    : [];
  const value = {
    memberId: session.memberId,
    tenantId: session.tenantId,
    tierKey: row?.tier_key ?? null,
    status,
    features,
    currentPeriodEnd: row?.current_period_end
      ? new Date(row.current_period_end).toISOString()
      : null,
    trialEnd: row?.trial_end ? new Date(row.trial_end).toISOString() : null,
    source: "stripe" as const,
  };
  // Validate against the frozen contract-05 zod schema before it leaves the engine.
  return Entitlement.parse(value);
}

/** Resolve the contract-05 entitlement for the session's member. Client MUST already be
 *  scoped to the member (withMemberSession) so RLS fences to the member's own rows. */
export async function resolveEntitlement(
  client: PoolClient,
  session: MemberSession,
  now: Date = new Date(),
): Promise<EntitlementView> {
  const { rows } = await client.query(
    `select ms.stripe_status, ms.current_period_end, ms.trial_end,
            tt.key as tier_key, tt.entitlements_jsonb
       from member_subscriptions ms
       left join tenant_tiers tt
         on tt.id = ms.tier_id and tt.tenant_id = ms.tenant_id
      where ms.member_id = $1
      order by ms.updated_at desc
      limit 1`,
    [session.memberId],
  );
  return buildView(session, rows[0] as SubscriptionRow | undefined, now);
}

/** Session-start allow check (reused by the §1.4 gate later). Access requires an
 *  active/trialing/past_due status; expired/canceled/none are refused. */
export function isEntitled(status: ContractStatus): boolean {
  return status === "active" || status === "trialing" || status === "past_due";
}
