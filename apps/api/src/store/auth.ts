/**
 * Interim member-session verification (PRD-008a §1.3, decision #19). The member's
 * identity — tenantId + memberId — is derived ONLY from a verified, signed token, never
 * from the request body/query. AC-8 forges body params against this; they are ignored.
 *
 * INTERIM SEAM — the production path is Supabase Auth: verify the Supabase JWT (HS256,
 * project secret) and map `sub` → members.auth_user_id → (tenant_id, member_id). That
 * middleware lands with the shared apps/api auth layer (002/006 devs own index.ts +
 * middleware; PM reconciles at the wave boundary). Here we verify an HS256 token whose
 * claims carry {tid, mid} so the identity-from-token invariant is exercised end-to-end.
 * Alg is PINNED to HS256 (no `none`, no alg negotiation → no alg-confusion), signature
 * is compared in constant time, and exp is enforced.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { requireEnv } from "./env.js";

export interface MemberSession {
  tenantId: string;
  memberId: string;
}

interface TokenPayload {
  tid?: unknown;
  mid?: unknown;
  iat?: unknown;
  exp?: unknown;
}

const b64url = (input: Buffer | string): string =>
  Buffer.from(input).toString("base64url");

/** Mint a member-session token (used by the interim login seam + tests). */
export function signMemberSession(
  session: MemberSession,
  opts?: { ttlSeconds?: number; secret?: string },
): string {
  const secret = opts?.secret ?? requireEnv("SESSION_JWT_SECRET");
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload: TokenPayload = {
    tid: session.tenantId,
    mid: session.memberId,
    iat: now,
    exp: now + (opts?.ttlSeconds ?? 3600),
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = createHmac("sha256", secret)
    .update(signingInput)
    .digest("base64url");
  return `${signingInput}.${sig}`;
}

/** Verify an Authorization header → MemberSession, or null if invalid/expired. */
export function verifyMemberSession(
  authHeader: string | undefined,
  opts?: { secret?: string },
): MemberSession | null {
  if (!authHeader) return null;
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : authHeader.trim();
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts as [string, string, string];

  let header: { alg?: unknown; typ?: unknown };
  try {
    header = JSON.parse(Buffer.from(h, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  // Pin the algorithm — reject `none` and any RS/ES confusion up front.
  if (header.alg !== "HS256" || header.typ !== "JWT") return null;

  const secret = opts?.secret ?? requireEnv("SESSION_JWT_SECRET");
  const expected = createHmac("sha256", secret).update(`${h}.${p}`).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(s, "base64url");
  } catch {
    return null;
  }
  if (
    provided.length !== expected.length ||
    !timingSafeEqual(provided, expected)
  )
    return null;

  let payload: TokenPayload;
  try {
    payload = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (
    typeof payload.exp === "number" &&
    payload.exp <= Math.floor(Date.now() / 1000)
  )
    return null;
  if (typeof payload.tid !== "string" || typeof payload.mid !== "string")
    return null;
  return { tenantId: payload.tid, memberId: payload.mid };
}
