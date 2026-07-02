/**
 * Request-scoped AsyncLocalStorage — the OUT-OF-BAND channel for credentials.
 *
 * Decision #19 / ScalingCFO `no-jwt-in-resolved-scope` discipline: a credential
 * (JWT, bearer token, caller-scoped DB client, API key) must NEVER enter the Sport
 * `ResolvedScope`, because every string-valued scope key is projected verbatim onto
 * the `ai_trace` row (leaks to the audit log, forever, unredacted). Instead, the
 * verified session + any caller-scoped handle ride in this ALS; adapters read it at
 * call time. The scope carries only the identity DESCRIPTOR (who/what the turn is for).
 *
 * The scope resolver reads identity from `store.session.claims` — NEVER from a request
 * body (structurally: there is no body parameter anywhere in the resolve path).
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { SessionHandle } from '@theamazingwolf/sport-core';

export interface RequestContext {
  /** The VERIFIED session (claims from the auth layer). The only identity source. */
  readonly session: SessionHandle;
  /** A stable correlation id for the whole turn — threaded onto every trace row. */
  readonly correlationId: string;
}

const als = new AsyncLocalStorage<RequestContext>();

/** Run `fn` with the request context bound (the route/turn entrypoint owns this). */
export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return als.run(ctx, fn);
}

/** Read the current request context (adapters call this at call time). Undefined outside a turn. */
export function currentRequestContext(): RequestContext | undefined {
  return als.getStore();
}

/** Read the current correlation id, or a fixed sentinel outside a turn (never throws in a trace path). */
export function currentCorrelationId(): string {
  return als.getStore()?.correlationId ?? 'no-turn-context';
}
