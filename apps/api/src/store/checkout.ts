/**
 * Checkout-session creation (PRD-008a §1.2). Creates a Stripe HOSTED checkout session on
 * the COACH's own account through the connector (ADR-008): funds settle to the coach, the
 * platform takes NO fee and never touches the money. The client passes NO price id — the
 * SKU is resolved from the tenant's connector config. The member id is carried in
 * metadata + client_reference_id so the webhook can attribute the resulting subscription.
 *
 * Errors: 409 if the member already has active access; 503 if the tenant's Stripe objects
 * are missing (unprovisioned) or the connector is not connected.
 *
 * Success/cancel URLs are SERVER-controlled (env / provisioning config) — never taken from
 * the request, to avoid an open-redirect through the checkout return.
 */
import type Stripe from "stripe";
import { withMemberSession } from "./db.js";
import { resolveEntitlement, isEntitled } from "./entitlement.js";
import type { MemberSession } from "./auth.js";
import type { CoachStripeConnector } from "./connector/port.js";

export interface CheckoutDeps {
  connector: CoachStripeConnector;
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutResult {
  status: number;
  body: Record<string, unknown>;
}

export async function createCheckoutSession(
  deps: CheckoutDeps,
  session: MemberSession,
): Promise<CheckoutResult> {
  const config = await deps.connector.getConfig(session.tenantId);
  if (!config || !config.priceId) {
    return { status: 503, body: { error: "stripe_unprovisioned" } };
  }
  if (!(await deps.connector.isConnected(session.tenantId))) {
    return { status: 503, body: { error: "stripe_unconnected" } };
  }

  // 409 if the member already holds active access (idempotent from the buyer's view).
  const entitlement = await withMemberSession(session, (client) =>
    resolveEntitlement(client, session),
  );
  if (isEntitled(entitlement.status)) {
    return {
      status: 409,
      body: { error: "already_entitled", status: entitlement.status },
    };
  }

  const stripe = await deps.connector.getClient(session.tenantId);
  const params: Stripe.Checkout.SessionCreateParams = {
    mode: "subscription",
    line_items: [{ price: config.priceId, quantity: 1 }],
    success_url: deps.successUrl,
    cancel_url: deps.cancelUrl,
    client_reference_id: session.memberId,
    metadata: {
      member_id: session.memberId,
      tenant_id: session.tenantId,
      tier_key: config.tierKey ?? "",
    },
    subscription_data: {
      metadata: { member_id: session.memberId, tenant_id: session.tenantId },
    },
    // NO application_fee_amount / no platform fee (ADR-008 — the coach keeps 100%).
  };
  const checkout = await stripe.checkout.sessions.create(params);
  return { status: 200, body: { url: checkout.url } };
}
