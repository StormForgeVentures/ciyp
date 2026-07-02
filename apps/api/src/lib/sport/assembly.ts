/**
 * Per-tenant-scope Sport assembly (PRD-002b FR-1/FR-2). `hostFor(scope)` returns a host
 * cached by `(tenant_id, config_version)`; `invalidate(tenantId)` evicts; the cache is a
 * bounded LRU (default 32); concurrent turns during a rebuild get the OLD host until the
 * new one is ready. This is the exact seam where ScalingCFO's singleton-host anti-pattern
 * is prohibited.
 *
 * INTERIM SEAM (FR-2): the host is assembled from SDK primitives (slot resolver, cascade
 * composer, governance ports) behind the stable `hostFor`/`invalidate` interface. When
 * sport-ai-sdk #25 (per-scope assembly manager), #26 (registry upsert), and #27
 * (config-store ports + hydration loader) resolve, the interim cache is replaced BEHIND
 * this same interface with no caller change. Tasks cite issue numbers, never a version.
 *
 * `config_version` is derived from `app_config.updated_at` (monotonic via the
 * set_updated_at trigger) — no schema change; a dedicated `config_version` column is the
 * forward option when contention on the timestamp is observed.
 */
import type { SlotResolver } from '@theamazingwolf/sport-core';
import { withTenantReadTx } from './tenant-context.js';
import { createCiypSlotResolver, makeGetModelSlot } from './slot-resolver.js';
import { createEmbedder, type Embedder } from './embedder.js';
import { createReranker, type Reranker } from './reranker.js';
import type { CiypScope } from './scope-resolver.js';
import type { GetModelSlot } from '@ciyp/agents';

/** A tenant-pinned assembled host — every per-scope port the runtime turn needs. */
export interface SportHost {
  readonly tenantId: string;
  readonly configVersion: string;
  readonly slotResolver: SlotResolver;
  readonly embedder: Embedder;
  readonly reranker: Reranker;
  /** The brain-facing slot resolver bound to a concrete scope. */
  getModelSlot(scope: CiypScope): GetModelSlot;
}

export interface HostCacheDeps {
  /** Read the monotonic config version for a tenant. Default: app_config.updated_at. */
  readConfigVersion?: (tenantId: string) => Promise<string>;
  /** Build a fresh host for a (tenant, version). Default: assemble the real ports. */
  buildHost?: (tenantId: string, version: string) => Promise<SportHost> | SportHost;
  /** LRU bound (config-tunable, architecture OQ-6). Default 32 or SPORT_HOST_CACHE_MAX. */
  max?: number;
  /** Eviction hook (AC-3 metric/trace). Default: warn. */
  onEvict?: (tenantId: string, version: string) => void;
}

async function defaultReadConfigVersion(tenantId: string): Promise<string> {
  const scope: CiypScope = { tenantId, context: 'coach' };
  return withTenantReadTx(scope, async (client) => {
    const res = await client.query(
      `select extract(epoch from updated_at)::text v from app_config where tenant_id = $1`,
      [tenantId],
    );
    const v = res.rows[0]?.v as string | undefined;
    if (!v) throw new Error(`assembly.hostFor: no app_config row for tenant ${tenantId}`);
    return v;
  });
}

function defaultBuildHost(tenantId: string, version: string): SportHost {
  const slotResolver = createCiypSlotResolver();
  const embedder = createEmbedder();
  const reranker = createReranker();
  return {
    tenantId,
    configVersion: version,
    slotResolver,
    embedder,
    reranker,
    getModelSlot: (scope) => makeGetModelSlot(slotResolver, scope),
  };
}

export interface HostCache {
  hostFor(scope: CiypScope): Promise<SportHost>;
  invalidate(tenantId: string): void;
  /** Test/introspection: current cached (tenant:version) keys, most-recent last. */
  keys(): string[];
  size(): number;
}

/**
 * Build the bounded, invalidating host cache. Exported as a factory so tests inject a
 * deterministic version source + build fn to exercise identity / eviction / invalidation
 * / old-host-until-ready without a live rebuild.
 */
export function createHostCache(deps: HostCacheDeps = {}): HostCache {
  const readConfigVersion = deps.readConfigVersion ?? defaultReadConfigVersion;
  const buildHost = deps.buildHost ?? defaultBuildHost;
  const max = deps.max ?? (Number(process.env.SPORT_HOST_CACHE_MAX) || 32);
  const onEvict =
    deps.onEvict ??
    ((tenantId, version) =>
      console.warn(`[assembly] host cache eviction tenant=${tenantId} version=${version}`));

  // LRU keyed by `${tenantId}:${version}` — Map preserves insertion order; we delete+set
  // to move-to-front (most-recent last).
  const lru = new Map<string, SportHost>();
  // The most-recently-known host per tenant (for old-host-until-ready).
  const currentByTenant = new Map<string, SportHost>();
  // In-flight builds per key (dedupe concurrent builds of the same key).
  const building = new Map<string, Promise<SportHost>>();

  const keyOf = (tenantId: string, version: string) => `${tenantId}:${version}`;

  function touch(key: string, host: SportHost): void {
    lru.delete(key);
    lru.set(key, host);
    while (lru.size > max) {
      const oldestKey = lru.keys().next().value as string;
      const evicted = lru.get(oldestKey)!;
      lru.delete(oldestKey);
      onEvict(evicted.tenantId, evicted.configVersion);
    }
  }

  async function build(tenantId: string, version: string, key: string): Promise<SportHost> {
    const host = await buildHost(tenantId, version);
    building.delete(key);
    touch(key, host);
    currentByTenant.set(tenantId, host);
    return host;
  }

  return {
    async hostFor(scope: CiypScope): Promise<SportHost> {
      const tenantId = scope.tenantId;
      const version = await readConfigVersion(tenantId);
      const key = keyOf(tenantId, version);

      const cached = lru.get(key);
      if (cached) {
        touch(key, cached);
        return cached;
      }

      // A build for THIS key is already in flight. Serve the old host until it's ready
      // (concurrent turns during a rebuild never block on the new build).
      const inFlight = building.get(key);
      const old = currentByTenant.get(tenantId);
      if (inFlight) return old ?? inFlight;

      const p = build(tenantId, version, key);
      building.set(key, p);
      // First-ever host for the tenant must await; otherwise serve the old host.
      return old ?? p;
    },

    invalidate(tenantId: string): void {
      for (const key of [...lru.keys()]) {
        if (key.startsWith(`${tenantId}:`)) lru.delete(key);
      }
      currentByTenant.delete(tenantId);
      // In-flight builds for the tenant are abandoned to the cache (harmless: the next
      // hostFor reads the new version and builds fresh).
      for (const key of [...building.keys()]) {
        if (key.startsWith(`${tenantId}:`)) building.delete(key);
      }
    },

    keys: () => [...lru.keys()],
    size: () => lru.size,
  };
}
