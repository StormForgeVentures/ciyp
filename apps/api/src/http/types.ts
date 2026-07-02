import type { Principal } from '../auth/principal.js';

/** Hono environment for the admin surface. `principal` is set by requireSession. */
export interface AppEnv {
  Variables: {
    principal: Principal;
  };
}

/** Header a switched superadmin sends to act inside a target tenant (honored ONLY if superadmin). */
export const ACTING_TENANT_HEADER = 'x-acting-tenant';
