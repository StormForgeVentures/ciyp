// Stripe webhook receiver — integration against the REAL local DB with REAL signature
// verification (PRD-008a §1.1). AC-2 completed→projection, AC-3 replay dedupe, plus
// signature-failure and subscription.updated period projection.
import { randomBytes, randomUUID } from "node:crypto";
process.env.CONNECTOR_VAULT_KEY ??= randomBytes(32).toString("base64");

import Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { InterimStripeConnector } from "../../src/store/connector/interim.js";
import { handleStripeWebhook } from "../../src/store/webhook.js";
import { closePool } from "../../src/store/db.js";
import {
  buildTenantGraph,
  query,
  teardown,
  type TenantGraph,
} from "./fixture.js";

const connector = new InterimStripeConnector();
// Signing helper — the API key is irrelevant to offline HMAC signing/verification.
const stripeLib = new Stripe("sk_test_signing_helper_unused");

// TEST-ONLY per-tenant webhook signing secret (not a real credential).
const WEBHOOK_SECRET = `whsec_test_${randomBytes(16).toString("hex")}`;
const ENDPOINT_TOKEN = `whep_test_${randomUUID()}`;

let G: TenantGraph;
let memberId: string;

function signed(event: Record<string, unknown>): {
  rawBody: string;
  signature: string;
} {
  const rawBody = JSON.stringify(event);
  const signature = stripeLib.webhooks.generateTestHeaderString({
    payload: rawBody,
    secret: WEBHOOK_SECRET,
  });
  return { rawBody, signature };
}

function checkoutCompletedEvent(
  subId: string,
  custId: string,
): Record<string, unknown> {
  return {
    id: `evt_${randomUUID()}`,
    object: "event",
    type: "checkout.session.completed",
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: `cs_${randomUUID()}`,
        object: "checkout.session",
        mode: "subscription",
        subscription: subId,
        customer: custId,
        client_reference_id: memberId,
        metadata: {
          member_id: memberId,
          tenant_id: G.tenantId,
          tier_key: "pro",
        },
      },
    },
  };
}

beforeAll(async () => {
  G = await buildTenantGraph({
    memberKeys: ["buyer"],
    tierSkus: ["coaching_chat", "voice"],
  });
  memberId = G.members.buyer!;
  await connector.connect(G.tenantId, {
    restrictedKey: "sk_test_coach_restricted",
    webhookSecret: WEBHOOK_SECRET,
    priceId: "price_test_program_access",
    tierKey: "pro",
    stripeAccountRef: "acct_test_coach",
    webhookEndpointToken: ENDPOINT_TOKEN,
    webhookEndpointId: "we_test",
  });
}, 60_000);

afterAll(async () => {
  await teardown(G.tenantId);
  await closePool();
});

