/**
 * Session verification. apps/web signs in via Supabase Auth and sends the access token as
 * `Authorization: Bearer <jwt>`. Supabase issues ES256 tokens signed by the project's JWT signing
 * keys, so we verify against the published JWKS (`/auth/v1/.well-known/jwks.json`) — the shipped
 * contract, not the legacy shared HS256 secret. The JWKS is fetched once and cached by jose. A
 * forged/expired token, or one signed by a different project, throws → the middleware returns 401.
 */
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { env } from '../lib/env.js';

export interface VerifiedSession {
  /** Supabase auth.users id (JWT `sub`). The ONLY trusted identity anchor. */
  authUserId: string;
  email: string;
}

let jwks: JWTVerifyGetKey | null = null;
function keySet(): JWTVerifyGetKey {
  if (!jwks) jwks = createRemoteJWKSet(new URL(`${env.supabaseUrl()}/auth/v1/.well-known/jwks.json`));
  return jwks;
}

export async function verifySession(token: string): Promise<VerifiedSession> {
  const { payload } = await jwtVerify(token, keySet(), {
    algorithms: ['ES256', 'RS256'],
    issuer: `${env.supabaseUrl()}/auth/v1`,
  });
  const authUserId = typeof payload.sub === 'string' ? payload.sub : '';
  const email = typeof payload.email === 'string' ? payload.email : '';
  if (!authUserId) throw new Error('token missing sub');
  return { authUserId, email };
}

/** Extract a Bearer token from an Authorization header value, or null. */
export function bearerFrom(headerValue: string | undefined | null): string | null {
  if (!headerValue) return null;
  const m = /^Bearer\s+(.+)$/i.exec(headerValue.trim());
  return m ? m[1]!.trim() : null;
}
