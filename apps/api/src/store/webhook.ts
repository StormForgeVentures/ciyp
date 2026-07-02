/**
 * Stripe webhook receiver + projection (PRD-008a §1.1). Flow:
 *   1. Resolve the tenant BY ENDPOINT IDENTITY (the opaque token in the per-tenant URL) —
 *      a system lookup, before any tenant fence exists.
 *   2. Verify the signature with THAT tenant's vault-held signing secret (real HMAC via
 *      the connector; a forged/absent signature → 400 so Stripe retries, never a write).
 *   3. Atomically dedupe on (tenant_id, event_id) and project into member_subscriptions,
 *      inside ONE transaction: either the event is recorded AND projected, or neither
 *      (rollback), so a failed attempt is safely retried and a genuine replay is a no-op.
 *
 * Idempotency lives in the DB (unique (tenant_id, event_id) on stripe_events + a
 * SELECT ... FOR UPDATE gate), never in app-level checks that race. Returns 2xx on a
 * handled event AND on a deduped replay (AC-3); non-2xx only on signature failure (400)
 * or a persist/projection error (500 → Stripe retries).
 */
import type { PoolClient } from "pg";
import type Stripe from "stripe";
import { withSystemTx } from "./db.js";
import type { CoachStripeConnector } from "./connector/port.js";

export interface WebhookDeps {
  connector: CoachStripeConnector;
}

export interface WebhookInput {
  endpointToken: string | undefined;
  signature: string | undefined;
  rawBody: string;
}

export interface WebhookResult {
  status: number;
  body: Record<string, unknown>;
}

const HANDLED = new Set([
  "checkout.session.completed",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);

export async function handleStripeWebhook(
  deps: WebhookDeps,
  input: WebhookInput,
): Promise<WebhookResult> {
  const { endpointToken, signature, rawBody } = input;
  if (!endpointToken || !signature) {
    return { status: 400, body: { error: "missing_endpoint_or_signature" } };
  }

  const tenantId = await deps.connector.resolveTenantByEndpoint(endpointToken);
  if (!tenantId)
    return { status: 404, body: { error: "unknown_webhook_endpoint" } };

  let event: Stripe.Event;
  try {
    event = await deps.connector.constructWebhookEvent(
      tenantId,
      rawBody,
      signature,
    );
  } catch {
    // Signature verification failed — do NOT reveal detail; Stripe will retry.
    return { status: 400, body: { error: "signature_verification_failed" } };
  }

  return withSystemTx(async (client) => {
    // Dedupe: insert-guard on (tenant_id, event_id); the row lock serializes concurrent
    // deliveries of the same event.
    await client.query(
      `insert into stripe_events (tenant_id, event_id, type, payload, status)
       values ($1, $2, $3, $4, 'pending')
       on conflict (tenant_id, event_id) do nothing`,
      [tenantId, event.id, event.type, JSON.stringify(event)],
    );
    const gate = await client.query(
      `select status from stripe_events where tenant_id = $1 and event_id = $2 for update`,
      [tenantId, event.id],
    );
    const existing = gate.rows[0] as { status: string } | undefined;
    if (existing?.status === "processed") {
      return { status: 200, body: { received: true, deduped: true } };
    }

    if (HANDLED.has(event.type)) {
      await projectEvent(client, tenantId, event);
    }
    await client.query(
      `update stripe_events set status = 'processed', processed_at = now()
        where tenant_id = $1 and event_id = $2`,
      [tenantId, event.id],
    );
    return { status: 200, body: { received: true } };
  });
}

async function projectEvent(
  client: PoolClient,
  tenantId: string,
  event: Stripe.Event,
): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
      await projectCheckoutCompleted(
        client,
        tenantId,
        event.data.object,
        event.id,
      );
      break;
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await projectSubscriptionChange(
        client,
        tenantId,
        event.data.object,
        event.id,
      );
      break;
    default:
      break;
  }
}

const asId = (v: string | { id?: string } | null | undefined): string | null =>
  typeof v === "string" ? v : (v?.id ?? null);

function periodEnd(sub: Stripe.Subscription): Date | null {
  const top = (sub as unknown as { current_period_end?: number })
    .current_period_end;
  if (typeof top === "number") return new Date(top * 1000);
  const item = sub.items?.data?.[0] as unknown as
    { current_period_end?: number } | undefined;
  if (item && typeof item.current_period_end === "number")
    return new Date(item.current_period_end * 1000);
  return null;
}

/** Resolve the tenant tier id for a (tenantId, tierKey); null if unknown. */
async function tierIdForKey(
  client: PoolClient,
  tenantId: string,
  tierKey: string | null,
): Promise<string | null> {
  if (!tierKey) return null;
  const { rows } = await client.query(
    `select id from tenant_tiers where tenant_id = $1 and key = $2`,
    [tenantId, tierKey],
  );
  return (rows[0] as { id: string } | undefined)?.id ?? null;
}