describe("POST /webhooks/stripe (signature + dedupe + projection)", () => {
  it("AC-2: checkout.session.completed projects an active member_subscriptions row", async () => {
    const subId = `sub_${randomUUID()}`;
    const custId = `cus_${randomUUID()}`;
    const { rawBody, signature } = signed(
      checkoutCompletedEvent(subId, custId),
    );
    const result = await handleStripeWebhook(
      { connector },
      { endpointToken: ENDPOINT_TOKEN, signature, rawBody },
    );
    expect(result.status).toBe(200);
    expect(result.body.received).toBe(true);

    const rows = await query<{ stripe_status: string; tier_id: string }>(
      `select stripe_status, tier_id from member_subscriptions
        where tenant_id = $1 and stripe_subscription_id = $2`,
      [G.tenantId, subId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.stripe_status).toBe("active");
    expect(rows[0]!.tier_id).toBe(G.tierId);
    // stripe_customers mapping was written too.
    const cust = await query(
      `select 1 from stripe_customers where tenant_id = $1 and stripe_customer_id = $2`,
      [G.tenantId, custId],
    );
    expect(cust).toHaveLength(1);
  });

  it("AC-3: the same event delivered twice dedupes — one event row, one sub row, unchanged", async () => {
    const subId = `sub_${randomUUID()}`;
    const custId = `cus_${randomUUID()}`;
    const event = checkoutCompletedEvent(subId, custId);
    const { rawBody, signature } = signed(event);

    const first = await handleStripeWebhook(
      { connector },
      { endpointToken: ENDPOINT_TOKEN, signature, rawBody },
    );
    expect(first.status).toBe(200);
    expect(first.body.deduped).toBeUndefined();

    const second = await handleStripeWebhook(
      { connector },
      { endpointToken: ENDPOINT_TOKEN, signature, rawBody },
    );
    expect(second.status).toBe(200);
    expect(second.body.deduped).toBe(true);

    const events = await query(
      `select 1 from stripe_events where tenant_id = $1 and event_id = $2`,
      [G.tenantId, event.id],
    );
    expect(
      events,
      "exactly one stripe_events row for the replayed event id",
    ).toHaveLength(1);
    const subs = await query(
      `select 1 from member_subscriptions where tenant_id = $1 and stripe_subscription_id = $2`,
      [G.tenantId, subId],
    );
    expect(
      subs,
      "exactly one projected subscription row after replay",
    ).toHaveLength(1);
  });

  it("rejects a bad signature with 400 and writes nothing", async () => {
    const subId = `sub_${randomUUID()}`;
    const event = checkoutCompletedEvent(subId, `cus_${randomUUID()}`);
    const rawBody = JSON.stringify(event);
    // A signature computed with the WRONG secret must fail verification.
    const badSig = stripeLib.webhooks.generateTestHeaderString({
      payload: rawBody,
      secret: "whsec_wrong",
    });
    const result = await handleStripeWebhook(
      { connector },
      { endpointToken: ENDPOINT_TOKEN, signature: badSig, rawBody },
    );
    expect(result.status).toBe(400);
    const rows = await query(
      `select 1 from stripe_events where tenant_id = $1 and event_id = $2`,
      [G.tenantId, event.id],
    );
    expect(rows, "no event recorded on signature failure").toHaveLength(0);
  });

  it("returns 404 for an unknown webhook endpoint token", async () => {
    const { rawBody, signature } = signed(
      checkoutCompletedEvent(`sub_${randomUUID()}`, `cus_${randomUUID()}`),
    );
    const result = await handleStripeWebhook(
      { connector },
      { endpointToken: "whep_does_not_exist", signature, rawBody },
    );
    expect(result.status).toBe(404);
  });

  it("customer.subscription.updated projects the new period end onto the existing row", async () => {
    // First create the subscription via checkout.
    const subId = `sub_${randomUUID()}`;
    const custId = `cus_${randomUUID()}`;
    const created = signed(checkoutCompletedEvent(subId, custId));
    await handleStripeWebhook(
      { connector },
      {
        endpointToken: ENDPOINT_TOKEN,
        signature: created.signature,
        rawBody: created.rawBody,
      },
    );

    const periodEnd = Math.floor(Date.now() / 1000) + 30 * 86_400;
    const updateEvent = {
      id: `evt_${randomUUID()}`,
      object: "event",
      type: "customer.subscription.updated",
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: subId,
          object: "subscription",
          customer: custId,
          status: "active",
          current_period_end: periodEnd,
          metadata: { member_id: memberId, tenant_id: G.tenantId },
          items: { object: "list", data: [{ current_period_end: periodEnd }] },
        },
      },
    };
    const { rawBody, signature } = signed(updateEvent);
    const result = await handleStripeWebhook(
      { connector },
      { endpointToken: ENDPOINT_TOKEN, signature, rawBody },
    );
    expect(result.status).toBe(200);

    const rows = await query<{ current_period_end: Date | null }>(
      `select current_period_end from member_subscriptions where tenant_id = $1 and stripe_subscription_id = $2`,
      [G.tenantId, subId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.current_period_end).not.toBeNull();
  });
});
