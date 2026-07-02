/**
 * InterimStripeConnector (PRD-008a §1.1) — wave-2 implementation of CoachStripeConnector,
 * backed by the existing tenant_integrations encrypted-bytea vault (provider='stripe').
 * The coach's restricted API key + the per-tenant webhook signing secret are AES-256-GCM
 * encrypted into access_token_enc; non-secret config lives in server_config.
 *
 * INTERIM — replaced by the PRD-005c connector vault behind the same port in wave 4.
 */
import Stripe from "stripe";
import type { PoolClient } from "pg";
import { withSystem } from "../db.js";
import { encryptSecret, decryptSecret } from "../vault.js";
import type {
  CoachStripeConnector,
  ConnectParams,
  StripeConnectorConfig,
} from "./port.js";

interface VaultBundle {
  restrictedKey: string;
  webhookSecret: string;
}

interface IntegrationRow {
  server_config: StripeConnectorConfig | null;
  access_token_enc: Buffer | null;
  status: string;
}

function parseConfig(raw: unknown): StripeConnectorConfig {
  const c = (raw ?? {}) as Partial<StripeConnectorConfig>;
  return {
    stripeAccountRef: c.stripeAccountRef ?? null,
    priceId: c.priceId ?? null,
    tierKey: c.tierKey ?? null,
    webhookEndpointToken: c.webhookEndpointToken ?? null,
    webhookEndpointId: c.webhookEndpointId ?? null,
  };
}

export class InterimStripeConnector implements CoachStripeConnector {
  private async row(
    client: PoolClient,
    tenantId: string,
  ): Promise<IntegrationRow | null> {
    const { rows } = await client.query(
      `select server_config, access_token_enc, status
         from tenant_integrations
        where tenant_id = $1 and provider = 'stripe'`,
      [tenantId],
    );
    return (rows[0] as IntegrationRow | undefined) ?? null;
  }

  private bundle(row: IntegrationRow): VaultBundle {
    if (!row.access_token_enc) {
      throw new Error(
        "coach Stripe connector has no vaulted key (provision the restricted key first)",
      );
    }
    return JSON.parse(decryptSecret(row.access_token_enc)) as VaultBundle;
  }

  async getConfig(tenantId: string): Promise<StripeConnectorConfig | null> {
    return withSystem(async (client) => {
      const row = await this.row(client, tenantId);
      return row ? parseConfig(row.server_config) : null;
    });
  }

  async isConnected(tenantId: string): Promise<boolean> {
    return withSystem(async (client) => {
      const row = await this.row(client, tenantId);
      if (!row || row.status !== "connected" || !row.access_token_enc)
        return false;
      const cfg = parseConfig(row.server_config);
      return Boolean(cfg.priceId);
    });
  }

  async getClient(tenantId: string): Promise<Stripe> {
    return withSystem(async (client) => {
      const row = await this.row(client, tenantId);
      if (!row) throw new Error(`no Stripe connector for tenant ${tenantId}`);
      return new Stripe(this.bundle(row).restrictedKey);
    });
  }

  async resolveTenantByEndpoint(endpointToken: string): Promise<string | null> {
    if (!endpointToken) return null;
    return withSystem(async (client) => {
      const { rows } = await client.query(
        `select tenant_id from tenant_integrations
          where provider = 'stripe' and server_config ->> 'webhookEndpointToken' = $1
          limit 1`,
        [endpointToken],
      );
      return (rows[0] as { tenant_id: string } | undefined)?.tenant_id ?? null;
    });
  }

  async constructWebhookEvent(
    tenantId: string,
    rawBody: string,
    signature: string,
  ): Promise<Stripe.Event> {
    const { restrictedKey, webhookSecret } = await withSystem(
      async (client) => {
        const row = await this.row(client, tenantId);
        if (!row) throw new Error(`no Stripe connector for tenant ${tenantId}`);
        return this.bundle(row);
      },
    );
    // constructEvent is an offline HMAC check against the tenant's vault-held secret.
    const stripe = new Stripe(restrictedKey);
    return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  }

  async connect(tenantId: string, params: ConnectParams): Promise<void> {
    const bundle: VaultBundle = {
      restrictedKey: params.restrictedKey,
      webhookSecret: params.webhookSecret,
    };
    const config: StripeConnectorConfig = {
      stripeAccountRef: params.stripeAccountRef,
      priceId: params.priceId,
      tierKey: params.tierKey,
      webhookEndpointToken: params.webhookEndpointToken,
      webhookEndpointId: params.webhookEndpointId,
    };
    await withSystem(async (client) => {
      await client.query(
        `insert into tenant_integrations (tenant_id, provider, status, server_config, access_token_enc, token_rotated_at)
         values ($1, 'stripe', 'connected', $2, $3, now())
         on conflict (tenant_id, provider) do update
           set status = 'connected',
               server_config = excluded.server_config,
               access_token_enc = excluded.access_token_enc,
               token_rotated_at = now(),
               updated_at = now()`,
        [
          tenantId,
          JSON.stringify(config),
          encryptSecret(JSON.stringify(bundle)),
        ],
      );
    });
  }
}
