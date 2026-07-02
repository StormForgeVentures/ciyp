/**
 * Admin-surface middleware + authorization gates.
 *
 * requireSession — every admin route runs through this: verify the Bearer JWT, resolve the
 * principal server-side, attach it. No token / invalid token → 401 (AC-6). It NEVER reads a
 * tenant id from the request; the scope comes only from the resolved principal.
 *
 * The gates (requireSuperadmin / requireOwner) return 403 when the verified role lacks the
 * right — the same absence the nav reflects, enforced independently at the API (AC-2).
 */
import type { Context, MiddlewareHandler } from 'hono';
import type { AppEnv } from './types.js';
import { bearerFrom, verifySession } from '../auth/session.js';
import { resolvePrincipal } from '../auth/principal.js';

export const requireSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = bearerFrom(c.req.header('authorization'));
  if (!token) return c.json({ error: 'unauthenticated' }, 401);

  let principal;
  try {
    const session = await verifySession(token);
    principal = await resolvePrincipal(session);
  } catch {
    return c.json({ error: 'unauthenticated' }, 401);
  }

  // A verified auth user who is neither a tenant admin nor a platform operator has no place
  // in the console — treat as forbidden rather than leak an empty session.
  if (!principal.admin && !principal.isSuperadmin) {
    return c.json({ error: 'no admin access' }, 403);
  }

  c.set('principal', principal);
  await next();
};

export const requireSuperadmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get('principal').isSuperadmin) return c.json({ error: 'forbidden' }, 403);
  await next();
};

/** Owner-only (tenant config/team rights). A delegated `team` member is rejected (AC-2). */
export const requireOwner: MiddlewareHandler<AppEnv> = async (c, next) => {
  const p = c.get('principal');
  // A superadmin acting in a tenant carries owner-equivalent rights for management actions.
  if (p.admin?.role === 'owner' || p.isSuperadmin) return void (await next());
  return c.json({ error: 'forbidden' }, 403);
};

/** Convenience typed getter. */
export function principal(c: Context<AppEnv>) {
  return c.get('principal');
}
