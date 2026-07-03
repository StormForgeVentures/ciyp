/**
 * Store member-auth — REAL Supabase Auth path (PRD-008a §1.3, wave-2 H-1 closure).
 *
 * Proves the interim self-minted HS256 seam is gone and identity is now DB-bound to a
 * JWKS-verified Supabase session (decision #19 / wave-1 H2 discipline at the store layer):
 *
 *   - A member with a linked Supabase auth user reads exactly their own entitlement.
 *   - The H-1 exploit is dead: there is no token-asserted (tenant, member) pair. Forged
 *     tenant_id/member_id in the query/headers are ignored (AC-8), and a token for auth user
 *     U-a can NEVER yield member B's data — the only way to be member B is to hold member B's
 *     Supabase session. Knowing any secret no longer forges a membership.
 *   - A valid Supabase token whose auth user is not (uniquely) a member → 401.
 *
 * Uses real GoTrue password grants (ES256/JWKS) — the exact verification path production runs.
 * CI runs bare Postgres with no auth server, so the HTTP suite skips when GoTrue is unreachable
 * (the resolver-level checks that need only the DB still run).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Entitlement } from "@stormforgeventures/ciyp-shared";
import { app } from "../../src/index.js";
import { closePool } from "../../src/store/db.js";
import { resolveMemberPrincipal } from "../../src/store/member-auth.js";
import {
  accessToken,
  addSubscription,
  authServerReachable,
  buildTenantGraph,
  deleteAuthUser,
  ensureAuthUser,
  provisionMemberAuth,
  query,
  teardown,
  type TenantGraph,
} from "./fixture.js";

const AUTH_UP = await authServerReachable();
if (!AUTH_UP) {
  console.warn(
    "member-auth.int.test.ts: Supabase Auth (GoTrue) not reachable — skipping HTTP auth suite",
  );
}

let A: TenantGraph;
let B: TenantGraph;
const created: string[] = []; // auth-user ids to clean up
let aToken = "";
let aAuthUserId = "";

async function getEntitlement(
  token: string | undefined,
  urlSuffix = "",
  extraHeaders: Record<string, string> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers: Record<string, string> = { ...extraHeaders };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await app.request(`/v1/entitlement${urlSuffix}`, { headers });
  return {
    status: res.status,
    body: (await res.json().catch(() => ({}))) as Record<string, unknown>,
  };
}

beforeAll(async () => {
  A = await buildTenantGraph({
    memberKeys: ["active"],
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
  await addSubscription(B, B.members.other!, {
    stripeStatus: "active",
    periodEndDays: 30,
  });
  if (AUTH_UP) {
    const provisioned = await provisionMemberAuth(
      A.members.active!,
      `store-auth-a-${A.members.active!.slice(0, 8)}@st.test`,
    );
    aToken = provisioned.token;
    aAuthUserId = provisioned.authUserId;
    created.push(aAuthUserId);
  }
}, 60_000);

afterAll(async () => {
  for (const id of created) await deleteAuthUser(id);
  await teardown(A.tenantId);
  await teardown(B.tenantId);
  await closePool();
});

describe("resolveMemberPrincipal (DB-bound identity)", () => {
  it("returns the member's (tenant, member) derived from the DB row", async () => {
    if (!AUTH_UP) return; // needs the linked auth user
    const principal = await resolveMemberPrincipal(aAuthUserId);
    expect(principal).toEqual({
      tenantId: A.tenantId,
      memberId: A.members.active!,
    });
  });

  it("an auth user linked to no member resolves to null (cannot fabricate membership)", async () => {
    const principal = await resolveMemberPrincipal(randomUUID());
    expect(principal).toBeNull();
  });

  it("fails closed when one auth user maps to members in multiple tenants (PRD-003 disambiguation)", async () => {
    const authUserId = randomUUID();
    // Link the SAME auth user to a member in tenant A and one in tenant B.
    await query(`update members set auth_user_id = $1 where id = $2`, [
      authUserId,
      A.members.active!,
    ]);
    await query(`update members set auth_user_id = $1 where id = $2`, [
      authUserId,
      B.members.other!,
    ]);
    try {
      expect(await resolveMemberPrincipal(authUserId)).toBeNull();
    } finally {
      // Unlink so the HTTP suite's A-active linkage is not disturbed.
      await query(
        `update members set auth_user_id = null where auth_user_id = $1`,
        [authUserId],
      );
      // Re-link A-active to its real auth user for the remaining HTTP tests.
      if (AUTH_UP)
        await query(`update members set auth_user_id = $1 where id = $2`, [
          aAuthUserId,
          A.members.active!,
        ]);
    }
  });
});

describe("GET /v1/entitlement — real Supabase Auth", () => {
  it("a member with a linked Supabase session reads their own contract-05 entitlement", async () => {
    if (!AUTH_UP) return;
    const { status, body } = await getEntitlement(aToken);
    expect(status).toBe(200);
    const ent = Entitlement.parse(body);
    expect(ent.memberId).toBe(A.members.active);
    expect(ent.tenantId).toBe(A.tenantId);
    expect(ent.status).toBe("active");
  });

  it("AC-8 / H-1: forged tenant_id/member_id in query + headers are ignored — identity is DB-derived from the token", async () => {
    if (!AUTH_UP) return;
    const suffix = `?tenant_id=${B.tenantId}&member_id=${B.members.other}`;
    const { status, body } = await getEntitlement(aToken, suffix, {
      "x-tenant-id": B.tenantId,
      "x-member-id": B.members.other!,
    });
    expect(status).toBe(200);
    const ent = Entitlement.parse(body);
    // The forged (tenant B, member B) NEVER wins — still tenant A's own member.
    expect(ent.memberId).toBe(A.members.active);
    expect(ent.tenantId).toBe(A.tenantId);
    expect(ent.tenantId).not.toBe(B.tenantId);
    expect(ent.memberId).not.toBe(B.members.other);
  });

  it("H-1: a valid Supabase token whose auth user is not a member → 401 (no secret forges membership)", async () => {
    if (!AUTH_UP) return;
    const email = `store-auth-nomember-${randomUUID().slice(0, 8)}@st.test`;
    const id = await ensureAuthUser(email);
    created.push(id); // clean up in teardown
    const token = await accessToken(email);
    const { status } = await getEntitlement(token);
    expect(status).toBe(401);
  });

  it("no token → 401; garbage token → 401", async () => {
    expect((await getEntitlement(undefined)).status).toBe(401);
    expect((await getEntitlement("not-a-jwt")).status).toBe(401);
  });
});
