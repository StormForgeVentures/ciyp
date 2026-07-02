/**
 * Integration-test fixtures for the program-access store. Builds isolated tenant graphs
 * with RANDOM uuids (crypto.randomUUID) so parallel test files sharing the one local DB
 * never collide (skill-memory: unique fixture ids under a shared DB). Teardown is a single
 * cascade delete on the tenant. All writes run as the pool's default role (postgres →
 * bypassrls), exactly like the seed.
 */
import { randomUUID } from 'node:crypto';
import { getPool } from '../../src/store/db.js';
export async function buildTenantGraph(opts) {
    const tierSkus = opts.tierSkus ?? ['coaching_chat', 'voice'];
    const client = await getPool().connect();
    try {
        const tenantId = randomUUID();
        await client.query(`insert into tenants (id, slug, display_name) values ($1,$2,$3)`, [
            tenantId,
            `st-${tenantId.slice(0, 8)}`,
            'Store Test Tenant',
        ]);
        await client.query(`insert into app_config (tenant_id, model_routing) values ($1, '{"default":{"provider":"x","model":"y"}}'::jsonb)`, [tenantId]);
        await client.query(`insert into tenant_archetypes (tenant_id, key, label, prompt_fragment) values ($1,'op','Op','frag')`, [tenantId]);
        const tierKey = 'pro';
        const tier = await client.query(`insert into tenant_tiers (tenant_id, key, label, entitlements_jsonb)
       values ($1,$2,'Pro',$3::jsonb) returning id`, [tenantId, tierKey, JSON.stringify({ skus: tierSkus, voice_minutes: 120 })]);
        const tierId = tier.rows[0].id;
        const members = {};
        for (const key of opts.memberKeys) {
            const mId = randomUUID();
            await client.query(`insert into members (id, tenant_id, email, display_name, archetype_key, tier_key)
         values ($1,$2,$3,$4,'op',$5)`, [mId, tenantId, `${key}-${mId.slice(0, 8)}@st.test`, key, tierKey]);
            members[key] = mId;
        }
        return { tenantId, tierId, tierKey, tierSkus, members };
    }
    finally {
        client.release();
    }
}
export async function addSubscription(g, memberId, opts) {
    const client = await getPool().connect();
    try {
        const subId = opts.subId ?? `sub_${randomUUID()}`;
        const customerId = opts.customerId ?? `cus_${randomUUID()}`;
        const cpe = opts.periodEndDays === null ? null : new Date(Date.now() + opts.periodEndDays * 86_400_000);
        await client.query(`insert into member_subscriptions
         (tenant_id, member_id, tier_id, stripe_customer_id, stripe_subscription_id, stripe_status, current_period_end)
       values ($1,$2,$3,$4,$5,$6,$7)`, [g.tenantId, memberId, g.tierId, customerId, subId, opts.stripeStatus, cpe]);
    }
    finally {
        client.release();
    }
}
export async function query(sql, params = []) {
    const client = await getPool().connect();
    try {
        const r = await client.query(sql, params);
        return r.rows;
    }
    finally {
        client.release();
    }
}
export async function teardown(tenantId) {
    const client = await getPool().connect();
    try {
        await client.query(`delete from tenants where id = $1`, [tenantId]);
    }
    finally {
        client.release();
    }
}
//# sourceMappingURL=_fixture.js.map