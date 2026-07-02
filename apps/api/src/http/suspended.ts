/**
 * Suspended-instance write fence (PRD-006a AC-5). When a coach's own tenant is suspended
 * (status 'paused'), authentication still succeeds and the console renders a suspended state,
 * but every write API returns 403. A superadmin is exempt — they can still act on the instance.
 */
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from './types.js';

export const requireNotSuspended: MiddlewareHandler<AppEnv> = async (c, next) => {
  const p = c.get('principal');
  if (!p.isSuperadmin && p.admin?.tenantStatus === 'paused') {
    return c.json({ error: 'instance suspended' }, 403);
  }
  await next();
};
