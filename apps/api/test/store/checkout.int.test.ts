// Checkout-session creation — Stripe API mocked (a stub connector), DB real (PRD-008a
// §1.2). AC-1 price + member metadata + no platform fee; 409 already-active; 503
// unprovisioned / unconnected.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { createCheckoutSession } from "../../src/store/checkout.js";
import { closePool } from "../../src/store/db.js";
import type {
  CoachStripeConnector,
  StripeConnectorConfig,
} from "../../src/store/connector/port.js";
import {
  addSubscription,
  buildTenantGraph,
  teardown,
  type TenantGraph,
} from "./fixture.js";

let G: TenantGraph;

const CONNECTED_CONFIG: StripeConnectorConfig = {
  stripeAccountRef: "acct_stub",
  priceId: "price_stub_program_access",
  tierKey: "pro",
  webhookEndpointToken: "whep_stub",
  webhookEndpointId: "we_stub",
};

interface StubOpts {
  config?: StripeConnectorConfig | null;
  connected?: boolean;
}

function makeStubConnector(opts: StubOpts) {
  const create = vi.fn(
    async (_params: Stripe.Checkout.SessionCreateParams) => ({
      id: "cs_stub_1",
      url: "https://checkout.stripe.test/cs_stub_1",
    }),
  );
  const client = { checkout: { sessions: { create } } } as unknown as Stripe;
  const connector: CoachStripeConnector = {
    getConfig: async () => opts.config ?? null,
    isConnected: async () => opts.connected ?? false,
    getClient: async () => client,
    resolveTenantByEndpoint: async () => null,
    constructWebhookEvent: async () => {
      throw new Error("not used");
    },
    connect: async () => undefined,
  };
  return { connector, create };
}

const deps = (connector: CoachStripeConnector) => ({
  connector,
  successUrl: "https://app.test/success",
  cancelUrl: "https://app.test/cancel",
});

beforeAll(async () => {
  G = await buildTenantGraph({ memberKeys: ["fresh", "entitled"] });
  await addSubscription(G, G.members.entitled!, {
    stripeStatus: "active",
    periodEndDays: 30,
  });
}, 60_000);

afterAll(async () => {
  await teardown(G.tenantId);
  await closePool();
});

describe("POST /v1/checkout-session", () => {
  it("AC-1: creates a session on the coach price with the member id in metadata and no platform fee", async () => {
    const { connector, create } = makeStubConnector({
      config: CONNECTED_CONFIG,
      connected: true,
    });
    const session = { tenantId: G.tenantId, memberId: G.members.fresh! };
    const result = await createCheckoutSession(deps(connector), session);
    expect(result.status).toBe(200);
    expect(result.body.url).toBe("https://checkout.stripe.test/cs_stub_1");

    expect(create).toHaveBeenCalledTimes(1);
    const params = create.mock.calls[0]![0];
    expect(params.mode).toBe("subscription");
    expect(params.line_items?.[0]?.price).toBe(CONNECTED_CONFIG.priceId);
    expect(params.client_reference_id).toBe(G.members.fresh);
    expect(params.metadata?.member_id).toBe(G.members.fresh);
    expect(params.metadata?.tenant_id).toBe(G.tenantId);
    // ADR-008: the coach keeps 100% — no application fee of any kind.
    expect(
      (params as Record<string, unknown>).application_fee_amount,
    ).toBeUndefined();
    expect(
      (params as Record<string, unknown>).application_fee_percent,
    ).toBeUndefined();
  });

  it("409: a member who already holds active access cannot re-checkout", async () => {
    const { connector, create } = makeStubConnector({
      config: CONNECTED_CONFIG,
      connected: true,
    });
    const session = { tenantId: G.tenantId, memberId: G.members.entitled! };
    const result = await createCheckoutSession(deps(connector), session);
    expect(result.status).toBe(409);
    expect(result.body.error).toBe("already_entitled");
    expect(create).not.toHaveBeenCalled();
  });

  it("503: unprovisioned tenant (no price) is rejected before any Stripe call", async () => {
    const { connector, create } = makeStubConnector({
      config: null,
      connected: false,
    });
    const result = await createCheckoutSession(deps(connector), {
      tenantId: G.tenantId,
      memberId: G.members.fresh!,
    });
    expect(result.status).toBe(503);
    expect(result.body.error).toBe("stripe_unprovisioned");
    expect(create).not.toHaveBeenCalled();
  });

  it("503: provisioned price but connector not connected is rejected", async () => {
    const { connector } = makeStubConnector({
      config: CONNECTED_CONFIG,
      connected: false,
    });
    const result = await createCheckoutSession(deps(connector), {
      tenantId: G.tenantId,
      memberId: G.members.fresh!,
    });
    expect(result.status).toBe(503);
    expect(result.body.error).toBe("stripe_unconnected");
  });
});