async function projectCheckoutCompleted(
  client: PoolClient,
  tenantId: string,
  session: Stripe.Checkout.Session,
  eventId: string,
): Promise<void> {
  const memberId =
    session.metadata?.member_id ?? session.client_reference_id ?? null;
  const subscriptionId = asId(session.subscription);
  const customerId = asId(session.customer);
  if (!memberId || !subscriptionId) return; // not a member program-access subscription checkout

  const tierKey =
    session.metadata?.tier_key || (await connectorTierKey(client, tenantId));
  const tierId = await tierIdForKey(client, tenantId, tierKey);

  if (customerId) {
    await client.query(
      `insert into stripe_customers (tenant_id, member_id, stripe_customer_id)
       values ($1, $2, $3)
       on conflict (tenant_id, stripe_customer_id) do nothing`,
      [tenantId, memberId, customerId],
    );
  }

  // A completed checkout = active access. Period end arrives with the subsequent
  // customer.subscription.updated; leave it null here (null → not lapsed → 'active').
  await client.query(
    `insert into member_subscriptions
       (tenant_id, member_id, tier_id, stripe_customer_id, stripe_subscription_id, stripe_status, updated_from_event_id)
     values ($1, $2, $3, $4, $5, 'active', $6)
     on conflict (tenant_id, member_id, stripe_subscription_id) do update
       set tier_id = excluded.tier_id,
           stripe_customer_id = excluded.stripe_customer_id,
           stripe_status = 'active',
           updated_from_event_id = excluded.updated_from_event_id,
           updated_at = now()`,
    [tenantId, memberId, tierId, customerId, subscriptionId, eventId],
  );
}

async function projectSubscriptionChange(
  client: PoolClient,
  tenantId: string,
  sub: Stripe.Subscription,
  eventId: string,
): Promise<void> {
  const subscriptionId = sub.id;
  const customerId = asId(sub.customer);
  const status = sub.status; // active | trialing | past_due | canceled | unpaid | incomplete...
  const cpe = periodEnd(sub);
  const trialEnd =
    typeof sub.trial_end === "number" ? new Date(sub.trial_end * 1000) : null;

  // Update the existing projected row (created at checkout) by subscription id.
  const updated = await client.query(
    `update member_subscriptions
        set stripe_status = $3,
            current_period_end = $4,
            trial_end = $5,
            updated_from_event_id = $6,
            updated_at = now()
      where tenant_id = $1 and stripe_subscription_id = $2`,
    [tenantId, subscriptionId, status, cpe, trialEnd, eventId],
  );
  if ((updated.rowCount ?? 0) > 0) return;

  // No projected row yet (e.g. events out of order) — insert if we can resolve the member.
  const memberId =
    sub.metadata?.member_id ??
    (customerId ? await memberForCustomer(client, tenantId, customerId) : null);
  if (!memberId) return; // cannot attribute; the event is still recorded in stripe_events

  const tierKey =
    sub.metadata?.tier_key || (await connectorTierKey(client, tenantId));
  const tierId = await tierIdForKey(client, tenantId, tierKey);
  await client.query(
    `insert into member_subscriptions
       (tenant_id, member_id, tier_id, stripe_customer_id, stripe_subscription_id, stripe_status, current_period_end, trial_end, updated_from_event_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     on conflict (tenant_id, member_id, stripe_subscription_id) do update
       set stripe_status = excluded.stripe_status,
           current_period_end = excluded.current_period_end,
           trial_end = excluded.trial_end,
           updated_from_event_id = excluded.updated_from_event_id,
           updated_at = now()`,
    [
      tenantId,
      memberId,
      tierId,
      customerId,
      subscriptionId,
      status,
      cpe,
      trialEnd,
      eventId,
    ],
  );
}

async function memberForCustomer(
  client: PoolClient,
  tenantId: string,
  customerId: string,
): Promise<string | null> {
  const { rows } = await client.query(
    `select member_id from stripe_customers where tenant_id = $1 and stripe_customer_id = $2 limit 1`,
    [tenantId, customerId],
  );
  return (
    (rows[0] as { member_id: string | null } | undefined)?.member_id ?? null
  );
}

async function connectorTierKey(
  client: PoolClient,
  tenantId: string,
): Promise<string | null> {
  const { rows } = await client.query(
    `select server_config ->> 'tierKey' as tier_key
       from tenant_integrations where tenant_id = $1 and provider = 'stripe'`,
    [tenantId],
  );
  return (rows[0] as { tier_key: string | null } | undefined)?.tier_key ?? null;
}
