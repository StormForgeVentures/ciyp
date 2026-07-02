/**
 * Live per-scope model-slot resolution (PRD-002c FR-1..4). A coach changes a model in
 * `app_config.model_routing` and the NEXT turn uses it — no deploy.
 *
 *   - LIVE `LoadSlotConfig(scope)` reads the tenant's `app_config.model_routing`, merged
 *     SHALLOW per-slot over the platform defaults (config file, not code literals — 002c
 *     Q-1). `staticSlotConfig` is a PROHIBITED pattern (rule-2 CI grep).
 *   - Wired through the SDK `createSlotResolver` (cache + TTL 3600s backstop), with
 *     `invalidate(scope)` called on every config write path (the assembly host cache
 *     also evicts on config write, rebuilding the resolver — belt + suspenders).
 *   - `HardcodedModelError` stays enabled; per-role overrides are legal ONLY from tenant
 *     config rows (a code literal is a rule-2 finding, caught by `scripts/model-literal-grep`).
 *
 * The runtime slot keys are the SDK baseline (`default|fast|classify|deep|worker|
 * synthesis|embed|rerank`) + `vision` + config-only `stt|tts`. The pure brain speaks its
 * own `ModelSlot` union; `BRAIN_TO_CONFIG_SLOT` maps it onto these config keys.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  createSlotResolver,
  type SlotConfig,
  type SlotScope,
  type SlotResolver,
} from '@theamazingwolf/sport-core';
import type { GetModelSlot, ModelSlot } from '@ciyp/agents';
import { withTenantReadTx } from './tenant-context.js';
import type { CiypScope } from './scope-resolver.js';

/** Slot-config cache TTL backstop (002c Q-2): 3600s. Invalidate-on-write is primary. */
export const SLOT_TTL_MS = 3_600_000;

/** The pure-brain `ModelSlot` union → runtime config-slot key. */
export const BRAIN_TO_CONFIG_SLOT: Record<ModelSlot, string> = {
  chat: 'default',
  fast: 'fast',
  vision: 'vision',
  embedding: 'embed',
  rerank: 'rerank',
  stt: 'stt',
  tts: 'tts',
};

interface RawSlot {
  provider?: string;
  model?: string;
  [k: string]: unknown;
}

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULTS_PATH = resolve(here, '../../config/platform-slot-defaults.json');

let platformDefaultsCache: Record<string, RawSlot> | undefined;
/** The platform-default slot map (config file). Cached per process. */
export function platformSlotDefaults(): Record<string, RawSlot> {
  if (!platformDefaultsCache) {
    const raw = JSON.parse(readFileSync(DEFAULTS_PATH, 'utf8')) as Record<string, unknown>;
    const out: Record<string, RawSlot> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (k === '__doc__') continue;
      out[k] = v as RawSlot;
    }
    platformDefaultsCache = out;
  }
  return platformDefaultsCache;
}

/** Reconcile one raw slot → an SDK `SlotResolution`. Fail loud on a missing model. */
function toResolution(slotKey: string, raw: RawSlot | undefined): { provider: string; model: string } {
  if (!raw || typeof raw.model !== 'string' || raw.model.trim() === '') {
    throw new Error(
      `slot-resolver: slot '${slotKey}' has no model binding in app_config.model_routing ` +
        `nor platform defaults — refusing to silently default into a wrong model (rule 2).`,
    );
  }
  const provider =
    typeof raw.provider === 'string' && raw.provider.trim() !== '' ? raw.provider : 'openrouter';
  return { provider, model: raw.model };
}

/** The tenant id → `SlotScope` the SDK resolver caches by. */
export function slotScopeFor(scope: CiypScope): SlotScope {
  return { tenant_id: scope.tenantId };
}

/**
 * LIVE loader: read the tenant's `model_routing`, merge SHALLOW per-slot over platform
 * defaults. A tenant that omits a slot inherits the platform default (deterministic
 * fallback, 002c Q-1). Reads under the tenant's own coach-scoped GUC fence.
 */
export async function loadSlotConfig(slotScope: SlotScope): Promise<SlotConfig> {
  const tenantId = slotScope?.tenant_id;
  if (!tenantId) {
    throw new Error('loadSlotConfig: SlotScope must carry a tenant_id (no platform-wide slot read).');
  }
  const readScope: CiypScope = { tenantId, context: 'coach' };
  const routing = await withTenantReadTx(readScope, async (client) => {
    const res = await client.query(
      `select model_routing from app_config where tenant_id = $1`,
      [tenantId],
    );
    return (res.rows[0]?.model_routing ?? {}) as Record<string, RawSlot>;
  });

  const defaults = platformSlotDefaults();
  const merged: Record<string, { provider: string; model: string }> = {};
  const allKeys = new Set([...Object.keys(defaults), ...Object.keys(routing)]);
  for (const key of allKeys) {
    // Shallow per-slot merge: the tenant row wins field-by-field over the default.
    const raw: RawSlot = { ...(defaults[key] ?? {}), ...(routing[key] ?? {}) };
    merged[key] = toResolution(key, raw);
  }
  return merged as SlotConfig;
}

/** Build the SDK slot resolver over the live loader (TTL 3600s backstop + invalidate). */
export function createCiypSlotResolver(
  load: (scope: SlotScope) => Promise<SlotConfig> = loadSlotConfig,
): SlotResolver {
  return createSlotResolver(load, { ttlMs: SLOT_TTL_MS });
}

/**
 * Build the `GetModelSlot` the `@ciyp/agents` substrate consumes. Maps the brain slot to
 * a config key and resolves it live for THIS scope; returns `{ model, provider }`.
 * Config-only slots (`stt`/`tts`) resolve too (voice runtime reads them).
 */
export function makeGetModelSlot(resolver: SlotResolver, scope: CiypScope): GetModelSlot {
  const slotScope = slotScopeFor(scope);
  return async (brainSlot: ModelSlot) => {
    const configKey = BRAIN_TO_CONFIG_SLOT[brainSlot];
    const lookup = await resolver.tryGetModelSlot(slotScope, configKey);
    if (!lookup.configured) return null;
    return { model: lookup.resolution.model, provider: lookup.resolution.provider };
  };
}
