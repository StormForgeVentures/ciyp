/**
 * Contract 04 — Spend Authorization (runtime ↔ wallet, engine-internal).
 * Cheap calls authorize against a cached balance (no round-trip, bounded overspend);
 * heavy calls hard-check the ledger with reserve/settle/release semantics.
 * Frozen at v1, additive-only. Source: docs/contracts/04-spend-authorization.md.
 */
import { z } from 'zod';

export const AuthorizeRequest = z.object({
  tenantId: z.string().uuid(),
  /** Mirrors UsageFeature (contract 03). */
  feature: z.string(),
  spendClass: z.enum(['cheap', 'heavy']),
  /** Best-effort pre-estimate (heavy: from the pricebook's per-feature estimate config). */
  estimatedCostMicros: z.number().int().nonnegative(),
});
export type AuthorizeRequest = z.infer<typeof AuthorizeRequest>;

export const AuthorizeResponse = z.object({
  allow: z.boolean(),
  /** Post-authorization estimate — advisory for cheap calls; the ledger is billing truth. */
  remainingCredits: z.number(),
  reason: z.enum(['ok', 'insufficient_balance', 'tenant_suspended']).default('ok'),
  /** Heavy calls only: the handle to settle/release the reservation. */
  authToken: z.string().nullable(),
});
export type AuthorizeResponse = z.infer<typeof AuthorizeResponse>;

/** Heavy calls reconcile actual spend after the call (or release on failure/short session). */
export const SettleRequest = z.object({
  authToken: z.string(),
  actualCostMicros: z.number().int().nonnegative(),
});
export type SettleRequest = z.infer<typeof SettleRequest>;
