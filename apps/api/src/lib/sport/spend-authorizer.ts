/**
 * SpendAuthorizer STUB (PRD-002b FR-8 / AC-7). Implements the contract-04 interface
 * (`authorize` / `settle` / `release`) returning CONFIGURED-ALLOW with full tracing, so
 * PRD-007b swaps in the real wallet-backed enforcement WITHOUT touching call sites.
 *
 * This is a clean interface seam ONLY — it deliberately implements NO real balance check,
 * reserve, or ledger write (007b owns that; the two must never share a wave). The deny
 * path is exercisable via config so callers can prove short-circuit behavior end-to-end
 * before the real authorizer lands.
 */
import {
  type AuthorizeRequest,
  type AuthorizeResponse,
  type SettleRequest,
} from '@stormforgeventures/ciyp-shared';
import { recordAiTrace } from './trace-sink.js';
import type { CiypScope } from './scope-resolver.js';

export interface SpendAuthorizer {
  authorize(req: AuthorizeRequest): Promise<AuthorizeResponse>;
  settle(req: SettleRequest): Promise<void>;
  release(authToken: string): Promise<void>;
}

export interface SpendAuthorizerStubConfig {
  /** When false, `authorize` denies (deny-path proof). Default true (configured-allow). */
  allow?: boolean;
  /** The deny reason surfaced when `allow` is false. */
  denyReason?: AuthorizeResponse['reason'];
  /** The advisory remaining-credits figure the stub reports. */
  remainingCredits?: number;
}

/**
 * Build the stub authorizer for a scope. Every decision writes a `spend_authorization`
 * governance trace row (so the deny short-circuit is auditable — AC-7).
 */
export function createSpendAuthorizerStub(
  scope: CiypScope,
  correlationId: string,
  config: SpendAuthorizerStubConfig = {},
): SpendAuthorizer {
  const allow = config.allow ?? true;
  const remainingCredits = config.remainingCredits ?? 1_000_000;

  return {
    async authorize(req: AuthorizeRequest): Promise<AuthorizeResponse> {
      const reason: AuthorizeResponse['reason'] = allow
        ? 'ok'
        : (config.denyReason ?? 'insufficient_balance');
      // Heavy calls get a settle/release handle; cheap calls do not (contract-04).
      const authToken = allow && req.spendClass === 'heavy' ? `stub-auth-${correlationId}` : null;

      recordAiTrace(scope, correlationId, {
        eventType: 'spend_authorization',
        feature: req.feature,
        data: {
          decision: allow ? 'allow' : 'deny',
          reason,
          spend_class: req.spendClass,
          estimated_cost_micros: req.estimatedCostMicros,
          stub: true,
        },
      });

      return { allow, remainingCredits, reason, authToken };
    },

    async settle(req: SettleRequest): Promise<void> {
      recordAiTrace(scope, correlationId, {
        eventType: 'spend_settle',
        data: { auth_token: req.authToken, actual_cost_micros: req.actualCostMicros, stub: true },
      });
    },

    async release(authToken: string): Promise<void> {
      recordAiTrace(scope, correlationId, {
        eventType: 'spend_release',
        data: { auth_token: authToken, stub: true },
      });
    },
  };
}

/** Thrown by a turn when authorization is denied (the documented short-circuit shape). */
export class SpendDeniedError extends Error {
  constructor(public readonly reason: AuthorizeResponse['reason']) {
    super(`spend authorization denied: ${reason}`);
    this.name = 'SpendDeniedError';
  }
}
