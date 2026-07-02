/**
 * Admin API surface (PRD-006a). Mounted at /admin. Kept in its own module tree so the parallel
 * 002 (Sport runtime) and 008 (store) work on apps/api touches different files — index.ts only
 * mounts this router.
 */
import { Hono } from 'hono';
import type { AppEnv } from '../http/types.js';
import { meRoute } from './me.js';
import { tenantsRoute } from './tenants.js';
import { teamRoute } from './team.js';
import { dashboardRoute } from './dashboard.js';

export const adminRoute = new Hono<AppEnv>();

adminRoute.route('/me', meRoute);
adminRoute.route('/tenants', tenantsRoute);
adminRoute.route('/team', teamRoute);
adminRoute.route('/dashboard', dashboardRoute);
