/**
 * Program-access store routes (PRD-008a §1.2/§1.3). Mounted into the apps/api Hono app.
 * Kept in this module (not index.ts) so it composes cleanly with the 002/006 devs' routes;
 * the PM reconciles the single app.route() mount at the wave boundary.
 *
 *   POST /v1/checkout-session        — member session; creates checkout on the coach account
 *   GET  /v1/entitlement             — member session; contract-05 entitlement
 *   POST /webhooks/stripe/:endpoint  — public; Stripe-signature-verified per tenant
 */
import { Hono } from "hono";
import { verifyMemberSession } from "./auth.js";
import { withMemberSession } from "./db.js";
import { resolveEntitlement } from "./entitlement.js";
import { createCheckoutSession } from "./checkout.js";
import { handleStripeWebhook } from "./webhook.js";
import { InterimStripeConnector } from "./connector/interim.js";
import type { CoachStripeConnector } from "./connector/port.js";

export interface StoreRouteDeps {
  connector: CoachStripeConnector;
  successUrl: string;
  cancelUrl: string;
}

export function defaultStoreDeps(): StoreRouteDeps {
  return {
    connector: new InterimStripeConnector(),
    // Server-controlled return URLs (no open redirect). Provisioning (008b) sets per-tenant
    // URLs later; env override for now.
    successUrl:
      process.env.STORE_CHECKOUT_SUCCESS_URL ??
      "https://app.ciyp.example/store/success",
    cancelUrl:
      process.env.STORE_CHECKOUT_CANCEL_URL ??
      "https://app.ciyp.example/store/cancel",
  };
}

export function createStoreRoutes(deps: StoreRouteDeps): Hono {
  const store = new Hono();

  store.get("/v1/entitlement", async (c) => {
    const session = verifyMemberSession(c.req.header("authorization"));
    if (!session) return c.json({ error: "unauthorized" }, 401);
    // tenant + member come from the verified token ONLY (decision #19); any body/query
    // tenant_id/member_id is ignored, and the member RLS fence is the second layer.
    const entitlement = await withMemberSession(session, (client) =>
      resolveEntitlement(client, session),
    );
    return c.json(entitlement, 200);
  });

  store.post("/v1/checkout-session", async (c) => {
    const session = verifyMemberSession(c.req.header("authorization"));
    if (!session) return c.json({ error: "unauthorized" }, 401);
    const result = await createCheckoutSession(
      {
        connector: deps.connector,
        successUrl: deps.successUrl,
        cancelUrl: deps.cancelUrl,
      },
      session,
    );
    return c.json(result.body, result.status as 200 | 409 | 503);
  });

  store.post("/webhooks/stripe/:endpointToken", async (c) => {
    const endpointToken = c.req.param("endpointToken");
    const signature = c.req.header("stripe-signature");
    const rawBody = await c.req.text(); // RAW body required for signature verification
    const result = await handleStripeWebhook(
      { connector: deps.connector },
      { endpointToken, signature, rawBody },
    );
    return c.json(result.body, result.status as 200 | 400 | 404 | 500);
  });

  return store;
}
