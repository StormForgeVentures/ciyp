export const T_A = 'a9700001-0000-4000-8000-0000000000aa';
export const T_B = 'b9700001-0000-4000-8000-0000000000bb';
export const A_MEMBER = 'a9700001-0000-4000-8000-0000000000a1';
export const B_MEMBER = 'b9700001-0000-4000-8000-0000000000b1';
export const A_ADMIN = 'a9700001-0000-4000-8000-0000000000da';
export const B_ADMIN = 'b9700001-0000-4000-8000-0000000000db';
/** A deterministic normalized-ish 1024-dim vector literal for pgvector inserts. */
export function vec(seed) {
    const v = new Array(1024);
    for (let i = 0; i < 1024; i++)
        v[i] = Math.sin((i + 1) * (seed + 1) * 0.001);
    return `[${v.join(',')}]`;
}
export const A_ROUTING = {
    default: { provider: 'openrouter', model: 'anthropic/claude-sonnet-4.6' },
    fast: { provider: 'openrouter', model: 'anthropic/claude-haiku-4.5' },
    classify: { provider: 'openrouter', model: 'anthropic/claude-haiku-4.5' },
    embed: { provider: 'voyage', model: 'voyage-3-large', output_dimension: 1024 },
    rerank: { provider: 'voyage', model: 'rerank-2.5' },
};
// Tenant B overrides `default` to a DIFFERENT model — the behavior divergence under test.
export const B_ROUTING = {
    ...A_ROUTING,
    default: { provider: 'openrouter', model: 'openai/gpt-4o' },
};
async function seedTenant(c, t, member, admin, routing, chunkText, seed) {
    await c.query(`insert into tenants (id, slug, display_name) values ($1,$2,$3)`, [
        t,
        `spr-${t.slice(0, 8)}`,
        `spr ${t.slice(0, 4)}`,
    ]);
    await c.query(`insert into app_config (tenant_id, model_routing) values ($1, $2::jsonb)`, [
        t,
        JSON.stringify(routing),
    ]);
    await c.query(`insert into admins (id, tenant_id, email, display_name, role) values ($1,$2,$3,'spr admin','owner')`, [admin, t, `admin-${t.slice(0, 6)}@spr`]);
    await c.query(`insert into members (id, tenant_id, email, display_name) values ($1,$2,$3,'spr member')`, [member, t, `m-${t.slice(0, 6)}@spr`]);
    await c.query(`insert into library_items (tenant_id, kind, title, storage_kind, storage_id, created_by_admin_id) values ($1,'article',$2,'supabase_storage','spr/1',$3)`, [t, `Doc ${t.slice(0, 4)}`, admin]);
    const item = (await c.query(`select id from library_items where tenant_id=$1 limit 1`, [t])).rows[0];
    await c.query(`insert into library_chunks (tenant_id, library_item_id, chunk_index, text, embedding) values ($1,$2,0,$3,$4::vector)`, [t, item.id, chunkText, vec(seed)]);
}
export async function seedTwoTenants(c) {
    await teardownTwoTenants(c);
    await seedTenant(c, T_A, A_MEMBER, A_ADMIN, A_ROUTING, 'tenant A private library chunk', 1);
    await seedTenant(c, T_B, B_MEMBER, B_ADMIN, B_ROUTING, 'tenant B private library chunk', 7);
}
export async function teardownTwoTenants(c) {
    await c.query(`delete from tenants where id = any($1::uuid[])`, [[T_A, T_B]]);
}
//# sourceMappingURL=fixtures.js.map