// Entitlement projection — integration against the REAL local DB (PRD-008a §1.3).
// AC-4 contract-05 schema (on a fixture AND on a real seed member), AC-7 expiry fixture,
// AC-8 RLS fence (decision #19). Driven through the member-scoped, RLS-enforced DB session
// (withMemberSession) so the projection + fence are exercised without a transport/token
// shortcut — the real HTTP auth path (Supabase JWKS → DB principal) is proven separately in
// member-auth.int.test.ts. Runs in CI (DB only, no auth server needed).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Entitlement } from "@stormforgeventures/ciyp-shared";
import { resolveEntitlement } from "../../src/store/entitlement.js";
import { withMemberSession, closePool } from "../../src/store/db.js";
import type { MemberSession } from "../../src/store/member-auth.js";
import {
  addSubscription,
  buildTenantGraph,
  query,
  teardown,
  type TenantGraph,
} from "./fixture.js";

let A: TenantGraph;
let B: TenantGraph;

/** Resolve the contract-05 entitlement exactly as the route does: member-scoped, RLS-fenced. */
async function entitlementFor(session: MemberSession) {
  return withMemberSession(session, (client) =>
    resolveEntitlement(client, session),
  );
}

beforeAll(async () => {
  A = await buildTenantGraph({
    memberKeys: ["active", "expired", "ac7"],
    tierSkus: ["coaching_chat", "voice"],
  });
  B = await buildTenantGraph({
    memberKeys: ["other"],
    tierSkus: ["coaching_chat"],
  });
  await addSubscription(A, A.members.active!, {
    stripeStatus: "active",
    periodEndDays: 30,
  });
  await addSubscription(A, A.members.expired!, {
    stripeStatus: "active",
    periodEndDays: -5,
  });
  await addSubscription(A, A.members.ac7!, {
    stripeStatus: "active",
    periodEndDays: 30,
  });
  await addSubscription(B, B.members.other!, {
    stripeStatus: "active",
    periodEndDays: 30,
  });
}, 60_000);

afterAll(async () => {
  await teardown(A.tenantId);
  await teardown(B.tenantId);
  await closePool();
});

describe("entitlement projection (contract 05)", () => {
  it("AC-4: an entitled member gets a contract-05-valid active entitlement", async () => {
    const ent = await entitlementFor({
      tenantId: A.tenantId,
      memberId: A.members.active!,
    });
    expect(() => Entitlement.parse(ent)).not.toThrow();
    expect(ent.memberId).toBe(A.members.active);
    expect(ent.tenantId).toBe(A.tenantId);
    expect(ent.status).toBe("active");
    expect(ent.tierKey).toBe("pro");
    expect(ent.features).toContain("coaching_chat");
    expect(ent.source).toBe("stripe");
  });

  it("AC-4 (real seed data): the seed active member resolves to a contract-05 active entitlement", async () => {
    const rows = await query<{ tenant_id: string; id: string }>(
      `select m.id, m.tenant_id from members m join tenants t on t.id = m.tenant_id
        where t.slug = 'luminify' and m.email = 'ada.new@example.com' limit 1`,
    );
    expect(rows.length, "seed member ada.new must exist — run pnpm seed").toBe(
      1,
    );
    const ent = await entitlementFor({
      tenantId: rows[0]!.tenant_id,
      memberId: rows[0]!.id,
    });
    expect(ent.status).toBe("active");
    expect(ent.memberId).toBe(rows[0]!.id);
  });

  it("AC-4: a member with no subscription resolves to status none (never an error)", async () => {
    const rows = await query<{ id: string }>(
      `select m.id from members m join tenants t on t.id = m.tenant_id
        where t.slug = 'luminify' and m.email = 'cleo.expired@example.com' limit 1`,
    );
    // (seed cleo is expired, but assert the null-path via a fresh member with no sub)
    const graph = await buildTenantGraph({ memberKeys: ["nosub"] });
    try {
      const ent = await entitlementFor({
        tenantId: graph.tenantId,
        memberId: graph.members.nosub!,
      });
      expect(ent.status).toBe("none");
      expect(ent.tierKey).toBeNull();
      expect(ent.features).toEqual([]);
      expect(rows.length).toBe(1); // sanity: seed present
    } finally {
      await teardown(graph.tenantId);
    }
  });

  it("AC-7: a subscription whose current_period_end is moved into the past reads as expired", async () => {
    await query(
      `update member_subscriptions set current_period_end = now() - interval '1 day', updated_at = now()
        where tenant_id = $1 and member_id = $2`,
      [A.tenantId, A.members.ac7!],
    );
    const ent = await entitlementFor({
      tenantId: A.tenantId,
      memberId: A.members.ac7!,
    });
    expect(ent.status).toBe("expired");
  });

  it("AC-7: the seed expired member reads as expired", async () => {
    const rows = await query<{ id: string; tenant_id: string }>(
      `select m.id, m.tenant_id from members m join tenants t on t.id = m.tenant_id
        where t.slug = 'luminify' and m.email = 'cleo.expired@example.com' limit 1`,
    );
    const ent = await entitlementFor({
      tenantId: rows[0]!.tenant_id,
      memberId: rows[0]!.id,
    });
    expect(ent.status).toBe("expired");
  });

  it("AC-8 (RLS layer): under member A-active session, no other member/tenant rows are readable", async () => {
    await withMemberSession(
      { tenantId: A.tenantId, memberId: A.members.active! },
      async (client) => {
        // Another member in the SAME tenant → member fence returns zero.
        const sameTenantOther = await client.query(
          `select count(*)::int n from member_subscriptions where member_id = $1`,
          [A.members.expired!],
        );
        expect((sameTenantOther.rows[0] as { n: number }).n).toBe(0);
        // A member in tenant B → tenant + member fence returns zero.
        const crossTenant = await client.query(
          `select count(*)::int n from member_subscriptions where member_id = $1`,
          [B.members.other!],
        );
        expect((crossTenant.rows[0] as { n: number }).n).toBe(0);
        // Own row is visible.
        const own = await client.query(
          `select count(*)::int n from member_subscriptions where member_id = $1`,
          [A.members.active!],
        );
        expect((own.rows[0] as { n: number }).n).toBe(1);
      },
    );
  });
});
