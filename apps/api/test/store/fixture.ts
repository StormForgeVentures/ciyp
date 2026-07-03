/**
 * Integration-test fixtures for the program-access store. Builds isolated tenant graphs
 * with RANDOM uuids (crypto.randomUUID) so parallel test files sharing the one local DB
 * never collide (skill-memory: unique fixture ids under a shared DB). Teardown is a single
 * cascade delete on the tenant. All writes run as the pool's default role (postgres →
 * bypassrls), exactly like the seed.
 */
import { randomUUID } from "node:crypto";
import { getPool } from "../../src/store/db.js";
import { env } from "../../src/lib/env.js";

export interface TenantGraph {
  tenantId: string;
  tierId: string;
  tierKey: string;
  tierSkus: string[];
  members: Record<string, string>;
}

export async function buildTenantGraph(opts: {
  memberKeys: string[];
  tierSkus?: string[];
}): Promise<TenantGraph> {
  const tierSkus = opts.tierSkus ?? ["coaching_chat", "voice"];
  const client = await getPool().connect();
  try {
    const tenantId = randomUUID();
    await client.query(
      `insert into tenants (id, slug, display_name) values ($1,$2,$3)`,
      [tenantId, `st-${tenantId.slice(0, 8)}`, "Store Test Tenant"],
    );
    await client.query(
      `insert into app_config (tenant_id, model_routing) values ($1, '{"default":{"provider":"x","model":"y"}}'::jsonb)`,
      [tenantId],
    );
    await client.query(
      `insert into tenant_archetypes (tenant_id, key, label, prompt_fragment) values ($1,'op','Op','frag')`,
      [tenantId],
    );
    const tierKey = "pro";
    const tier = await client.query(
      `insert into tenant_tiers (tenant_id, key, label, entitlements_jsonb)
       values ($1,$2,'Pro',$3::jsonb) returning id`,
      [
        tenantId,
        tierKey,
        JSON.stringify({ skus: tierSkus, voice_minutes: 120 }),
      ],
    );
    const tierId = (tier.rows[0] as { id: string }).id;

    const members: Record<string, string> = {};
    for (const key of opts.memberKeys) {
      const mId = randomUUID();
      await client.query(
        `insert into members (id, tenant_id, email, display_name, archetype_key, tier_key)
         values ($1,$2,$3,$4,'op',$5)`,
        [mId, tenantId, `${key}-${mId.slice(0, 8)}@st.test`, key, tierKey],
      );
      members[key] = mId;
    }
    return { tenantId, tierId, tierKey, tierSkus, members };
  } finally {
    client.release();
  }
}

export async function addSubscription(
  g: TenantGraph,
  memberId: string,
  opts: {
    stripeStatus: string;
    periodEndDays: number | null;
    subId?: string;
    customerId?: string;
  },
): Promise<void> {
  const client = await getPool().connect();
  try {
    const subId = opts.subId ?? `sub_${randomUUID()}`;
    const customerId = opts.customerId ?? `cus_${randomUUID()}`;
    const cpe =
      opts.periodEndDays === null
        ? null
        : new Date(Date.now() + opts.periodEndDays * 86_400_000);
    await client.query(
      `insert into member_subscriptions
         (tenant_id, member_id, tier_id, stripe_customer_id, stripe_subscription_id, stripe_status, current_period_end)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [
        g.tenantId,
        memberId,
        g.tierId,
        customerId,
        subId,
        opts.stripeStatus,
        cpe,
      ],
    );
  } finally {
    client.release();
  }
}

export async function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const client = await getPool().connect();
  try {
    const r = await client.query(sql, params);
    return r.rows as T[];
  } finally {
    client.release();
  }
}

export async function teardown(tenantId: string): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query(`delete from tenants where id = $1`, [tenantId]);
  } finally {
    client.release();
  }
}

// ── Real Supabase Auth (GoTrue) provisioning — how a member authenticates in production. ──
// The store's member verifier resolves identity from a JWKS-verified Supabase session, so the
// integration path must use real GoTrue users, not a minted-token shortcut (mirrors the admin
// suite). Passwords come from SEED_ADMIN_PASSWORD (see .env.example); never hard-coded.

const PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "";

function adminHeaders(): Record<string, string> {
  const key = env.supabaseServiceRoleKey();
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

/** True when local GoTrue is up (CI runs bare Postgres with no auth server → skip). */
export async function authServerReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${env.supabaseUrl()}/auth/v1/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Create (or find) a GoTrue user, returning its auth.users id. Idempotent. */
export async function ensureAuthUser(email: string): Promise<string> {
  const res = await fetch(`${env.supabaseUrl()}/auth/v1/admin/users`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({ email, password: PASSWORD, email_confirm: true }),
  });
  if (res.ok) return ((await res.json()) as { id: string }).id;
  const list = await fetch(
    `${env.supabaseUrl()}/auth/v1/admin/users?per_page=200`,
    { headers: adminHeaders() },
  );
  const body = (await list.json()) as {
    users?: { id: string; email?: string }[];
  };
  const found = body.users?.find(
    (u) => u.email?.toLowerCase() === email.toLowerCase(),
  );
  if (!found) throw new Error(`could not create/find auth user ${email}`);
  return found.id;
}

/** Delete a GoTrue user (teardown — avoid orphan accumulation across runs). */
export async function deleteAuthUser(authUserId: string): Promise<void> {
  await fetch(`${env.supabaseUrl()}/auth/v1/admin/users/${authUserId}`, {
    method: "DELETE",
    headers: adminHeaders(),
  }).catch(() => undefined);
}

/** Real password-grant access token (ES256, verified by the store via JWKS). */
export async function accessToken(email: string): Promise<string> {
  const res = await fetch(
    `${env.supabaseUrl()}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: {
        apikey: env.supabaseAnonKey(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password: PASSWORD }),
    },
  );
  if (!res.ok)
    throw new Error(`token grant failed for ${email}: ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

/**
 * Provision a member's Supabase Auth identity: mint a GoTrue user, link it to the member row
 * (members.auth_user_id), and return the auth-user id + a real access token. This is exactly
 * how the store's production verifier is reached — the DB linkage is the identity binding.
 */
export async function provisionMemberAuth(
  memberId: string,
  email: string,
): Promise<{ authUserId: string; token: string }> {
  const authUserId = await ensureAuthUser(email);
  await query(`update members set auth_user_id = $1 where id = $2`, [
    authUserId,
    memberId,
  ]);
  const token = await accessToken(email);
  return { authUserId, token };
}
