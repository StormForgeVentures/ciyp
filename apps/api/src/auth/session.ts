/**
 * Session verification. apps/web signs in via Supabase Auth and sends the access token as
 * `Authorization: Bearer <jwt>`. We verify the JWT locally (HS256, the project JWT secret) —
 * no per-request round-trip to GoTrue — and extract the identity claims. A forged or expired
 * token throws; the middleware turns that into 401.
 */
import { jwtVerify } from 'jose';
import { env } from '../lib/env.js';

export interface VerifiedSession {
  /** Supabase auth.users id (JWT `sub`). The ONLY trusted identity anchor. */
  authUserId: string;
  email: string;
}

let secretKey: Uint8Array | null = null;
function key(): Uint8Array {
  if (!secretKey) secretKey = new TextEncoder().encode(env.supabaseJwtSecret());
  return secretKey;
}

export async function verifySession(token: string): Promise<VerifiedSession> {
  const { payload } = await jwtVerify(token, key(), { algorithms: ['HS256'] });
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
