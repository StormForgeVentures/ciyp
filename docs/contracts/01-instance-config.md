# Contract 01 — Instance Config

**Direction:** platform → UI · **Lives in:** `@ciyp/shared` · **Stability:** frozen at v1, additive-only.

The member UI is thin and instance-agnostic. At launch (and on config-version change) it fetches the
**Instance Config** for its tenant: who the coach is, what archetypes/tiers/journeys exist, branding, the
prompt-set version it's pinned against, and the **UI-relevant subset** of model routing. The UI renders
itself entirely from this — there are no coach-specific constants in the client.

> Per ADR-002 these are **per-tenant config rows** on the platform side, projected into this read model.
> Per ADR-001 `engineBaseUrl` is what repoints a promoted tenant to its dedicated engine.

## Endpoint

```
GET /v1/instance-config            (auth: member or coach session; tenant resolved from token)
→ 200 InstanceConfig
ETag / If-None-Match supported; UI caches and revalidates on configVersion change.
```

## Schema (zod / TS)

```ts
import { z } from 'zod';

export const Archetype = z.object({
  id: z.string().uuid(),
  key: z.string(),                 // stable slug, e.g. "operator"
  label: z.string(),
  description: z.string(),
  sort: z.number().int(),
  // NOTE: prompt_fragment is NOT exposed to the UI (engine-only).
});

export const Tier = z.object({
  id: z.string().uuid(),
  key: z.string(),                 // e.g. "core" | "premium"
  label: z.string(),
  description: z.string(),
  sort: z.number().int(),
});

export const Journey = z.object({
  id: z.string().uuid(),
  key: z.string(),                 // a cadence/program slug, e.g. "daily_checkin"
  label: z.string(),
  modality: z.enum(['voice', 'guided', 'text']),  // generic enum (stays)
  sort: z.number().int(),
});

export const Branding = z.object({
  coachDisplayName: z.string(),
  productName: z.string(),         // member-facing name of the pocket coach
  logoUrl: z.string().url().nullable(),
  // token OVERRIDES only; base tokens come from @ciyp/ui-tokens
  themeTokens: z.record(z.string(), z.string()).default({}),
});

export const UiModelRouting = z.object({
  // UI-relevant subset only — never full provider/model/keys
  voiceEnabled: z.boolean(),       // is the TTS/voice slot configured for this tenant?
  voiceLabel: z.string().nullable(),  // human label for the voice persona (not voice_id)
  sttEnabled: z.boolean(),
});

export const InstanceConfig = z.object({
  tenantId: z.string().uuid(),
  configVersion: z.number().int(), // bumps on any config change; UI revalidates on change
  promptSetVersion: z.string(),    // links to prompt_versions; UI shows nothing but pins behavior
  engineBaseUrl: z.string().url(), // ADR-001: dedicated-promotion repoints this
  branding: Branding,
  archetypes: z.array(Archetype),
  tiers: z.array(Tier),
  journeys: z.array(Journey),
  ui: UiModelRouting,
});
export type InstanceConfig = z.infer<typeof InstanceConfig>;
```

## Field table

| Field | Type | Notes |
|---|---|---|
| `tenantId` | uuid | the coach/tenant |
| `configVersion` | int | UI cache key; revalidate on change |
| `promptSetVersion` | string | pins AI behavior; ties to `prompt_versions`/`eval_snapshots` |
| `engineBaseUrl` | url | **ADR-001 promotion seam** — points at shared or dedicated engine |
| `branding.*` | — | display name, product name, logo, **token overrides only** |
| `archetypes[]` | Archetype | de-enumed (ADR-002); **no `prompt_fragment` to UI** |
| `tiers[]` | Tier | de-enumed (ADR-002) |
| `journeys[]` | Journey | cadence programs the member can enter |
| `ui.voiceEnabled` | bool | drives whether the UI shows voice affordances |

## Constraints for downstream

- **No engine secrets or full model identifiers** ever cross this boundary (no provider keys, no `voice_id`,
  no `prompt_fragment`). The UI gets labels and booleans, not routing internals.
- The UI **must** revalidate on `configVersion` change and re-pin `promptSetVersion`.
- `engineBaseUrl` is the only thing that changes for a promoted tenant — the UI must read it, not hardcode
  an engine host.
- Additive-only evolution (ADR-004): new optional fields are fine; removing/retyping a field is a major bump.
