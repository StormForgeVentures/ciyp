/**
 * Member-session verification (PRD-008a §1.3, decision #19 / wave-2 H-1 closure).
 *
 * This REPLACES the interim self-minted HS256 seam (removed). Member identity is now bound to
 * a real Supabase Auth session the same way the admin surface binds the coach principal
 * (auth/session.ts + auth/principal.ts): the Supabase access token is JWKS-verified (ES256,
 * asymmetric — the shipped contract, not a shared symmetric secret), and the resulting `sub`
 * (auth.users id) is resolved to a `members` row in the DB. tenantId and memberId come ONLY
 * from that DB row — never from the token body, never from any request input.
 *
 * There is no token-asserted (tenant, member) pair to forge: knowing any secret no longer
 * yields impersonation, because membership is a DB fact keyed by the verified auth user. This
 * is the same "identity is bound, not asserted" discipline decision #19 requires of every
 * money/PII surface (wave-1 H2), applied at the store layer.
 */
import { verifySession, bearerFrom } from "../auth/session.js";
import { withSystem } from "./db.js";

export interface MemberSession {
  tenantId: string;
  memberId: string;
}

/**
 * Resolve a verified auth user to their single CIYP membership, or null.
 *
 * Runs as the bypassrls system role (no tenant scope exists yet — this lookup is what
 * establishes it), keyed ONLY by the verified auth_user_id. Fail-closed:
 *   - 0 rows  → the auth user is not a member of any tenant → null (caller returns 401).
 *   - 1 row   → that IS the identity.
 *   - >1 rows → a person enrolled with multiple coaches. Which tenant a member acts in when
 *               they hold several memberships is a disambiguation PRD-003's member coaching
 *               route owns; until it lands we fail closed rather than silently pick a tenant.
 */
export async function resolveMemberPrincipal(
  authUserId: string,
): Promise<MemberSession | null> {
  return withSystem(async (c) => {
    const { rows } = await c.query<{ tenant_id: string; member_id: string }>(
      `select tenant_id, id as member_id from members where auth_user_id = $1`,
      [authUserId],
    );
    if (rows.length !== 1) return null;
    return { tenantId: rows[0]!.tenant_id, memberId: rows[0]!.member_id };
  });
}

/**
 * Verify an Authorization header → MemberSession, or null when the token is
 * invalid/expired/foreign-project, or the verified auth user is not a (single) member.
 * The identity returned is DB-derived; request body/query/headers are never consulted.
 */
export async function verifiedMemberSession(
  authHeader: string | undefined,
): Promise<MemberSession | null> {
  const token = bearerFrom(authHeader);
  if (!token) return null;
  let authUserId: string;
  try {
    ({ authUserId } = await verifySession(token));
  } catch {
    return null; // forged / expired / wrong-project token
  }
  if (!authUserId) return null;
  return resolveMemberPrincipal(authUserId);
}
