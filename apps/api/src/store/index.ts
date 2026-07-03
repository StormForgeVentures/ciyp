/**
 * Program-access store (PRD-008a §1.1–§1.3) — public module surface.
 *
 * Mount into the apps/api Hono app:
 *   import { createStoreRoutes, defaultStoreDeps } from './store/index.js';
 *   app.route('/', createStoreRoutes(defaultStoreDeps()));
 *
 * The §1.4 session-start gate (later wave) reuses resolveEntitlement + isEntitled here.
 */
export { createStoreRoutes, defaultStoreDeps } from "./routes.js";
export type { StoreRouteDeps } from "./routes.js";
export {
  resolveEntitlement,
  computeStatus,
  isEntitled,
} from "./entitlement.js";
export type { ContractStatus, EntitlementView } from "./entitlement.js";
export { createCheckoutSession } from "./checkout.js";
export { handleStripeWebhook } from "./webhook.js";
export { InterimStripeConnector } from "./connector/interim.js";
export type {
  CoachStripeConnector,
  StripeConnectorConfig,
  ConnectParams,
} from "./connector/port.js";
export {
  verifiedMemberSession,
  resolveMemberPrincipal,
} from "./member-auth.js";
export type { MemberSession } from "./member-auth.js";
export { closePool } from "./db.js";
