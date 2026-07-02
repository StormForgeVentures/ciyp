/**
 * CoachStripeConnector — the swappable seam between the program-access store and the
 * coach's own Stripe account (ADR-008: member funds settle on the coach account via a
 * GHL-style restricted API key; the platform never holds member money and takes no fee).
 *
 * WAVE-2 INTERIM vs PRD-005c: this interface is the stable contract. Wave 2 ships
 * InterimStripeConnector (below in ./interim.ts), backed by the existing
 * tenant_integrations encrypted-bytea vault. The full PRD-005c connector framework
 * (KMS-backed DEK, key rotation, per-tenant MCP catalog, OAuth) drops in behind THIS
 * port in wave 4 with no change to checkout/webhook/entitlement callers.
 */
import type Stripe from "stripe";

/** Non-secret connection metadata (stored in tenant_integrations.server_config). */
export interface StripeConnectorConfig {
  stripeAccountRef: string | null;
  /** The tenant's single program-access price (created on the coach account at provisioning, 008b). */
  priceId: string | null;
  /** The tier the program-access SKU grants (→ tenant_tiers.key). */
  tierKey: string | null;
  /** Opaque token embedded in the per-tenant webhook URL → resolves the tenant by endpoint identity. */
  webhookEndpointToken: string | null;
  webhookEndpointId: string | null;
}

/** Provisioning-time input (008b / tests): the coach's restricted key + the per-tenant
 *  webhook signing secret returned when the endpoint is created on their account. */
export interface ConnectParams extends StripeConnectorConfig {
  restrictedKey: string;
  webhookSecret: string;
}

export interface CoachStripeConnector {
  /** True once a usable restricted key + config exist for the tenant. */
  isConnected(tenantId: string): Promise<boolean>;
  /** Non-secret config, or null if the tenant has no Stripe connector row. */
  getConfig(tenantId: string): Promise<StripeConnectorConfig | null>;
  /** A Stripe client bound to the coach's restricted key (from the vault). */
  getClient(tenantId: string): Promise<Stripe>;
  /** Resolve which tenant owns a webhook endpoint token (BY ENDPOINT IDENTITY, ADR-008). */
  resolveTenantByEndpoint(endpointToken: string): Promise<string | null>;
  /** Verify a webhook signature with the tenant's vault-held signing secret; throws on failure. */
  constructWebhookEvent(
    tenantId: string,
    rawBody: string,
    signature: string,
  ): Promise<Stripe.Event>;
  /** Store/replace a tenant's Stripe connection (restricted key + webhook secret + config). */
  connect(tenantId: string, params: ConnectParams): Promise<void>;
}
